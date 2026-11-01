import type { Router } from "express";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";
import { EventContent } from "@hackos/shared";
import { removeMemberTx } from "../admin/teams/membership.js";
import { param } from "../core/auth.js";
import { encrypt, hashEmail, normalizeEmail } from "../core/crypto.js";
import { col, getEvent } from "../core/events.js";
import { db } from "../core/firebase.js";
import { conflict, forbidden, notFound } from "../core/http.js";
import { parseBody } from "../core/validate.js";
import { matchTravelCircles } from "./circles.js";
import { joinTeam } from "./team.js";

// Participant routes the student app (AURA design) needs beyond the core ones in
// routes.ts: reads for every screen, profile edits, team leader actions,
// circles, complaints follow-up. Mounted on the participant router (the user
// is a signed-in participant; their event comes from their claims).

const mine = (req: Express.Request) => ({ eventId: req.user!.eventId, uid: req.user!.uid });
const data = (d: DocumentSnapshot) => ({ id: d.id, ...d.data() });
const participant = (eventId: string, uid: string) => col(eventId, "participants").doc(uid);

/** Names (and a few public fields) for a set of uids, from users/{uid}. */
async function people(uids: string[]) {
  const unique = [...new Set(uids.filter(Boolean))];
  if (!unique.length) return new Map<string, Record<string, unknown>>();
  const snaps = await db.getAll(...unique.map((u) => db.collection("users").doc(u)), {
    fieldMask: ["name", "college", "skills", "photoUrl", "githubUsername", "city", "year"],
  });
  return new Map(snaps.map((s) => [s.id, { uid: s.id, ...(s.data() ?? {}) }]));
}

