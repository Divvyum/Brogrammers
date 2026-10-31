import { beforeAll, describe, expect, it } from "vitest";
import { COL } from "@hackos/shared";
import { allotOne } from "../../src/admin/allotment/allotment.service.js";
import { decrypt, hashPhone } from "../../src/core/crypto.js";
import { col } from "../../src/core/events.js";
import { db } from "../../src/core/firebase.js";
import { api, bearer, eventBody, resetEmulators, tokenFor } from "./helpers.js";

// D8 CSV import (uniqueKeys enforced) and D12 incremental allotment for late bookings.

let E: string;
let org: string;

beforeAll(async () => {
  await resetEmulators();
  const su = await tokenFor("super1", { role: "superadmin", eventId: "*" });
  E = (await api().post("/api/admin/events").set(bearer(su)).send(eventBody())).body.id;
  org = await tokenFor("org1", { role: "organizer", eventId: E });
});

const CSV = `name,email,phone,college,year,city,skills,githubUsername,track,teamName
Asha Rao,asha@x.test,+91 98200 00001,SAKEC,2,Mumbai,react;node,asharao,AI,Ctrl Alt Elite
Bilal Khan,bilal@x.test,9820000002,SAKEC,3,Mumbai,python|ml,bilalk,AI,Ctrl Alt Elite
Chitra Iyer,chitra@x.test,9820000003,VJTI,2,Pune,design,,Open,
Bad Row,not-an-email,123,,,,,,,
Dee Unknown,dee@x.test,9820000004,VJTI,2,Pune,,,Robotics,
`;

describe("D8: CSV import", () => {
  it("imports valid rows, reports bad ones with line numbers, and forms teams", async () => {
    const res = await api().post(`/api/admin/events/${E}/registrations/import`).set(bearer(org)).send({ csv: CSV });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(3);
    expect(res.body.teamsCreated).toBe(1);
    expect(res.body.errors).toEqual([
      { row: 5, message: expect.stringMatching(/email/) },
      { row: 6, message: 'Unknown track "Robotics"' },
    ]);

    const teams = await col(E, "teams").get();
    expect(teams.docs[0]!.get("name")).toBe("Ctrl Alt Elite");
    expect(teams.docs[0]!.get("memberUids")).toHaveLength(2);
  });

  it("stores contact details encrypted, with lookup hashes", async () => {
    const users = await db.collection(COL.users).where("phoneHash", "==", hashPhone("9820000001")).get();
    expect(users.size).toBe(1);
    const u = users.docs[0]!;
    expect(u.get("phoneEnc")).not.toContain("9820000001");
    expect(decrypt(u.get("phoneEnc"))).toBe("919820000001");
    expect(decrypt(u.get("emailEnc"))).toBe("asha@x.test");
    expect(u.get("skills")).toEqual(["react", "node"]);
  });

  it("blocks a second registration with the same phone or email", async () => {
    const again = `name,email,phone,college
Asha Again,asha.new@x.test,98200 00001,SAKEC
Bilal Again,bilal@x.test,9820000099,SAKEC
`;
    const res = await api().post(`/api/admin/events/${E}/registrations/import`).set(bearer(org)).send({ csv: again });
    expect(res.body.created).toBe(0);
    expect(res.body.errors.map((e: { message: string }) => e.message)).toEqual([
      "This phone number is already registered",
      "This email is already registered",
    ]);
  });
});

describe("D12: late booking (incremental allotment)", () => {
  it("seats a late booker next to their team, or in the best free room", async () => {
    const roomA = col(E, "rooms").doc("roomA");
    const roomB = col(E, "rooms").doc("roomB");
    await roomA.set({ name: "A1", floor: "1", capacity: 2, track: "AI", mentorDesk: true, occupied: 1 });
    await roomB.set({ name: "B1", floor: "1", capacity: 10, track: "Open", mentorDesk: false, occupied: 0 });

    const team = (await col(E, "teams").get()).docs[0]!;
    const [first, second] = team.get("memberUids") as string[];
    await col(E, "participants").doc(first!).update({ roomId: "roomA", seat: "A1-1" });

    expect(await allotOne(E, second!)).toEqual({ roomId: "roomA", seat: "A1-2" });
    expect((await roomA.get()).get("occupied")).toBe(2);

    const solo = (await col(E, "participants").where("track", "==", "Open").get()).docs[0]!;
    expect(await allotOne(E, solo.id)).toEqual({ roomId: "roomB", seat: "B1-1" });
    // Calling again doesn't move them.
    expect(await allotOne(E, solo.id)).toEqual({ roomId: "roomB", seat: "B1-1" });
  });
});
