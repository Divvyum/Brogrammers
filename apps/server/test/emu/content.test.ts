import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COL } from "@hackos/shared";
import { remindDueTasks } from "../../src/admin/ops/routes.js";
import { updateSeenCounts } from "../../src/admin/announcements/announcements.js";
import { releaseDueProblems } from "../../src/admin/problems/problems.js";
import { setAiGenerator } from "../../src/core/ai.js";
import { col, eventRef } from "../../src/core/events.js";
import { db } from "../../src/core/firebase.js";
import { issueFoodPass } from "../../src/core/foodpass.js";
import { sentPushes } from "../../src/core/push.js";
import { api, auditFor, bearer, eventBody, resetEmulators, tokenFor } from "./helpers.js";

// D16 schedule, D17 problems, D18 announcements, D19 outbox, D21 volunteer ops.

let E: string;
let org: string;
let vol: string;
let volUid: string;

const outboxWhere = async (template: string) =>
  (await db.collection(COL.outbox).where("eventId", "==", E).where("template", "==", template).get()).docs.map((d) => d.data());

beforeAll(async () => {
  await resetEmulators();
  const su = await tokenFor("super1", { role: "superadmin", eventId: "*" });
  E = (await api().post("/api/admin/events").set(bearer(su)).send(eventBody({ tracks: ["AI", "FinTech"] }))).body.id;
  org = await tokenFor("org1", { role: "organizer", eventId: E });
  volUid = "vol1";
  vol = await tokenFor(volUid, { role: "volunteer", eventId: E });
  // 3 AI people in room r1, 2 FinTech people in room r2, one merged record.
  const people: [string, string, string][] = [["a1", "AI", "r1"], ["a2", "AI", "r1"], ["a3", "AI", "r1"], ["f1", "FinTech", "r2"], ["f2", "FinTech", "r2"]];
  for (const [uid, track, roomId] of people) {
    await col(E, "participants").doc(uid).set({ name: uid, track, roomId, status: "eligible", registeredAt: Timestamp.now(), rosterVersion: 1 });
  }
  await col(E, "participants").doc("gone").set({ name: "gone", track: "AI", roomId: "r1", mergedInto: "a1", status: "rejected", registeredAt: Timestamp.now(), rosterVersion: 1 });
});

afterAll(() => setAiGenerator(null));

