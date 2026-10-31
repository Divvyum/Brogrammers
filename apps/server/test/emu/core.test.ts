import { beforeAll, describe, expect, it } from "vitest";
import { DOC } from "@hackos/shared";
import { db } from "../../src/core/firebase.js";
import { api, auditFor, bearer, eventBody, resetEmulators, tokenFor } from "./helpers.js";

// D3 (server skeleton) and D6 (event setup).

let superToken: string;

beforeAll(async () => {
  await resetEmulators();
  superToken = await tokenFor("super1", { role: "superadmin", eventId: "*" });
});

describe("D3: auth, roles and audit", () => {
  it("health is public", async () => {
    const res = await api().get("/api/public/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", firestore: "ok" });
  });

  it("rejects a request without a token", async () => {
    const res = await api().get("/api/admin/events");
    expect(res.status).toBe(401);
  });

  it("rejects a garbage token", async () => {
    const res = await api().get("/api/admin/events").set(bearer("not-a-token"));
    expect(res.status).toBe(401);
  });

  it("rejects an account with no role", async () => {
    const res = await api().get("/api/admin/events").set(bearer(await tokenFor("norole", { role: "", eventId: "" })));
    expect(res.status).toBe(403);
  });

  it("rejects the wrong role", async () => {
    const vol = await tokenFor("vol-core", { role: "volunteer", eventId: "e1" });
    const res = await api().post("/api/admin/events").set(bearer(vol)).send(eventBody());
    expect(res.status).toBe(403);
  });

  it("rejects an organizer acting on another event", async () => {
    const org = await tokenFor("org-other", { role: "organizer", eventId: "some-other-event" });
    const created = await api().post("/api/admin/events").set(bearer(superToken)).send(eventBody());
    const res = await api().get(`/api/admin/events/${created.body.id}/participants`).set(bearer(org));
    expect(res.status).toBe(403);
  });

  it("validates request bodies", async () => {
    const res = await api().post("/api/admin/events").set(bearer(superToken)).send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION");
  });
});

describe("D6: event setup", () => {
  it("creates an event with its stats document and an audit entry", async () => {
    const res = await api().post("/api/admin/events").set(bearer(superToken)).send(eventBody({ code: "CORE26" }));
    expect(res.status).toBe(201);
    const eventId = res.body.id as string;
    expect(res.body.startAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // Timestamps go out as ISO strings
    expect((await db.doc(DOC.liveStats(eventId)).get()).exists).toBe(true);
    expect(await auditFor(eventId, "event.create")).toHaveLength(1);
  });

  it("rejects a duplicate event code", async () => {
    const res = await api().post("/api/admin/events").set(bearer(superToken)).send(eventBody({ code: "CORE26" }));
    expect(res.status).toBe(409);
  });

  it("lets the organizer edit their event and audits it", async () => {
    const created = await api().post("/api/admin/events").set(bearer(superToken)).send(eventBody());
    const eventId = created.body.id as string;
    const org = await tokenFor("org-core", { role: "organizer", eventId });
    const res = await api().patch(`/api/admin/events/${eventId}`).set(bearer(org)).send({ teamMax: 5 });
    expect(res.status).toBe(200);
    expect(res.body.teamMax).toBe(5);
    expect(await auditFor(eventId, "event.update")).toHaveLength(1);

    const bad = await api().patch(`/api/admin/events/${eventId}`).set(bearer(org)).send({ teamMin: 9 });
    expect(bad.status).toBe(409);
  });
});
