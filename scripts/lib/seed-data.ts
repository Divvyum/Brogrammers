import { FieldValue, Timestamp, type BulkWriter } from "firebase-admin/firestore";
import { COL, DOC, eventPath } from "@hackos/shared";
import {
  encrypt,
  hashEmail,
  hashPhone,
  lookupHash,
  normalizeEmail,
  normalizePhone,
} from "../../apps/server/src/core/crypto.js";
import { auth, db } from "../../apps/server/src/core/firebase.js";
import { stats } from "../../apps/server/src/core/stats.js";
import { seedExtras } from "./seed-extras.js";

// Realistic seed data for the emulator (plan D7): 1 event, 200 participants
// (with planted duplicates and ineligible people), 50 teams, 10 rooms,
// 6 arrival slots, 5 mentors, 5 judges, 10 volunteers, a rubric and sample
// submissions pointing at real public GitHub repos. Deterministic: the same
// seed number always produces the same data.

export const SEED_EVENT_CODE = "HACK26";

/**
 * Mock profile photo: a generated initials avatar (200×200 PNG, ~5 KB), the size
 * the roster expects. Real photos come from Cloudinary uploads in Phase 2.
 */
export const mockPhotoUrl = (name: string) =>
  `https://api.dicebear.com/9.x/initials/png?seed=${encodeURIComponent(name)}&size=200`;
const PASSWORD = "hackos-dev-123";

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
    sample: <T>(xs: readonly T[], n: number) => [...xs].sort(() => next() - 0.5).slice(0, n),
  };
}

const FIRST = [
  "Aarav",
  "Vivaan",
  "Aditya",
  "Vihaan",
  "Arjun",
  "Sai",
  "Reyansh",
  "Krishna",
  "Ishaan",
  "Rohan",
  "Ananya",
  "Diya",
  "Saanvi",
  "Aadhya",
  "Kavya",
  "Isha",
  "Meera",
  "Priya",
  "Riya",
  "Sneha",
  "Neha",
  "Pooja",
  "Kunal",
  "Rahul",
  "Siddharth",
  "Tanvi",
  "Nikhil",
  "Aman",
  "Divya",
  "Harsh",
  "Manav",
  "Zoya",
  "Farhan",
  "Sara",
  "Kabir",
  "Tara",
  "Yash",
  "Anika",
  "Dev",
  "Nisha",
] as const;
const LAST = [
  "Sharma",
  "Verma",
  "Patel",
  "Iyer",
  "Nair",
  "Reddy",
  "Gupta",
  "Mehta",
  "Joshi",
  "Kulkarni",
  "Desai",
  "Shah",
  "Rao",
  "Singh",
  "Khan",
  "Das",
  "Bose",
  "Chatterjee",
  "Pillai",
  "Menon",
  "Bhat",
  "Kapoor",
  "Malhotra",
  "Agarwal",
  "Jain",
] as const;
export const SEED_COLLEGES = [
  "SAKEC",
  "VJTI",
  "SPIT",
  "DJSCE",
  "KJSCE",
  "TSEC",
  "VESIT",
  "Thadomal",
] as const;
const OTHER_COLLEGES = ["Unknown Institute", "Night School of Tech"] as const;
const CITIES = ["Mumbai", "Pune", "Nashik", "Thane", "Navi Mumbai", "Nagpur"] as const;
const SKILLS = [
  "react",
  "node",
  "python",
  "ml",
  "design",
  "flutter",
  "android",
  "devops",
  "solidity",
  "data",
  "ui",
  "backend",
  "firebase",
  "go",
] as const;
export const SEED_TRACKS = ["AI", "FinTech", "HealthTech", "Open"] as const;
const TEAM_WORDS = [
  "Byte",
  "Null",
  "Pixel",
  "Quantum",
  "Stack",
  "Lambda",
  "Async",
  "Kernel",
  "Vector",
  "Neon",
  "Cipher",
  "Echo",
  "Delta",
  "Orbit",
  "Flux",
] as const;
const TEAM_WORDS_2 = [
  "Busters",
  "Pointers",
  "Ninjas",
  "Wizards",
  "Hackers",
  "Coders",
  "Builders",
  "Crew",
  "Squad",
  "Labs",
] as const;