describe("D16: schedule", () => {
  let id: string;

  it("creating a track session notifies only that track", async () => {
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 86_400_000 + 3_600_000).toISOString();
    const res = await api().post(`/api/admin/events/${E}/schedule`).set(bearer(org))
      .send({ title: "AI briefing", startAt: start, endAt: end, location: "A101", audience: { type: "track", ids: ["AI"] } });
    expect(res.status).toBe(201);
    expect(res.body.notified).toBe(3);
    id = res.body.id;
  });

  it("changing it queues a new message for that track only (merged records excluded)", async () => {
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const end = new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString();
    const res = await api().patch(`/api/admin/events/${E}/schedule/${id}`).set(bearer(org))
      .send({ title: "AI briefing (moved)", startAt: start, endAt: end, location: "A102", audience: { type: "track", ids: ["AI"] } });
    expect(res.body.notified).toBe(3);
    const msgs = await outboxWhere("schedule_changed");
    expect(new Set(msgs.map((m) => m.to.uid))).toEqual(new Set(["a1", "a2", "a3"]));
    expect(msgs).toHaveLength(6); // created + changed, 3 people each
    expect(msgs.some((m) => m.vars.title === "AI briefing (moved)" && m.vars.location === ", A102")).toBe(true);
  });

  it("deleting it sends a cancellation to the same people", async () => {
    const res = await api().delete(`/api/admin/events/${E}/schedule/${id}`).set(bearer(org));
    expect(res.body.notified).toBe(3);
    expect((await outboxWhere("schedule_cancelled")).map((m) => m.to.uid).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("previews who would be notified", async () => {
    const res = await api().post(`/api/admin/events/${E}/schedule/preview-audience`).set(bearer(org)).send({ audience: { type: "room", ids: ["r2"] } });
    expect(res.body.count).toBe(2);
  });
});

describe("D17: problem statements", () => {
  it("a problem scheduled one minute ahead is released on time, to its track only", async () => {
    const releaseAt = new Date(Date.now() + 60_000);
    const res = await api().post(`/api/admin/events/${E}/problems`).set(bearer(org))
      .send({ track: "FinTech", title: "Fraud detection", body: "Spot fraud.", releaseAt: releaseAt.toISOString() });
    expect(res.status).toBe(201);

    expect(await releaseDueProblems(E)).toBe(0); // not yet
    expect((await col(E, "problems").doc(res.body.id).get()).get("released")).toBe(false);

    expect(await releaseDueProblems(E, Timestamp.fromMillis(releaseAt.getTime() + 1000))).toBe(1);
    expect((await col(E, "problems").doc(res.body.id).get()).get("released")).toBe(true);
    expect((await outboxWhere("problem_released")).map((m) => m.to.uid).sort()).toEqual(["f1", "f2"]);
    expect(sentPushes.some((p) => p.topic === "track_FinTech")).toBe(true);
    expect(await releaseDueProblems(E, Timestamp.fromMillis(releaseAt.getTime() + 5000))).toBe(0); // once
  });

  it("rejects unknown tracks and refuses to delete a released problem", async () => {
    const bad = await api().post(`/api/admin/events/${E}/problems`).set(bearer(org)).send({ track: "Space", title: "x", body: "y", releaseAt: new Date().toISOString() });
    expect(bad.status).toBe(400);
    const released = (await col(E, "problems").where("released", "==", true).get()).docs[0]!;
    expect((await api().delete(`/api/admin/events/${E}/problems/${released.id}`).set(bearer(org))).status).toBe(409);
  });
});

describe("D18: announcements", () => {
  it("an announcement to one room creates exactly that room's outbox messages", async () => {
    const res = await api().post(`/api/admin/events/${E}/announcements`).set(bearer(org))
      .send({ title: "Pizza in r2", body: "Come to the front desk.", audience: { type: "room", ids: ["r2"] } });
    expect(res.status).toBe(201);
    expect(res.body.recipients).toBe(2);
    const msgs = (await outboxWhere("announcement")).filter((m) => m.vars.title === "Pizza in r2");
    expect(msgs.map((m) => m.to.uid).sort()).toEqual(["f1", "f2"]);
    expect(msgs.every((m) => m.priority === 1)).toBe(true);
    expect(sentPushes.some((p) => p.topic === "room_r2" && p.title === "Pizza in r2")).toBe(true);
  });

  it("an emergency goes to everyone at priority 0", async () => {
    const res = await api().post(`/api/admin/events/${E}/announcements`).set(bearer(org))
      .send({ title: "Evacuate", body: "Use the nearest exit.", audience: { type: "all", ids: [] }, emergency: true });
    expect(res.body.recipients).toBe(5);
    const msgs = (await outboxWhere("announcement")).filter((m) => m.vars.title === "Evacuate");
    expect(msgs).toHaveLength(5);
    expect(msgs.every((m) => m.priority === 0)).toBe(true);
    expect(await auditFor(E, "announcement.emergency")).toHaveLength(1);
  });

  it("drafts an announcement from notes with AI", async () => {
    setAiGenerator(async (prompt) => {
      expect(prompt).toContain("lunch moved to 2pm");
      return '```json\n{"title":"Lunch moved to 2 PM","body":"Lunch is now at 2 PM in the cafeteria."}\n```';
    });
    const res = await api().post(`/api/admin/events/${E}/announcements/ai-draft`).set(bearer(org)).send({ notes: "lunch moved to 2pm, cafeteria" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ title: "Lunch moved to 2 PM", body: "Lunch is now at 2 PM in the cafeteria." });
  });

  it("keeps seenCount up to date", async () => {
    const a = (await col(E, "announcements").where("title", "==", "Pizza in r2").get()).docs[0]!;
    await a.ref.collection("seen").doc("f1").set({ seenAt: Timestamp.now() });
    expect(await updateSeenCounts(E)).toBeGreaterThanOrEqual(1);
    expect((await a.ref.get()).get("seenCount")).toBe(1);
    const list = await api().get(`/api/admin/events/${E}/announcements`).set(bearer(org));
    expect(list.body.items.find((x: { id: string }) => x.id === a.id).seenPct).toBe(50);
  });
});

describe("D19: outbox dashboard", () => {
  it("shows queued messages while there's no worker yet", async () => {
    const res = await api().get(`/api/admin/events/${E}/outbox/status`).set(bearer(org));
    expect(res.body.connection).toMatchObject({ state: "disconnected", waitingForWorker: true });
    expect(res.body.counts.queued).toBeGreaterThan(10);
    expect(res.body.counts.sent).toBe(0);
  });

  it("searches history and retries a failed message", async () => {
    const page = await api().get(`/api/admin/events/${E}/outbox/messages?uid=f1&limit=2`).set(bearer(org));
    expect(page.body.items).toHaveLength(2);
    expect(page.body.next).toBeTruthy();

    const failed = page.body.items[0].id;
    await db.collection(COL.outbox).doc(failed).update({ status: "failed", attempts: 5, lastError: "number not on WhatsApp" });
    const fails = await api().get(`/api/admin/events/${E}/outbox/messages?status=failed`).set(bearer(org));
    expect(fails.body.items.map((m: { id: string }) => m.id)).toEqual([failed]);

    expect((await api().post(`/api/admin/events/${E}/outbox/${failed}/retry`).set(bearer(org))).status).toBe(200);
    expect((await db.collection(COL.outbox).doc(failed).get()).data()).toMatchObject({ status: "queued", attempts: 0 });
    expect((await api().post(`/api/admin/events/${E}/outbox/${failed}/retry`).set(bearer(org))).status).toBe(409);
  });

  it("has a default template for every message type and keeps edits", async () => {
    const created = await api().post("/api/admin/templates/defaults").set(bearer(org));
    expect(created.body.created).toBeGreaterThan(15);
    const all = await api().get("/api/admin/templates").set(bearer(org));
    const ids = all.body.items.map((t: { id: string }) => t.id);
    for (const t of ["announcement", "schedule_changed", "problem_released", "checkin_welcome", "enrollment_link"]) expect(ids).toContain(t);

    await api().put("/api/admin/templates/announcement").set(bearer(org)).send({ channel: "whatsapp", body: "📢 {{title}}: {{body}}" });
    expect((await api().post("/api/admin/templates/defaults").set(bearer(org))).body.created).toBe(0);
    expect((await db.collection(COL.templates).doc("announcement").get()).get("body")).toBe("📢 {{title}}: {{body}}");
  });
});

describe("D21: volunteer operations", () => {
  it("the same food pass scanned twice is rejected the second time", async () => {
    const now = Date.now();
    await api().put(`/api/admin/events/${E}/food/config`).set(bearer(org)).send({
      meals: [{ id: "lunch-1", name: "Lunch", startAt: new Date(now - 600_000).toISOString(), endAt: new Date(now + 3_600_000).toISOString() }],
      counters: ["A"],
    });
    const token = issueFoodPass(E, "a1");
    const first = await api().post(`/api/admin/events/${E}/food/scan`).set(bearer(vol)).send({ token, mealId: "lunch-1", counter: "A" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, name: "a1", meal: "Lunch" });

    const second = await api().post(`/api/admin/events/${E}/food/scan`).set(bearer(vol)).send({ token, mealId: "lunch-1", counter: "A" });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("ALREADY_CLAIMED");
    // A fresh pass for the same person doesn't get round it either.
    const fresh = await api().post(`/api/admin/events/${E}/food/scan`).set(bearer(vol)).send({ token: issueFoodPass(E, "a1"), mealId: "lunch-1", counter: "B" });
    expect(fresh.status).toBe(409);
  });

  it("rejects forged, expired and other-event passes", async () => {
    const good = issueFoodPass(E, "a2");
    const forged = good.slice(0, -2) + (good.endsWith("AA") ? "BB" : "AA");
    const scan = (token: string) => api().post(`/api/admin/events/${E}/food/scan`).set(bearer(vol)).send({ token, mealId: "lunch-1", counter: "A" });
    expect((await scan(forged)).body.error).toBe("BAD_FOOD_PASS");
    expect((await scan(issueFoodPass(E, "a2", Date.now() - 3_600_000))).body.message).toMatch(/expired/);
    expect((await scan(issueFoodPass("other", "a2"))).body.message).toMatch(/different event/);
    expect((await scan("garbage-token")).status).toBe(400);
  });

  it("tasks: volunteers update their own, and get one reminder before the due time", async () => {
    const created = await api().post(`/api/admin/events/${E}/tasks`).set(bearer(org))
      .send({ title: "Restock water", assignedTo: volUid, dueAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    const id = created.body.id;
    expect(await remindDueTasks(E)).toBe(1);
    expect(await remindDueTasks(E)).toBe(0);
    expect((await outboxWhere("task_reminder"))[0]?.to.uid).toBe(volUid);

    expect((await api().patch(`/api/admin/events/${E}/tasks/${id}`).set(bearer(vol)).send({ status: "done" })).status).toBe(200);
    expect((await api().patch(`/api/admin/events/${E}/tasks/${id}`).set(bearer(vol)).send({ assignedTo: "someone" })).status).toBe(403);
    const mine = await api().get(`/api/admin/events/${E}/tasks`).set(bearer(vol));
    expect(mine.body.items.map((t: { status: string }) => t.status)).toEqual(["done"]);
  });

  it("tickets: a volunteer claims and resolves; nobody else can steal it", async () => {
    const ref = col(E, "tickets").doc("tk1");
    await ref.set({ createdBy: "a1", text: "Wi-Fi down", status: "open", createdAt: Timestamp.now() });
    expect((await api().post(`/api/admin/events/${E}/tickets/tk1/assign`).set(bearer(vol)).send({ assignedTo: volUid })).status).toBe(200);
    const other = await tokenFor("vol2", { role: "volunteer", eventId: E });
    expect((await api().post(`/api/admin/events/${E}/tickets/tk1/assign`).set(bearer(other)).send({ assignedTo: "vol2" })).status).toBe(409);
    expect((await api().post(`/api/admin/events/${E}/tickets/tk1/resolve`).set(bearer(other)).send({ resolution: "x" })).status).toBe(403);
    expect((await api().post(`/api/admin/events/${E}/tickets/tk1/resolve`).set(bearer(vol)).send({ resolution: "Restarted the router" })).status).toBe(200);
    expect((await ref.get()).get("status")).toBe("resolved");
  });

  it("food stats count claims per meal", async () => {
    const res = await api().get(`/api/admin/events/${E}/food/stats`).set(bearer(org));
    expect(res.body.items).toEqual([{ mealId: "lunch-1", name: "Lunch", claimed: 1 }]);
    await eventRef(E).get();
  });
});
