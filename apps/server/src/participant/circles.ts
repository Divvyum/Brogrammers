import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { col } from "../core/events.js";
import { db } from "../core/firebase.js";

// JourneyLink travel circles (plan M10): people travelling from the same or a
// nearby city, by the same mode, arriving within a few hours of each other.

/** Cities that count as one place for meeting up. Lowercase, no spaces. */
const CLUSTERS: string[][] = [
  ["mumbai", "thane", "navimumbai", "kalyan", "vasai", "virar", "bhiwandi", "panvel"],
  ["pune", "pimpri", "chinchwad", "pimprichinchwad", "lonavala"],
  ["delhi", "newdelhi", "noida", "greaternoida", "gurgaon", "gurugram", "ghaziabad", "faridabad"],
  ["bangalore", "bengaluru"],
  ["hyderabad", "secunderabad", "cyberabad"],
  ["kolkata", "howrah", "saltlake"],
  ["chennai", "tambaram"],
  ["ahmedabad", "gandhinagar"],
  ["nashik", "igatpuri"],
  ["nagpur"],
  ["guwahati", "dispur"],
];

const normalizeCity = (c: string) => c.toLowerCase().replace(/[^a-z]/g, "");

export function cityCluster(city: string): string {
  const c = normalizeCity(city);
  const found = CLUSTERS.find((group) => group.includes(c));
  return found ? found[0]! : c;
}

/** Arrivals within this window of the first person in a group travel together. */
export const ARRIVAL_WINDOW_MS = 4 * 3600_000;

interface Plan {
  uid: string;
  cluster: string;
  mode: string;
  arriveAt: number;
  route: string;
  carpool: boolean;
}

/** Groups plans greedily: same cluster and mode, arrivals within the window. */
export function groupPlans(plans: Plan[]): Plan[][] {
  const byKey = new Map<string, Plan[]>();
  for (const p of plans) {
    const key = `${p.cluster}|${p.mode.toLowerCase()}`;
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }
  const groups: Plan[][] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.arriveAt - b.arriveAt);
    let current: Plan[] = [];
    for (const p of list) {
      if (current.length && p.arriveAt - current[0]!.arriveAt > ARRIVAL_WINDOW_MS) {
        groups.push(current);
        current = [];
      }
      current.push(p);
    }
    if (current.length) groups.push(current);
  }
  return groups;
}

/**
 * Recomputes every circle for the event from the travel plans. Circle IDs are
 * stable per cluster + mode + arrival window, so chat history and meet-up
 * points survive re-matching. Solo travellers get no circle.
 */
export async function matchTravelCircles(eventId: string) {
  const snap = await col(eventId, "travelPlans").get();
  const plans: Plan[] = snap.docs.map((d) => ({
    uid: d.id,
    cluster: cityCluster(String(d.get("city") ?? "")),
    mode: String(d.get("mode") ?? ""),
    arriveAt: (d.get("arriveAt") as Timestamp).toMillis(),
    route: String(d.get("route") ?? ""),
    carpool: Boolean(d.get("carpool")),
  }));
  const groups = groupPlans(plans).filter((g) => g.length >= 2);
  const keep = new Set<string>();
  const writer = db.bulkWriter();
  for (const g of groups) {
    const first = g[0]!;
    const windowStart = Math.floor(first.arriveAt / ARRIVAL_WINDOW_MS);
    const id = `${first.cluster}_${first.mode.toLowerCase().replace(/[^a-z]/g, "")}_${windowStart}`;
    keep.add(id);
    writer.set(
      col(eventId, "circles").doc(id),
      {
        route: `${first.cluster} → event`,
        city: first.cluster,
        mode: first.mode,
        members: g.map((p) => p.uid),
        carpool: g.some((p) => p.carpool),
        arriveFrom: new Date(Math.min(...g.map((p) => p.arriveAt))).toISOString(),
        arriveTo: new Date(Math.max(...g.map((p) => p.arriveAt))).toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  // Circles nobody matches any more are emptied (their chat stays readable to no one).
  const existing = await col(eventId, "circles").select("members").get();
  for (const c of existing.docs) if (!keep.has(c.id) && (c.get("members") as string[] | undefined)?.length) writer.update(c.ref, { members: [] });
  await writer.close();
  return groups.length;
}