export function registerPortalRoutes(r: Router) {
  // ---------- event and profile ----------

  r.get("/event", async (req, res) => {
    const e = await getEvent(mine(req).eventId);
    res.json({
      id: e.id,
      name: e.name,
      code: e.code,
      mode: e.mode,
      startAt: e.startAt,
      endAt: e.endAt,
      teamMin: e.teamMin,
      teamMax: e.teamMax,
      tracks: e.tracks,
      rounds: e.rounds ?? [],
      deadlines: e.deadlines,
      teamsLocked: Boolean(e.teamsLockedAt),
      submissionsLocked: Boolean(e.submissionsLocked) || Date.now() > e.deadlines.submission.toMillis(),
      leaderboardVisible: Boolean(e.leaderboardVisible),
      resultsPublishedAt: e.resultsPublishedAt ?? null,
      meals: e.meals ?? [],
      eligibilityRules: e.eligibilityRules ?? {},
      content: EventContent.parse(e.content ?? {}),
    });
  });

  /** Partial profile edit (Profile → Save changes). Email changes keep the one-account rule. */
  r.put("/profile", async (req, res) => {
    const { eventId, uid } = mine(req);
    const b = parseBody(
      req,
      z.object({
        name: z.string().trim().min(1).optional(),
        email: z.email().optional(),
        college: z.string().trim().min(1).optional(),
        year: z.number().int().min(1).max(8).optional(),
        city: z.string().trim().optional(),
        skills: z.array(z.string().trim().min(1)).max(30).optional(),
        githubUsername: z.string().trim().optional(),
        photoUrl: z.url().optional(),
        track: z.string().trim().optional(),
        notifications: z.record(z.string(), z.boolean()).optional(),
      }),
    );
    const { email, track, ...rest } = b;
    await db.runTransaction(async (tx) => {
      const p = await tx.get(participant(eventId, uid));
      const user: Record<string, unknown> = { ...rest };
      if (email) {
        const h = hashEmail(email);
        const key = db.collection("uniqueKeys").doc(`email_${h}`);
        const k = await tx.get(key);
        if (k.exists && k.get("uid") !== uid) throw conflict("That email belongs to another account");
        tx.set(key, { uid, createdAt: FieldValue.serverTimestamp() }, { merge: true });
        user.emailHash = h;
        user.emailEnc = encrypt(normalizeEmail(email));
      }
      tx.set(db.collection("users").doc(uid), user, { merge: true });
      if (p.exists) {
        const mirror: Record<string, unknown> = {};
        if (b.name) mirror.name = b.name;
        if (b.college) mirror.college = b.college;
        if (track) {
          if (p.get("teamId")) throw conflict("Your track follows your team");
          mirror.track = track;
        }
        if (Object.keys(mirror).length) tx.update(p.ref, mirror);
      }
    });
    res.json({ saved: true });
  });

  /** Rejected or flagged registration: ask the organizers to look again. */
  r.post("/registration/recheck", async (req, res) => {
    const { eventId, uid } = mine(req);
    const { reason } = parseBody(req, z.object({ reason: z.string().trim().min(3).max(1000) }));
    const ref = await col(eventId, "tickets").add({
      type: "recheck",
      createdBy: uid,
      text: `Eligibility re-check requested: ${reason}`,
      status: "open",
      createdAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: ref.id });
  });

  // ---------- team ----------

  /** My team with member details, pending requests and invitations to me. */
  r.get("/team", async (req, res) => {
    const { eventId, uid } = mine(req);
    const p = await participant(eventId, uid).get();
    const teamId = p.get("teamId") as string | undefined;
    const [invites, requests] = await Promise.all([
      col(eventId, "teamChangeRequests").where("uid", "==", uid).where("status", "==", "pending").get(),
      teamId ? col(eventId, "teamChangeRequests").where("teamId", "==", teamId).where("status", "==", "pending").get() : null,
    ]);
    if (!teamId) {
      res.json({ team: null, requests: [], invitations: invites.docs.map(data), openToReplacement: p.get("openToReplacement") ?? null });
      return;
    }
    const team = await col(eventId, "teams").doc(teamId).get();
    const members = (team.get("memberUids") as string[]) ?? [];
    const [names, regs] = await Promise.all([
      people(members),
      members.length ? db.getAll(...members.map((m) => participant(eventId, m))) : Promise.resolve([]),
    ]);
    const enrollment = new Map(regs.map((s) => [s.id, (s.get("enrollment") as { status?: string } | undefined)?.status ?? null]));
    res.json({
      team: {
        id: team.id,
        ...team.data(),
        members: members.map((m) => ({ ...(names.get(m) ?? { uid: m }), isLeader: m === team.get("leaderUid"), isMe: m === uid, enrollment: enrollment.get(m) ?? null })),
      },
      requests: requests?.docs.map(data) ?? [],
      invitations: invites.docs.map(data),
      openToReplacement: p.get("openToReplacement") ?? null,
    });
  });

  /** Team leader removes a member before the team lock. */
  r.delete("/teams/:teamId/members/:memberUid", async (req, res) => {
    const { eventId, uid } = mine(req);
    const teamId = param(req, "teamId");
    const memberUid = param(req, "memberUid");
    const team = await col(eventId, "teams").doc(teamId).get();
    if (!team.exists) throw notFound("Team");
    if (team.get("leaderUid") !== uid) throw forbidden("Only the team leader can remove members");
    if (memberUid === uid) throw conflict("Leave the team instead");
    await db.runTransaction(async (tx) => {
      const apply = await removeMemberTx(tx, eventId, teamId, memberUid);
      apply();
    });
    res.status(204).end();
  });

  /** Accept or decline a team leader's invitation (a pending "join" request with invitedBy). */
  r.post("/invitations/:id/:answer", async (req, res) => {
    const { eventId, uid } = mine(req);
    const answer = param(req, "answer");
    if (answer !== "accept" && answer !== "decline") throw notFound("Route");
    const ref = col(eventId, "teamChangeRequests").doc(param(req, "id"));
    const inv = await ref.get();
    if (!inv.exists || inv.get("uid") !== uid || !inv.get("invitedBy")) throw notFound("Invitation");
    if (inv.get("status") !== "pending") throw conflict("This invitation was already answered");
    if (answer === "accept") {
      const team = await col(eventId, "teams").doc(inv.get("teamId")).get();
      if (!team.exists) throw notFound("Team");
      await joinTeam(eventId, uid, team.get("inviteCode"));
    }
    await ref.update({ status: answer === "accept" ? "approved" : "rejected", decidedAt: FieldValue.serverTimestamp(), decidedBy: uid });
    res.json({ ok: true });
  });

  /** A replacement invitation or waitlist seat offer addressed to me, if any. */
  r.get("/offers", async (req, res) => {
    const { eventId, uid } = mine(req);
    const [reps, wait] = await Promise.all([
      col(eventId, "replacements").where("currentCandidate", "==", uid).get(),
      col(eventId, "waitlist").doc(uid).get(),
    ]);
    const live = reps.docs.filter((d) => ["invited", "waitlist"].includes(d.get("status")));
    const teams = await Promise.all(live.map((d) => col(eventId, "teams").doc(d.get("teamId")).get()));
    res.json({
      replacements: live.map((d, i) => ({
        id: d.id,
        status: d.get("status"),
        teamId: d.get("teamId"),
        teamName: teams[i]?.get("name") ?? d.get("teamId"),
        track: teams[i]?.get("track") ?? null,
        expiresAt: d.get("inviteExpiresAt") ?? null,
      })),
      waitlist: wait.exists ? data(wait) : null,
    });
  });

  // ---------- journey: slots, room, travel, circles ----------

  r.get("/slots", async (req, res) => {
    const { eventId } = mine(req);
    const s = await col(eventId, "slots").orderBy("startAt").get();
    res.json(s.docs.map((d) => ({ id: d.id, startAt: d.get("startAt"), endAt: d.get("endAt"), capacity: d.get("capacity"), booked: d.get("booked") ?? 0 })));
  });

  r.get("/room", async (req, res) => {
    const { eventId, uid } = mine(req);
    const p = await participant(eventId, uid).get();
    const roomId = p.get("roomId") as string | undefined;
    if (!roomId) {
      res.json(null);
      return;
    }
    const room = await col(eventId, "rooms").doc(roomId).get();
    res.json({ id: roomId, name: room.get("name"), floor: room.get("floor"), track: room.get("track") ?? null, mentorDesk: Boolean(room.get("mentorDesk")), seat: p.get("seat") ?? null });
  });

  r.get("/travel", async (req, res) => {
    const { eventId, uid } = mine(req);
    const t = await col(eventId, "travelPlans").doc(uid).get();
    res.json(t.exists ? data(t) : null);
  });

  /** Circles I'm in, with member names. */
  r.get("/circles", async (req, res) => {
    const { eventId, uid } = mine(req);
    const s = await col(eventId, "circles").where("members", "array-contains", uid).get();
    const names = await people(s.docs.flatMap((d) => d.get("members") as string[]));
    res.json(s.docs.map((d) => ({ ...data(d), memberDetails: (d.get("members") as string[]).map((m) => names.get(m) ?? { uid: m }) })));
  });

  /** Re-runs matching now (the cron also does every 30 minutes). */
  r.post("/circles/rematch", async (req, res) => {
    res.json({ groups: await matchTravelCircles(mine(req).eventId) });
  });

  r.get("/circles/:id/messages", async (req, res) => {
    const { eventId, uid } = mine(req);
    const c = col(eventId, "circles").doc(param(req, "id"));
    const snap = await c.get();
    if (!((snap.get("members") as string[]) ?? []).includes(uid)) throw forbidden();
    const m = await c.collection("messages").orderBy("createdAt", "desc").limit(100).get();
    const names = await people(m.docs.map((d) => d.get("uid")));
    res.json(m.docs.reverse().map((d) => ({ ...data(d), name: (names.get(d.get("uid")) as { name?: string } | undefined)?.name ?? "Someone", mine: d.get("uid") === uid })));
  });

  r.post("/circles/:id/leave", async (req, res) => {
    const { eventId, uid } = mine(req);
    await col(eventId, "circles").doc(param(req, "id")).update({ members: FieldValue.arrayRemove(uid) });
    res.status(204).end();
  });

  r.patch("/circles/:id", async (req, res) => {
    const { eventId, uid } = mine(req);
    const { meetupPoint } = parseBody(req, z.object({ meetupPoint: z.string().trim().min(2).max(200) }));
    const ref = col(eventId, "circles").doc(param(req, "id"));
    const snap = await ref.get();
    if (!((snap.get("members") as string[]) ?? []).includes(uid)) throw forbidden();
    await ref.update({ meetupPoint, meetupSetBy: uid });
    await ref.collection("messages").add({ uid, text: `Suggested meet-up point: ${meetupPoint}`, createdAt: FieldValue.serverTimestamp() });
    res.json({ meetupPoint });
  });

  // ---------- event day ----------

  r.get("/tickets", async (req, res) => {
    const { eventId, uid } = mine(req);
    const s = await col(eventId, "tickets").where("createdBy", "==", uid).get();
    res.json(s.docs.map(data).sort((a, b) => String((b as { createdAt?: Timestamp }).createdAt?.toMillis?.() ?? 0).localeCompare(String((a as { createdAt?: Timestamp }).createdAt?.toMillis?.() ?? 0))));
  });

  r.get("/progress", async (req, res) => {
    const { eventId, uid } = mine(req);
    const p = await participant(eventId, uid).get();
    if (!p.get("teamId")) {
      res.json([]);
      return;
    }
    const s = await col(eventId, "progress").where("teamId", "==", p.get("teamId")).orderBy("createdAt", "desc").limit(30).get();
    const names = await people(s.docs.map((d) => d.get("uid")));
    res.json(s.docs.map((d) => ({ ...data(d), name: (names.get(d.get("uid")) as { name?: string } | undefined)?.name })));
  });

  /** Mentors with their tracks and open slots, plus my team's bookings. */
  r.get("/mentors", async (req, res) => {
    const { eventId, uid } = mine(req);
    const [mentors, slots, p] = await Promise.all([
      db.collection("users").where("eventId", "==", eventId).where("role", "==", "mentor").get(),
      col(eventId, "mentorSlots").get(),
      participant(eventId, uid).get(),
    ]);
    const teamId = p.get("teamId");
    const now = Date.now();
    const future = slots.docs.filter((s) => (s.get("startAt") as Timestamp).toMillis() > now);
    res.json({
      mentors: mentors.docs.map((m) => ({
        uid: m.id,
        name: m.get("name"),
        tracks: m.get("mentorTracks") ?? [],
        openSlots: future
          .filter((s) => s.get("mentorUid") === m.id && s.get("status") === "open")
          .map((s) => ({ id: s.id, startAt: s.get("startAt"), endAt: s.get("endAt") }))
          .sort((a, b) => (a.startAt as Timestamp).toMillis() - (b.startAt as Timestamp).toMillis()),
      })),
      bookings: teamId
        ? slots.docs
            .filter((s) => s.get("teamId") === teamId)
            .map((s) => ({ id: s.id, mentorUid: s.get("mentorUid"), mentorName: mentors.docs.find((m) => m.id === s.get("mentorUid"))?.get("name"), startAt: s.get("startAt"), endAt: s.get("endAt"), topic: s.get("topic") ?? null, bookedBy: s.get("bookedBy") ?? null }))
        : [],
    });
  });

  /** The event's meals with my claim for each (Event Day → Food pass). */
  r.get("/meals", async (req, res) => {
    const { eventId, uid } = mine(req);
    const event = await getEvent(eventId);
    const meals = (event.meals ?? []) as { id: string; name: string; startAt: Timestamp; endAt: Timestamp }[];
    const claims = meals.length ? await db.getAll(...meals.map((m) => col(eventId, "food").doc(`${uid}_${m.id}`))) : [];
    res.json(meals.map((m, i) => ({ ...m, claimedAt: claims[i]?.get("claimedAt") ?? null, counter: claims[i]?.get("counter") ?? null })));
  });

  // ---------- submission ----------

  r.get("/submission", async (req, res) => {
    const { eventId, uid } = mine(req);
    const [event, p] = await Promise.all([getEvent(eventId), participant(eventId, uid).get()]);
    const teamId = p.get("teamId");
    const base = {
      deadline: event.deadlines.submission,
      locked: Boolean(event.submissionsLocked) || Date.now() > event.deadlines.submission.toMillis(),
    };
    if (!teamId) {
      res.json({ ...base, teamId: null, current: null, versions: [] });
      return;
    }
    const root = col(eventId, "submissions").doc(teamId);
    const [cur, versions] = await Promise.all([root.get(), root.collection("versions").orderBy("version", "desc").get()]);
    res.json({
      ...base,
      teamId,
      current: cur.exists ? { pptUrl: cur.get("pptUrl"), videoUrl: cur.get("videoUrl"), repoUrl: cur.get("repoUrl"), description: cur.get("description") ?? null, version: cur.get("version"), receiptId: cur.get("receiptId"), submittedAt: cur.get("submittedAt") } : null,
      versions: versions.docs.map((v) => ({ version: v.get("version"), receiptId: v.get("receiptId"), submittedAt: v.get("submittedAt"), pptUrl: v.get("pptUrl") ?? null, description: v.get("description") ?? null })),
    });
  });

  // ---------- after the event ----------

  r.get("/complaints", async (req, res) => {
    const { eventId, uid } = mine(req);
    const s = await col(eventId, "complaints").where("uid", "==", uid).get();
    res.json(s.docs.map(data));
  });

  r.post("/complaints/:id/reply", async (req, res) => {
    const { eventId, uid } = mine(req);
    const { note } = parseBody(req, z.object({ note: z.string().trim().min(1).max(2000) }));
    const ref = col(eventId, "complaints").doc(param(req, "id"));
    const c = await ref.get();
    if (c.get("uid") !== uid) throw forbidden();
    if (c.get("status") === "resolved") throw conflict("Complaint is resolved");
    await ref.update({ status: "open", history: FieldValue.arrayUnion({ at: Timestamp.now(), by: uid, note }) });
    res.json({ ok: true });
  });

  r.post("/complaints/:id/resolve", async (req, res) => {
    const { eventId, uid } = mine(req);
    const ref = col(eventId, "complaints").doc(param(req, "id"));
    const c = await ref.get();
    if (c.get("uid") !== uid) throw forbidden();
    await ref.update({ status: "resolved", history: FieldValue.arrayUnion({ at: Timestamp.now(), by: uid, note: "Marked resolved by the participant" }) });
    res.json({ ok: true });
  });

  r.get("/rating", async (req, res) => {
    const { eventId, uid } = mine(req);
    const [event, p, mineRating] = await Promise.all([getEvent(eventId), participant(eventId, uid).get(), col(eventId, "ratings").doc(uid).get()]);
    res.json({
      canRate: Boolean(p.get("checkedInAt")) && Date.now() >= event.endAt.toMillis(),
      rating: mineRating.exists ? mineRating.data() : null,
    });
  });

  /** My connections in both directions, with names. */
  r.get("/connections", async (req, res) => {
    const { eventId, uid } = mine(req);
    const [out, inc] = await Promise.all([
      col(eventId, "connections").where("fromUid", "==", uid).get(),
      col(eventId, "connections").where("toUid", "==", uid).get(),
    ]);
    const all = [...out.docs, ...inc.docs];
    const names = await people(all.flatMap((d) => [d.get("fromUid"), d.get("toUid")]));
    res.json(
      all.map((d) => {
        const other = d.get("fromUid") === uid ? d.get("toUid") : d.get("fromUid");
        return { id: d.id, status: d.get("status"), incoming: d.get("toUid") === uid, other: names.get(other) ?? { uid: other } };
      }),
    );
  });

  /** Announcements for me, with whether I've seen each. */
  r.get("/feed", async (req, res) => {
    const { eventId, uid } = mine(req);
    const p = await participant(eventId, uid).get();
    const s = await col(eventId, "announcements").orderBy("createdAt", "desc").limit(50).get();
    const forMe = s.docs.filter((d) => {
      const a = d.get("audience") as { type: string; ids: string[] } | undefined;
      if (!a || a.type === "all") return true;
      if (a.type === "track") return a.ids.includes(p.get("track"));
      if (a.type === "room") return a.ids.includes(p.get("roomId"));
      if (a.type === "team") return a.ids.includes(p.get("teamId"));
      if (a.type === "role") return a.ids.includes("participant");
      return false;
    });
    const seen = forMe.length ? await db.getAll(...forMe.map((d) => d.ref.collection("seen").doc(uid))) : [];
    res.json(forMe.map((d, i) => ({ id: d.id, title: d.get("title"), body: d.get("body"), emergency: Boolean(d.get("emergency")), audience: d.get("audience") ?? { type: "all", ids: [] }, createdAt: d.get("createdAt"), seen: Boolean(seen[i]?.exists) })));
  });
}
