import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

// D4: Firestore Security Rules, allowed and denied cases per role.

let testEnv: RulesTestEnvironment;
const E = "evt1";

const as = (uid: string, role: string, eventId = E) =>
  testEnv.authenticatedContext(uid, { role, eventId }).firestore();

const checkin = (volunteerUid: string, extra: Record<string, unknown> = {}) => ({
  participantId: "p1",
  deviceId: "vd1",
  volunteerUid,
  ts: new Date().toISOString(),
  method: "qr",
  result: "valid",
  prevHash: "GENESIS",
  entryHash: "abc",
  processed: false,
  flagged: false,
  ...extra,
});

beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":");
  testEnv = await initializeTestEnvironment({
    projectId: "demo-hackos-rules",
    firestore: {
      host,
      port: Number(port),
      rules: readFileSync(fileURLToPath(new URL("../../../../firebase/firestore.rules", import.meta.url)), "utf8"),
    },
  });
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `events/${E}`), { name: "Evt", leaderboardVisible: false });
    await setDoc(doc(db, `events/${E}/participants/p1`), { name: "P One" });
    await setDoc(doc(db, `events/${E}/participants/p2`), { name: "P Two" });
    await setDoc(doc(db, `events/${E}/teams/t1`), { memberUids: ["p1"] });
    await setDoc(doc(db, `events/${E}/teams/t2`), { memberUids: ["p2"] });
    await setDoc(doc(db, `events/${E}/judgeAssignments/judge1`), { teamIds: ["t1"] });
    await setDoc(doc(db, `events/${E}/submissions/t1`), { repoUrl: "x" });
    await setDoc(doc(db, `events/${E}/submissions/t2`), { repoUrl: "y" });
    await setDoc(doc(db, `events/${E}/scores/judge1_t1`), { total: 1 });
    await setDoc(doc(db, `events/${E}/scores/judge2_t1`), { total: 2 });
    await setDoc(doc(db, `events/${E}/stats/live`), { registrations: 1 });
    await setDoc(doc(db, `events/${E}/leaderboard/current`), { teams: [] });
    await setDoc(doc(db, `events/${E}/audit/a1`), { action: "x" });
    await setDoc(doc(db, `events/${E}/checkins/c1`), checkin("vol1"));
    await setDoc(doc(db, `events/${E}/problems/released`), { released: true });
    await setDoc(doc(db, `events/${E}/problems/hidden`), { released: false });
    await setDoc(doc(db, `events/${E}/announcements/an1`), { title: "Hi" });
    await setDoc(doc(db, `events/${E}/enrollTokens/tok`), { uid: "p1" });
    await setDoc(doc(db, `events/${E}/volunteerPins/pin`), { uid: "vol1" });
    await setDoc(doc(db, "outbox/m1"), { status: "queued" });
    await setDoc(doc(db, "users/p1"), { name: "P One", eventId: E });
    await setDoc(doc(db, "uniqueKeys/phone_x"), { uid: "p1" });
    // D16–D26 collections
    await setDoc(doc(db, `events/${E}/schedule/s1`), { title: "Opening" });
    await setDoc(doc(db, `events/${E}/mentorSlots/ms1`), { mentorUid: "mentor1" });
    await setDoc(doc(db, `events/${E}/mentorSlots/ms2`), { mentorUid: "mentor2" });
    await setDoc(doc(db, `events/${E}/tasks/t1`), { assignedTo: "vol1" });
    await setDoc(doc(db, `events/${E}/tasks/t2`), { assignedTo: "vol2" });
    await setDoc(doc(db, `events/${E}/rubric/current`), { criteria: [] });
    await setDoc(doc(db, `events/${E}/rewards/r1`), { prize: "x" });
    await setDoc(doc(db, `events/${E}/food/p1_lunch`), { uid: "p1" });
    await setDoc(doc(db, "templates/announcement"), { body: "x" });
    await setDoc(doc(db, "certificates/ABCDEFGHJKLM"), { uid: "p1" });
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe("anonymous", () => {
  it("can read nothing", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `events/${E}`)));
    await assertFails(getDoc(doc(db, `events/${E}/participants/p1`)));
    await assertFails(getDoc(doc(db, "outbox/m1")));
  });
});