// Small, well-known public repos (fast to fetch) for GitHub insights (D23).
const PUBLIC_REPOS = [
  "https://github.com/sindresorhus/is-online",
  "https://github.com/tj/commander.js",
  "https://github.com/chalk/chalk",
  "https://github.com/expressjs/cors",
  "https://github.com/lukeed/clsx",
  "https://github.com/ai/nanoid",
  "https://github.com/jshttp/http-errors",
  "https://github.com/sindresorhus/ky",
  "https://github.com/pillarjs/path-to-regexp",
  "https://github.com/motdotla/dotenv",
] as const;

export interface SeedSummary {
  eventId: string;
  eventCode: string;
  participants: number;
  teams: number;
  plantedDuplicates: { kind: string; uids: [string, string] }[];
  ineligible: { uid: string; why: string }[];
  staff: { role: string; email: string; uid: string; pin?: string }[];
  password: string;
  /** The judge who scores 3 points lower than everyone else (D24 outlier). */
  harshJudge: string;
}

/** Wipes the emulators. Refuses to touch a real project. */
export async function resetEmulators(projectId: string) {
  const fs = process.env.FIRESTORE_EMULATOR_HOST;
  const au = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!fs || !au) throw new Error("resetEmulators only runs against the emulators");
  await fetch(`http://${fs}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
    method: "DELETE",
  });
  await fetch(`http://${au}/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
}

/**
 * Gives a seeded account a Google identity too, so it shows up in the Auth
 * emulator's "Sign in with Google" picker (the emulator has no real Google).
 */
async function linkGoogle(uid: string, email: string, displayName: string) {
  const user = await auth.getUser(uid);
  if (user.providerData.some((p) => p.providerId === "google.com")) return;
  await auth.updateUser(uid, { providerToLink: { providerId: "google.com", uid: `google-${email}`, email, displayName } });
}

/** The super admin from SUPERADMIN_EMAIL, so the real owner can sign in locally with "Google". */
async function superAdmin(w: BulkWriter) {
  const email = process.env.SUPERADMIN_EMAIL;
  if (!email) return null;
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email, password: PASSWORD, displayName: email.split("@")[0], emailVerified: true });
  }
  await linkGoogle(user.uid, email, user.displayName ?? email);
  await auth.setCustomUserClaims(user.uid, { role: "superadmin", eventId: "*" });
  w.set(db.collection(COL.users).doc(user.uid), {
    name: user.displayName ?? email,
    role: "superadmin",
    eventId: "*",
    emailHash: hashEmail(email),
    emailEnc: encrypt(email),
    skills: [],
  });
  return { role: "superadmin", email, uid: user.uid };
}

async function staffUser(
  role: string,
  email: string,
  name: string,
  eventId: string,
  w: BulkWriter,
  extra: Record<string, unknown> = {},
) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({
      email,
      password: PASSWORD,
      displayName: name,
      emailVerified: true,
    });
  }
  await linkGoogle(user.uid, email, name);
  await auth.setCustomUserClaims(user.uid, { role, eventId });
  w.set(db.collection(COL.users).doc(user.uid), {
    name,
    role,
    eventId,
    emailHash: hashEmail(email),
    emailEnc: encrypt(email),
    skills: [],
    disabled: false,
    ...extra,
  });
  return user.uid;
}

