import type { DocumentData } from "firebase-admin/firestore";
import { eventPath, type EventSubcollection } from "@hackos/shared";
import { db } from "./firebase.js";
import { notFound } from "./http.js";

/** A subcollection of events/{eventId}. */
export function col(eventId: string, sub: EventSubcollection) {
  return db.collection(eventPath(eventId, sub));
}

export function eventRef(eventId: string) {
  return db.doc(eventPath(eventId));
}

export async function getEvent(eventId: string): Promise<DocumentData & { id: string }> {
  const snap = await eventRef(eventId).get();
  if (!snap.exists) throw notFound("Event");
  return { id: snap.id, ...snap.data()! };
}

/** All active events (jobs loop over these). */
export async function listEventIds(): Promise<string[]> {
  const snap = await db.collection("events").select().get();
  return snap.docs.map((d) => d.id);
}

/** Page through a query result: returns rows plus `next` to pass as `after`. */
export function page<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, next: hasMore ? items[items.length - 1]!.id : null };
}
