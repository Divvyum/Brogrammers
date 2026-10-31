import { Router } from "express";
import { AutoAssignBody, JudgeAssignBody, RubricBody, ScoreBody, VisibilityBody } from "@hackos/shared";
import { z } from "zod";
import { writeAudit } from "../../core/audit.js";
import { eventIdOf, param, requireRole } from "../../core/auth.js";
import { col, eventRef } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { badRequest, conflict, notFound } from "../../core/http.js";
import { parseBody, parseQuery } from "../../core/validate.js";
import { balanceAssignments } from "./assign.js";
import { computeLeaderboard, listJudges, publishResults, saveScore } from "./scoring.js";

// Judging setup (plan D22) and scoring, leaderboard, results (plan D24).
// Mounted under /api/admin/events/:eventId.

export const judgingRouter = Router({ mergeParams: true });

// ---------- rubric ----------

judgingRouter.get("/rubric/:round", requireRole("organizer", "judge"), async (req, res) => {
  const snap = await col(eventIdOf(req), "rubric").doc(param(req, "round")).get();
  if (!snap.exists) throw notFound("Rubric");
  res.json({ round: snap.id, ...snap.data() });
});

judgingRouter.put("/rubric/:round", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const round = param(req, "round");
  const body = parseBody(req, RubricBody);
  const locked = await col(eventId, "scores").where("round", "==", round).where("locked", "==", true).limit(1).get();
  if (!locked.empty) throw conflict("Scores are already locked for this round; the rubric can't change");
  const ref = col(eventId, "rubric").doc(round);
  const before = await ref.get();
  await ref.set(body);
  await writeAudit({ eventId, actor: req.user!.uid, action: "rubric.update", target: round, before: before.data() ?? null, after: body });
  res.json({ round, ...body });
});

// ---------- judge assignment ----------

judgingRouter.get("/judges", requireRole("organizer"), async (req, res) => {
  res.json({ items: await listJudges(eventIdOf(req)) });
});

judgingRouter.put("/judges/:uid/assignments", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const uid = param(req, "uid");
  const { teamIds } = parseBody(req, JudgeAssignBody);
  const judges = await listJudges(eventId);
  if (!judges.some((j) => j.uid === uid)) throw notFound("Judge");
  const teams = teamIds.length ? await db.getAll(...teamIds.map((t) => col(eventId, "teams").doc(t))) : [];
  const missing = teams.filter((t) => !t.exists).map((t) => t.id);
  if (missing.length) throw badRequest(`Unknown teams: ${missing.join(", ")}`);
  await col(eventId, "judgeAssignments").doc(uid).set({ teamIds: [...new Set(teamIds)] });
  await writeAudit({ eventId, actor: req.user!.uid, action: "judges.assign", target: uid, after: { teamIds } });
  res.json({ uid, teamIds });
});

judgingRouter.post("/judges/auto-assign", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { judgesPerTeam } = parseBody(req, AutoAssignBody);
  const [judges, teams] = await Promise.all([listJudges(eventId), col(eventId, "teams").select().get()]);
  if (judges.length < judgesPerTeam) throw conflict(`Need at least ${judgesPerTeam} judges, have ${judges.length}`);

  const plan = balanceAssignments(teams.docs.map((t) => t.id), judges.map((j) => j.uid), judgesPerTeam);
  const batch = db.batch();
  for (const [uid, teamIds] of plan) batch.set(col(eventId, "judgeAssignments").doc(uid), { teamIds });
  await batch.commit();
  const loads = Object.fromEntries([...plan].map(([uid, t]) => [uid, t.length]));
  await writeAudit({ eventId, actor: req.user!.uid, action: "judges.autoAssign", target: eventId, after: { judgesPerTeam, loads } });
  res.json({ judgesPerTeam, loads });
});

// ---------- scores ----------

/** Judges see their own scores; organizers see all. */
judgingRouter.get("/scores", requireRole("organizer", "judge"), async (req, res) => {
  const { round } = parseQuery(req, z.object({ round: z.string().default("current") }));
  let q = col(eventIdOf(req), "scores").where("round", "==", round);
  if (req.user!.role === "judge") q = q.where("judgeUid", "==", req.user!.uid);
  const snap = await q.get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

/** A judge scores an assigned team. Organizers pass ?judgeUid= to correct a judge's score (reason required if locked). */
judgingRouter.put("/scores/:teamId", requireRole("judge", "organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, ScoreBody);
  const { judgeUid } = parseQuery(req, z.object({ judgeUid: z.string().optional() }));
  const judge = req.user!.role === "judge" ? req.user!.uid : judgeUid;
  if (!judge) throw badRequest("judgeUid is required");
  res.json(await saveScore(eventId, param(req, "teamId"), judge, body, req.user!));
});

// ---------- leaderboard and results ----------

judgingRouter.get("/leaderboard", requireRole("organizer", "judge"), async (req, res) => {
  const snap = await col(eventIdOf(req), "leaderboard").doc("current").get();
  res.json(snap.exists ? snap.data() : { teams: [], outlierJudges: [] });
});

judgingRouter.post("/leaderboard/recompute", requireRole("organizer"), async (req, res) => {
  res.json(await computeLeaderboard(eventIdOf(req)));
});

/** Judge consistency report (A23). */
judgingRouter.get("/judging/consistency", requireRole("organizer"), async (req, res) => {
  const lb = await computeLeaderboard(eventIdOf(req));
  res.json({ consistency: lb.consistency, outlierJudges: lb.outlierJudges });
});

judgingRouter.post("/results/visibility", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const { visible } = parseBody(req, VisibilityBody);
  await eventRef(eventId).update({ leaderboardVisible: visible });
  await writeAudit({ eventId, actor: req.user!.uid, action: "results.visibility", target: eventId, after: { visible } });
  res.json({ visible });
});

judgingRouter.post("/results/publish", requireRole("organizer"), async (req, res) => {
  res.json(await publishResults(eventIdOf(req), req.user!.uid));
});