describe("organizer", () => {
  it("reads event data, stats, audit and the outbox", async () => {
    const db = as("org1", "organizer");
    await assertSucceeds(getDoc(doc(db, `events/${E}/participants/p1`)));
    await assertSucceeds(getDoc(doc(db, `events/${E}/stats/live`)));
    await assertSucceeds(getDoc(doc(db, `events/${E}/audit/a1`)));
    await assertSucceeds(getDoc(doc(db, `events/${E}/checkins/c1`)));
    await assertSucceeds(getDoc(doc(db, "outbox/m1")));
  });

  it("cannot write server-only data or read secrets", async () => {
    const db = as("org1", "organizer");
    await assertFails(setDoc(doc(db, `events/${E}/stats/live`), { registrations: 999 }));
    await assertFails(setDoc(doc(db, `events/${E}/leaderboard/current`), { teams: [] }));
    await assertFails(setDoc(doc(db, `events/${E}/audit/a2`), { action: "forged" }));
    await assertFails(updateDoc(doc(db, `events/${E}/audit/a1`), { action: "edited" }));
    await assertFails(getDoc(doc(db, `events/${E}/enrollTokens/tok`)));
    await assertFails(getDoc(doc(db, `events/${E}/volunteerPins/pin`)));
    await assertFails(getDoc(doc(db, "uniqueKeys/phone_x")));
  });

  it("cannot read another event", async () => {
    const db = as("org2", "organizer", "evt2");
    await assertFails(getDoc(doc(db, `events/${E}`)));
    await assertFails(getDoc(doc(db, `events/${E}/participants/p1`)));
  });
});

describe("volunteer", () => {
  it("creates its own check-ins", async () => {
    await assertSucceeds(setDoc(doc(as("vol1", "volunteer"), `events/${E}/checkins/c2`), checkin("vol1")));
  });

  it("cannot create check-ins as someone else, pre-processed, or with extra fields", async () => {
    const db = as("vol1", "volunteer");
    await assertFails(setDoc(doc(db, `events/${E}/checkins/c3`), checkin("vol2")));
    await assertFails(setDoc(doc(db, `events/${E}/checkins/c4`), checkin("vol1", { processed: true })));
    await assertFails(setDoc(doc(db, `events/${E}/checkins/c5`), checkin("vol1", { serverResult: "official" })));
    await assertFails(setDoc(doc(db, `events/${E}/checkins/c6`), checkin("vol1", { method: "magic" })));
  });

  it("cannot edit or overwrite a check-in", async () => {
    const db = as("vol1", "volunteer");
    await assertFails(updateDoc(doc(db, `events/${E}/checkins/c1`), { result: "rejected" }));
    await assertFails(setDoc(doc(db, `events/${E}/checkins/c1`), checkin("vol1")));
  });

  it("reads its own check-ins but not stats, audit or participant records", async () => {
    const db = as("vol1", "volunteer");
    await assertSucceeds(getDoc(doc(db, `events/${E}/checkins/c1`)));
    await assertFails(getDoc(doc(as("vol2", "volunteer"), `events/${E}/checkins/c1`)));
    await assertFails(getDoc(doc(db, `events/${E}/stats/live`)));
    await assertFails(getDoc(doc(db, `events/${E}/audit/a1`)));
    await assertFails(getDoc(doc(db, `events/${E}/participants/p1`)));
  });

  it("can't create check-ins for another event", async () => {
    const db = as("vol9", "volunteer", "evt2");
    await assertFails(setDoc(doc(db, `events/${E}/checkins/c7`), checkin("vol9")));
  });
});

