import { beforeAll, describe, expect, it } from "vitest";
import { auth } from "../../src/core/firebase.js";
import { api, auditFor, bearer, eventBody, idTokenFromCustomToken, resetEmulators, tokenFor } from "./helpers.js";

// D5: staff and roles.

let superToken: string;
let orgToken: string;
let eventId: string;
let eventCode: string;

beforeAll(async () => {
  await resetEmulators();
  superToken = await tokenFor("super1", { role: "superadmin", eventId: "*" });
  const body = eventBody();
  eventCode = body.code;
  eventId = (await api().post("/api/admin/events").set(bearer(superToken)).send(body)).body.id;
});

/** Claims as they appear in a fresh ID token after signing in. */
async function claimsOf(uid: string) {
  const token = await idTokenFromCustomToken(await auth.createCustomToken(uid));
  return auth.verifyIdToken(token);
}

describe("D5: staff and roles", () => {
  it("super admin creates an organizer, whose claims are set", async () => {
    const res = await api()
      .post("/api/admin/staff")
      .set(bearer(superToken))
      .send({ email: "org@hackos.test", name: "Org", role: "organizer", eventId });
    expect(res.status).toBe(201);
    const claims = await claimsOf(res.body.uid);
    expect(claims).toMatchObject({ role: "organizer", eventId });
    orgToken = await idTokenFromCustomToken(await auth.createCustomToken(res.body.uid));
  });

  it("organizer creates volunteer, mentor and judge in their own event", async () => {
    for (const role of ["volunteer", "mentor", "judge"]) {
      const res = await api()
        .post("/api/admin/staff")
        .set(bearer(orgToken))
        .send({ email: `${role}@hackos.test`, name: role, role });
      expect(res.status).toBe(201);
      expect(await claimsOf(res.body.uid)).toMatchObject({ role, eventId });
    }
    expect(await auditFor(eventId, "staff.create")).toHaveLength(4);
  });

  it("organizer cannot create an organizer or staff for another event", async () => {
    const a = await api().post("/api/admin/staff").set(bearer(orgToken)).send({ email: "x@hackos.test", name: "X", role: "organizer" });
    expect(a.status).toBe(403);
    const b = await api()
      .post("/api/admin/staff")
      .set(bearer(orgToken))
      .send({ email: "y@hackos.test", name: "Y", role: "judge", eventId: "other" });
    expect(b.status).toBe(403);
  });

  it("lists staff with decrypted emails for the organizer", async () => {
    const res = await api().get("/api/admin/staff").set(bearer(orgToken));
    expect(res.status).toBe(200);
    expect(res.body.items.map((s: { email: string }) => s.email).sort()).toEqual(
      ["judge@hackos.test", "mentor@hackos.test", "org@hackos.test", "volunteer@hackos.test"],
    );
  });

  it("changes a role (audited) and the new claim applies", async () => {
    const mentor = (await auth.getUserByEmail("mentor@hackos.test")).uid;
    const res = await api().patch(`/api/admin/staff/${mentor}/role`).set(bearer(orgToken)).send({ role: "judge", reason: "Needed more judges" });
    expect(res.status).toBe(200);
    expect(await claimsOf(mentor)).toMatchObject({ role: "judge" });
    const [entry] = await auditFor(eventId, "staff.role");
    expect(entry).toMatchObject({ before: { role: "mentor" }, after: { role: "judge" }, reason: "Needed more judges" });
  });

  it("issues a volunteer PIN that logs in to the scanner with volunteer claims", async () => {
    const vol = (await auth.getUserByEmail("volunteer@hackos.test")).uid;
    const pinRes = await api().post(`/api/admin/staff/${vol}/pin`).set(bearer(orgToken));
    expect(pinRes.status).toBe(200);
    expect(pinRes.body.pin).toMatch(/^\d{6}$/);

    const login = await api().post("/api/admin/auth/volunteer-login").send({ eventCode, pin: pinRes.body.pin });
    expect(login.status).toBe(200);
    const claims = await auth.verifyIdToken(await idTokenFromCustomToken(login.body.token));
    expect(claims).toMatchObject({ uid: vol, role: "volunteer", eventId });

    const wrongPin = pinRes.body.pin === "000000" ? "111111" : "000000";
    const wrong = await api().post("/api/admin/auth/volunteer-login").send({ eventCode, pin: wrongPin });
    expect(wrong.status).toBe(401);

    // A new PIN replaces the old one (they differ unless the 1-in-a-million repeat happens).
    const again = await api().post(`/api/admin/staff/${vol}/pin`).set(bearer(orgToken));
    if (again.body.pin !== pinRes.body.pin) {
      const old = await api().post("/api/admin/auth/volunteer-login").send({ eventCode, pin: pinRes.body.pin });
      expect(old.status).toBe(401);
    }
  });

  it("a disabled volunteer can't log in", async () => {
    const vol = (await auth.getUserByEmail("volunteer@hackos.test")).uid;
    const { pin } = (await api().post(`/api/admin/staff/${vol}/pin`).set(bearer(orgToken))).body;
    const dis = await api().post(`/api/admin/staff/${vol}/disable`).set(bearer(orgToken)).send({ reason: "Left the event" });
    expect(dis.status).toBe(200);
    const login = await api().post("/api/admin/auth/volunteer-login").send({ eventCode, pin });
    expect(login.status).toBe(401);
    expect((await auth.getUser(vol)).disabled).toBe(true);
  });
});
