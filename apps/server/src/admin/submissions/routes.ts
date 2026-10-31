import { Router } from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COL, SubmissionSettingsBody } from "@hackos/shared";
import { generateText } from "../../core/ai.js";
import { writeAudit } from "../../core/audit.js";
import { eventIdOf, param, requireRole } from "../../core/auth.js";
import { col, eventRef, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { badRequest, forbidden, HttpError, isoToTs, notFound } from "../../core/http.js";
import { parseBody } from "../../core/validate.js";
import { fetchInsights } from "./github.js";

// Submissions, admin side (plan D23). Participants submit in Phase 2 (M16).
// Mounted under /api/admin/events/:eventId.

export const submissionsRouter = Router({ mergeParams: true });

/** Minimum time between GitHub refreshes of the same repo. */
export const GITHUB_REFRESH_MS = 10 * 60_000;

/** Judges may only open submissions of teams assigned to them. */
async function assertCanSee(eventId: string, user: NonNullable<Express.Request["user"]>, teamId: string) {
  if (user.role !== "judge") return;
  const a = await col(eventId, "judgeAssignments").doc(user.uid).get();
  if (!(a.get("teamIds") as string[] | undefined)?.includes(teamId)) throw forbidden("This team isn't assigned to you");
}

submissionsRouter.put("/submissions/settings", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const body = parseBody(req, SubmissionSettingsBody);
  const update: Record<string, unknown> = {};
  if (body.deadline) update["deadlines.submission"] = isoToTs(body.deadline);
  if (body.locked !== undefined) update.submissionsLocked = body.locked;
  if (!Object.keys(update).length) throw badRequest("Nothing to change");
  await eventRef(eventId).update(update);
  await writeAudit({ eventId, actor: req.user!.uid, action: "submissions.settings", target: eventId, after: body });
  const event = await getEvent(eventId);
  res.json({ deadline: event.deadlines.submission, locked: Boolean(event.submissionsLocked) });
});

submissionsRouter.get("/submissions", requireRole("organizer", "judge"), async (req, res) => {
  const eventId = eventIdOf(req);
  const [subs, teams] = await Promise.all([col(eventId, "submissions").get(), col(eventId, "teams").select("name", "track").get()]);
  const team = new Map(teams.docs.map((t) => [t.id, t]));
  let docs = subs.docs;
  if (req.user!.role === "judge") {
    const a = await col(eventId, "judgeAssignments").doc(req.user!.uid).get();
    const mine = new Set((a.get("teamIds") as string[] | undefined) ?? []);
    docs = docs.filter((d) => mine.has(d.id));
  }
  res.json({
    items: docs.map((d) => {
      const { github, ...rest } = d.data();
      return {
        teamId: d.id,
        teamName: team.get(d.id)?.get("name") ?? d.id,
        track: team.get(d.id)?.get("track") ?? null,
        ...rest,
        // The list stays small: the timeline and README come with the detail call.
        github: github ? { repo: github.repo, commits: github.commits, flags: github.flags.length, outsiders: github.outsiders } : null,
      };
    }),
  });
});

submissionsRouter.get("/submissions/:teamId", requireRole("organizer", "judge"), async (req, res) => {
  const eventId = eventIdOf(req);
  const teamId = param(req, "teamId");
  await assertCanSee(eventId, req.user!, teamId);
  const ref = col(eventId, "submissions").doc(teamId);
  const [sub, versions] = await Promise.all([ref.get(), ref.collection("versions").orderBy("version", "desc").get()]);
  if (!sub.exists) throw notFound("Submission");
  res.json({ teamId, ...sub.data(), versions: versions.docs.map((v) => v.data()) });
});

/** Fetches (or re-fetches) GitHub insights. At most once per 10 minutes per repo. */
export async function refreshGithub(eventId: string, teamId: string, force = false) {
  const ref = col(eventId, "submissions").doc(teamId);
  const sub = await ref.get();
  if (!sub.exists) throw notFound("Submission");
  const repoUrl = sub.get("repoUrl") as string | undefined;
  if (!repoUrl) throw badRequest("This submission has no repository link");
  const last = (sub.get("github.fetchedAt") as Timestamp | undefined)?.toMillis() ?? 0;
  if (!force && Date.now() - last < GITHUB_REFRESH_MS) {
    throw new HttpError(429, "RATE_LIMITED", `Refreshed recently; try again in ${Math.ceil((GITHUB_REFRESH_MS - (Date.now() - last)) / 60_000)} min`);
  }

  const [event, team] = await Promise.all([getEvent(eventId), col(eventId, "teams").doc(teamId).get()]);
  const memberUids = (team.get("memberUids") as string[] | undefined) ?? [];
  const users = memberUids.length ? await db.getAll(...memberUids.map((u) => db.collection(COL.users).doc(u)), { fieldMask: ["githubUsername"] }) : [];
  const members = new Map(
    users.filter((u) => u.get("githubUsername")).map((u) => [String(u.get("githubUsername")).toLowerCase(), u.id]),
  );

  try {
    const insights = await fetchInsights({
      repoUrl,
      eventStart: (event.startAt as Timestamp).toDate(),
      deadline: (event.deadlines.submission as Timestamp).toDate(),
      members,
    });
    await ref.update({ github: { ...insights, fetchedAt: FieldValue.serverTimestamp() }, githubError: FieldValue.delete() });
    return insights;
  } catch (err) {
    await ref.update({ githubError: (err as Error).message });
    throw err;
  }
}

submissionsRouter.post("/submissions/:teamId/github/refresh", requireRole("organizer", "judge"), async (req, res) => {
  const eventId = eventIdOf(req);
  const teamId = param(req, "teamId");
  await assertCanSee(eventId, req.user!, teamId);
  res.json(await refreshGithub(eventId, teamId));
});

const SUMMARY_SYSTEM = `You summarize hackathon submissions for judges.
Write 4-6 short bullet points: what the project does, how it's built, how far it got, and anything the commit history suggests (for example most work done by one person, or commits outside the event window).
Be factual and neutral. Use only the information given.`;

submissionsRouter.post("/submissions/:teamId/ai-summary", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const teamId = param(req, "teamId");
  const ref = col(eventId, "submissions").doc(teamId);
  const sub = await ref.get();
  if (!sub.exists) throw notFound("Submission");
  const gh = sub.get("github") as { readme?: string; commits: number; contributors: { login: string; commits: number }[]; flags: unknown[] } | undefined;

  const prompt = [
    `Project description: ${sub.get("description") ?? "(none)"}`,
    gh
      ? `Commits: ${gh.commits}; contributors: ${gh.contributors.map((c) => `${c.login} (${c.commits})`).join(", ")}; commits outside the event window: ${gh.flags.length}`
      : "No GitHub data.",
    `README:\n${gh?.readme?.slice(0, 8000) ?? "(none)"}`,
  ].join("\n\n");
  const summary = await generateText(prompt, SUMMARY_SYSTEM);
  await ref.update({ aiSummary: summary });
  res.json({ aiSummary: summary });
});