describe("judge", () => {
  it("reads only assigned teams and submissions", async () => {
    const db = as("judge1", "judge");
    await assertSucceeds(getDoc(doc(db, `events/${E}/teams/t1`)));
    await assertSucceeds(getDoc(doc(db, `events/${E}/submissions/t1`)));
    await assertFails(getDoc(doc(db, `events/${E}/teams/t2`)));
    await assertFails(getDoc(doc(db, `events/${E}/submissions/t2`)));
  });

  it("reads only their own scores", async () => {
    const db = as("judge1", "judge");
    await assertSucceeds(getDoc(doc(db, `events/${E}/scores/judge1_t1`)));
    await assertFails(getDoc(doc(db, `events/${E}/scores/judge2_t1`)));
  });

  it("a judge with no assignments sees no teams", async () => {
    await assertFails(getDoc(doc(as("judge9", "judge"), `events/${E}/teams/t1`)));
  });
});

describe("participant", () => {
  it("reads own record and own team only", async () => {
    const db = as("p1", "participant");
    await assertSucceeds(getDoc(doc(db, `events/${E}/participants/p1`)));
    await assertFails(getDoc(doc(db, `events/${E}/participants/p2`)));
    await assertSucceeds(getDoc(doc(db, `events/${E}/teams/t1`)));
    await assertFails(getDoc(doc(db, `events/${E}/teams/t2`)));
    await assertSucceeds(getDoc(doc(db, "users/p1")));
  });

  it("sees released problems only, and no hidden leaderboard", async () => {
    const db = as("p1", "participant");
    await assertSucceeds(getDoc(doc(db, `events/${E}/problems/released`)));
    await assertFails(getDoc(doc(db, `events/${E}/problems/hidden`)));
    await assertFails(getDoc(doc(db, `events/${E}/leaderboard/current`)));
  });

  it("marks an announcement seen only as themselves", async () => {
    const db = as("p1", "participant");
    await assertSucceeds(setDoc(doc(db, `events/${E}/announcements/an1/seen/p1`), { seenAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, `events/${E}/announcements/an1/seen/p2`), { seenAt: serverTimestamp() }));
  });

  it("cannot create check-ins or touch the outbox", async () => {
    const db = as("p1", "participant");
    await assertFails(setDoc(doc(db, `events/${E}/checkins/c9`), checkin("p1")));
    await assertFails(getDoc(doc(db, "outbox/m1")));
  });
});

describe("D29: collections added in D16–D26", () => {
  it("mentors read only their own calendar", async () => {
    const db = as("mentor1", "mentor");
    await assertSucceeds(getDoc(doc(db, `events/${E}/mentorSlots/ms1`)));
    await assertFails(getDoc(doc(db, `events/${E}/mentorSlots/ms2`)));
    await assertFails(setDoc(doc(db, `events/${E}/mentorSlots/ms1`), { mentorUid: "mentor1", notes: "x" }));
  });

  it("volunteers read only their own tasks, and nothing about food claims or rewards", async () => {
    const db = as("vol1", "volunteer");
    await assertSucceeds(getDoc(doc(db, `events/${E}/tasks/t1`)));
    await assertFails(getDoc(doc(db, `events/${E}/tasks/t2`)));
    await assertFails(getDoc(doc(db, `events/${E}/food/p1_lunch`)));
    await assertFails(setDoc(doc(db, `events/${E}/food/p2_lunch`), { uid: "p2" }));
    await assertFails(getDoc(doc(db, `events/${E}/rewards/r1`)));
  });

  it("participants see the schedule but not the rubric, rewards or templates", async () => {
    const db = as("p1", "participant");
    await assertSucceeds(getDoc(doc(db, `events/${E}/schedule/s1`)));
    await assertFails(getDoc(doc(db, `events/${E}/rubric/current`)));
    await assertFails(getDoc(doc(db, `events/${E}/rewards/r1`)));
    await assertFails(getDoc(doc(db, "templates/announcement")));
  });

  it("judges read the rubric; templates and certificates are off-limits to clients", async () => {
    await assertSucceeds(getDoc(doc(as("judge1", "judge"), `events/${E}/rubric/current`)));
    await assertSucceeds(getDoc(doc(as("org1", "organizer"), "templates/announcement")));
    await assertFails(setDoc(doc(as("org1", "organizer"), "templates/announcement"), { body: "hacked" }));
    await assertFails(getDoc(doc(as("p1", "participant"), "certificates/ABCDEFGHJKLM")));
  });
});