export async function seed(opts: { seed?: number; now?: Date } = {}): Promise<SeedSummary> {
  const r = rng(opts.seed ?? 2026);
  const now = opts.now ?? new Date();
  const day = 24 * 60 * 60_000;
  const at = (ms: number) => Timestamp.fromMillis(now.getTime() + ms);

  // ---------- event ----------
  const eventRef = db.collection(COL.events).doc();
  const eventId = eventRef.id;
  const startAt = now.getTime() + 7 * day;
  const w = db.bulkWriter();
  w.set(eventRef, {
    name: "HACKOS Demo Hackathon 2026",
    code: SEED_EVENT_CODE,
    mode: "offline",
    startAt: at(7 * day),
    endAt: at(9 * day),
    teamMin: 2,
    teamMax: 4,
    tracks: [...SEED_TRACKS],
    rounds: [
      {
        id: "r1",
        name: "Final judging",
        startAt: at(9 * day - 6 * 3600_000),
        endAt: at(9 * day - 2 * 3600_000),
      },
    ],
    eligibilityRules: {
      allowedYears: [1, 2, 3, 4],
      allowedColleges: [...SEED_COLLEGES],
      requiredFields: ["college", "city"],
    },
    deadlines: { teamLock: at(5 * day), submission: at(9 * day - 8 * 3600_000) },
    leaderboardVisible: false,
    rosterVersion: 1,
  });
  w.set(db.doc(DOC.liveStats(eventId)), stats.initial());
  w.set(db.doc(DOC.rubric(eventId)), {
    criteria: [
      { id: "innovation", name: "Innovation", weight: 30, max: 10 },
      { id: "execution", name: "Execution", weight: 30, max: 10 },
      { id: "impact", name: "Impact", weight: 25, max: 10 },
      { id: "presentation", name: "Presentation", weight: 15, max: 10 },
    ],
  });

  // ---------- rooms (216 seats) and slots ----------
  const roomIds: string[] = [];
  const rooms = [
    ...SEED_TRACKS.flatMap((track, i) => [
      {
        name: `${String.fromCharCode(65 + i)}101`,
        floor: "1",
        capacity: 24,
        track,
        mentorDesk: true,
      },
      {
        name: `${String.fromCharCode(65 + i)}102`,
        floor: "1",
        capacity: 24,
        track,
        mentorDesk: false,
      },
    ]),
    { name: "Hall-1", floor: "G", capacity: 12, mentorDesk: false },
    { name: "Hall-2", floor: "G", capacity: 12, mentorDesk: false },
  ];
  for (const room of rooms) {
    const ref = db.collection(eventPath(eventId, "rooms")).doc();
    roomIds.push(ref.id);
    w.set(ref, { ...room, occupied: 0 });
  }
  const slotIds: string[] = [];
  const slotDocs: { ref: FirebaseFirestore.DocumentReference; doc: Record<string, unknown> }[] = [];
  for (let i = 0; i < 6; i++) {
    const ref = db.collection(eventPath(eventId, "slots")).doc(`slot${i + 1}`);
    slotIds.push(ref.id);
    const s = startAt - 3 * 3600_000 + i * 30 * 60_000; // every 30 minutes from 3h before start
    slotDocs.push({
      ref,
      doc: {
        startAt: Timestamp.fromMillis(s),
        endAt: Timestamp.fromMillis(s + 30 * 60_000),
        capacity: 40,
        booked: 0,
      },
    });
  }

  // ---------- staff ----------
  const staff: SeedSummary["staff"] = [];
  const add = async (role: string, i: number, extra: Record<string, unknown> = {}) => {
    const email = `${role}${i}@hackos.test`;
    const uid = await staffUser(
      role,
      email,
      `${role[0]!.toUpperCase()}${role.slice(1)} ${i}`,
      eventId,
      w,
      extra,
    );
    staff.push({ role, email, uid });
    return uid;
  };
  const sa = await superAdmin(w);
  if (sa) staff.push(sa);
  await add("organizer", 1);
  const mentors = [];
  for (let i = 1; i <= 5; i++) mentors.push(await add("mentor", i));
  const judges = [];
  for (let i = 1; i <= 5; i++) judges.push(await add("judge", i));
  for (let i = 1; i <= 10; i++) {
    const pin = String(100000 + i); // 100001 … 100010 (dev only)
    const key = lookupHash(`pin:${eventId}:${pin}`);
    const uid = await add("volunteer", i, { pinKey: key });
    w.set(db.collection(eventPath(eventId, "volunteerPins")).doc(key), {
      uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    staff[staff.length - 1]!.pin = pin;
  }

  // ---------- participants ----------
  // 180 in 50 teams (30 of 4, 20 of 3) + 20 solo; some planted problems.
  const teamSizes = [...Array(30).fill(4), ...Array(20).fill(3)] as number[];
  const ineligible: SeedSummary["ineligible"] = [];
  let n = 0;
  const makePerson = (teamIdx: number | null) => {
    n++;
    const first = r.pick(FIRST);
    const last = r.pick(LAST);
    let college: string = r.pick(SEED_COLLEGES);
    let year: number | undefined = r.int(1, 4);
    let city: string | undefined = r.pick(CITIES);
    const uid = `p${String(n).padStart(3, "0")}`;
    // Planted eligibility problems.
    if (n % 41 === 0) {
      year = 5;
      ineligible.push({ uid, why: "year 5 → rejected" });
    } else if (n % 53 === 0) {
      college = r.pick(OTHER_COLLEGES);
      ineligible.push({ uid, why: "college not on list → flagged" });
    } else if (n % 67 === 0) {
      city = undefined;
      ineligible.push({ uid, why: "missing city → flagged" });
    }
    return { uid, name: `${first} ${last}`, first, last, college, year, city, teamIdx };
  };

  const all: ReturnType<typeof makePerson>[] = [];
  teamSizes.forEach((size, t) => {
    for (let k = 0; k < size; k++) all.push(makePerson(t));
  });
  for (let k = 0; k < 20; k++) all.push(makePerson(null));

  // Stable participant login for the local participant dashboard.
  const demoParticipant = all[0]!;
  const demoEmail = "participant@hackos.test";
  await auth
    .createUser({
      uid: demoParticipant.uid,
      email: demoEmail,
      password: PASSWORD,
      displayName: demoParticipant.name,
      emailVerified: true,
    })
    .catch(async () => {
      const existing = await auth.getUser(demoParticipant.uid);
      await auth.updateUser(existing.uid, {
        email: demoEmail,
        password: PASSWORD,
        displayName: demoParticipant.name,
        emailVerified: true,
      });
    });
  await auth.setCustomUserClaims(demoParticipant.uid, { role: "participant", eventId });

  // Planted duplicates: 4 fuzzy (typo'd name, same college, new phone/email) and
  // 2 with the same email (as if imported before uniqueness checks existed).
  const plantedDuplicates: SeedSummary["plantedDuplicates"] = [];
  const solos = all.filter((p) => p.teamIdx === null);
  for (let k = 0; k < 6; k++) {
    const original = all[k * 23 + 5]!;
    const dup = solos[k]!;
    const typo = k % 2 ? original.name.replace(/a/, "aa") : original.name.replace(/(\w)$/, "$1h");
    Object.assign(dup, {
      name: typo,
      college: original.college,
      year: original.year,
      city: original.city,
    });
    plantedDuplicates.push({ kind: k < 4 ? "fuzzy" : "email", uids: [original.uid, dup.uid] });
  }
  const sameEmailAs = new Map(
    plantedDuplicates.filter((d) => d.kind === "email").map((d) => [d.uids[1], d.uids[0]]),
  );

  const emailOf = (p: (typeof all)[number]) =>
    `${p.first}.${p.last}.${p.uid}@students.test`.toLowerCase();
  const phoneOf = (i: number) => `98${String(20000000 + i * 7919).slice(-8)}`;

  const teamIds = teamSizes.map((_, t) => `team${String(t + 1).padStart(2, "0")}`);
  const teamTracks = teamSizes.map(() => r.pick(SEED_TRACKS));
  const teamSlots = teamSizes.map((_, t) => slotIds[t % slotIds.length]!);
  const registeredBase = now.getTime() - 20 * day;

  all.forEach((p, i) => {
    const email = sameEmailAs.has(p.uid)
      ? emailOf(all.find((x) => x.uid === sameEmailAs.get(p.uid))!)
      : emailOf(p);
    const phone = phoneOf(i);
    const skills = r.sample(SKILLS, r.int(2, 4));
    const teamId = p.teamIdx === null ? undefined : teamIds[p.teamIdx];
    const track = p.teamIdx === null ? r.pick(SEED_TRACKS) : teamTracks[p.teamIdx];
    const isSolo = p.teamIdx === null;
    const soloIdx = isSolo ? solos.indexOf(p) : -1;

    w.set(db.collection(COL.users).doc(p.uid), {
      name: p.name,
      emailHash: hashEmail(email),
      emailEnc: encrypt(normalizeEmail(email)),
      phoneHash: hashPhone(phone),
      phoneEnc: encrypt(normalizePhone(phone)),
      college: p.college,
      year: p.year,
      city: p.city,
      skills,
      githubUsername: `${p.first}${p.last}${i}`.toLowerCase(),
      photoUrl: mockPhotoUrl(p.name),
      role: "participant",
      eventId,
    });
    if (!sameEmailAs.has(p.uid)) {
      w.set(db.doc(DOC.uniqueKey("email", hashEmail(email))), {
        uid: p.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    w.set(db.doc(DOC.uniqueKey("phone", hashPhone(phone))), {
      uid: p.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    const doc: Record<string, unknown> = {
      name: p.name,
      college: p.college,
      registeredAt: Timestamp.fromMillis(registeredBase + i * 3600_000),
      status: "registered",
      track,
      rosterVersion: 1,
      // Solos 6+ (not the planted duplicates) book slots and open themselves to replacement.
      slotId: isSolo
        ? soloIdx >= 6
          ? slotIds[soloIdx % slotIds.length]
          : undefined
        : teamSlots[p.teamIdx!],
    };
    if (teamId) doc.teamId = teamId;
    if (isSolo && soloIdx >= 6 && soloIdx < 14) {
      doc.openToReplacement = { on: true, skills, availability: "Full event" };
    }
    w.set(db.collection(eventPath(eventId, "participants")).doc(p.uid), doc);

    // Solos 14–19 are on the waitlist.
    if (isSolo && soloIdx >= 14) {
      w.set(db.collection(eventPath(eventId, "waitlist")).doc(p.uid), {
        position: soloIdx - 13,
        eligible: true,
        status: "waiting",
        registeredAt: Timestamp.fromMillis(registeredBase + i * 3600_000),
      });
    }
  });

  // ---------- teams ----------
  teamSizes.forEach((_, t) => {
    const members = all.filter((p) => p.teamIdx === t).map((p) => p.uid);
    w.set(db.collection(eventPath(eventId, "teams")).doc(teamIds[t]!), {
      name: `${TEAM_WORDS[t % TEAM_WORDS.length]} ${TEAM_WORDS_2[Math.floor(t / TEAM_WORDS.length) % TEAM_WORDS_2.length]}`,
      inviteCode: `T${String(t + 1).padStart(2, "0")}${r.int(1000, 9999)}`,
      leaderUid: members[0],
      memberUids: members,
      track: teamTracks[t],
      status: "forming",
      repoUrl: t < PUBLIC_REPOS.length ? PUBLIC_REPOS[t] : undefined,
    });
  });

  // Slot booking counts.
  const booked = new Map<string, number>();
  all.forEach((p) => {
    const slot = p.teamIdx === null ? undefined : teamSlots[p.teamIdx];
    if (slot) booked.set(slot, (booked.get(slot) ?? 0) + 1);
  });
  solos.forEach((p, k) => {
    if (k >= 6)
      booked.set(slotIds[k % slotIds.length]!, (booked.get(slotIds[k % slotIds.length]!) ?? 0) + 1);
    void p;
  });
  for (const { ref, doc } of slotDocs) w.set(ref, { ...doc, booked: booked.get(ref.id) ?? 0 });

  PUBLIC_REPOS.forEach((repoUrl, t) => {
    const teamId = teamIds[t]!;
    const sub = {
      repoUrl,
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      submittedAt: at(9 * day - 9 * 3600_000),
      version: 1,
      receiptId: `RCPT-${teamId.toUpperCase()}-1`,
    };
    w.set(db.collection(eventPath(eventId, "submissions")).doc(teamId), sub);
    w.set(
      db.collection(eventPath(eventId, "submissions")).doc(teamId).collection("versions").doc("1"),
      sub,
    );
  });

  await w.close();
  const { harshJudge } = await seedExtras({
    eventId,
    startAt,
    tracks: SEED_TRACKS,
    teamIds,
    teamTracks,
    mentors,
    judges,
    volunteers: staff.filter((x) => x.role === "volunteer").map((x) => x.uid),
    participants: all.map((p) => p.uid),
    rnd: r.next,
  });
  await stats.recompute(eventId);

  return {
    eventId,
    eventCode: SEED_EVENT_CODE,
    participants: all.length,
    teams: teamSizes.length,
    plantedDuplicates,
    ineligible,
    staff,
    password: PASSWORD,
    harshJudge,
  };
}
