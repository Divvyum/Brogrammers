import { Router } from "express";
import type { Timestamp } from "firebase-admin/firestore";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { DOC } from "@hackos/shared";
import { z } from "zod";
import { writeAudit } from "../../core/audit.js";
import { eventIdOf, requireRole } from "../../core/auth.js";
import { csvStream, type Cell } from "../../core/csv.js";
import { col, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { notFound } from "../../core/http.js";
import { analytics } from "../analytics/analytics.js";

// Exports (plan D27): CSV files streamed straight from Firestore, organizer only.
// Mounted under /api/admin/events/:eventId.

export const exportsRouter = Router({ mergeParams: true });

type Row = FirebaseFirestore.QueryDocumentSnapshot;

interface Spec {
  header: string[];
  query: (eventId: string) => FirebaseFirestore.Query;
  row: (d: Row) => Cell[];
}

const SPECS: Record<string, Spec> = {
  attendance: {
    header: ["participantId", "name", "college", "teamId", "slotId", "roomId", "seat", "status", "checkedInAt", "checkinId"],
    query: (e) => col(e, "participants"),
    row: (d) => [d.id, d.get("name"), d.get("college"), d.get("teamId"), d.get("slotId"), d.get("roomId"), d.get("seat"), d.get("status"), d.get("checkedInAt"), d.get("checkinId")],
  },
  teams: {
    header: ["teamId", "name", "track", "status", "leaderUid", "members", "memberUids", "repoUrl"],
    query: (e) => col(e, "teams"),
    row: (d) => [d.id, d.get("name"), d.get("track"), d.get("status"), d.get("leaderUid"), (d.get("memberUids") ?? []).length, (d.get("memberUids") ?? []).join(" "), d.get("repoUrl")],
  },
  eligibility: {
    header: ["participantId", "name", "college", "result", "reason", "override", "mergedInto"],
    query: (e) => col(e, "participants"),
    row: (d) => [d.id, d.get("name"), d.get("college"), d.get("eligibility.result"), d.get("eligibility.reason"), d.get("eligibility.override") ?? false, d.get("mergedInto")],
  },
  checkins: {
    header: ["checkinId", "participantId", "deviceId", "volunteerUid", "ts", "method", "deviceResult", "rejectReason", "overrideNote", "serverResult", "chain", "flagged"],
    query: (e) => col(e, "checkins").orderBy("ts"),
    row: (d) => [d.id, d.get("participantId"), d.get("deviceId"), d.get("volunteerUid"), d.get("ts"), d.get("method"), d.get("result"), d.get("rejectReason"), d.get("overrideNote"), d.get("serverResult"), d.get("chain"), d.get("flagged")],
  },
  scores: {
    header: ["judgeUid", "teamId", "round", "total", "locked", "criteria", "comment"],
    query: (e) => col(e, "scores"),
    row: (d) => [d.get("judgeUid"), d.get("teamId"), d.get("round"), d.get("total"), d.get("locked"), JSON.stringify(d.get("criteria") ?? {}), d.get("comment")],
  },
  rewards: {
    header: ["rewardId", "prize", "amount", "type", "sponsor", "winnerTeamId", "dueAt", "status", "overdue", "proofUrl", "confirmedAt"],
    query: (e) => col(e, "rewards"),
    row: (d) => [d.id, d.get("prize"), d.get("amount"), d.get("type"), d.get("sponsor"), d.get("winnerTeamId"), d.get("dueAt"), d.get("status"), d.get("overdue") ?? false, d.get("proofUrl"), d.get("confirmedAt")],
  },
  audit: {
    header: ["ts", "actor", "action", "target", "reason", "before", "after"],
    query: (e) => col(e, "audit").orderBy("ts"),
    row: (d) => [d.get("ts"), d.get("actor"), d.get("action"), d.get("target"), d.get("reason"), JSON.stringify(d.get("before") ?? null), JSON.stringify(d.get("after") ?? null)],
  },
};

const Kind = z.enum(["leaderboard", ...Object.keys(SPECS)] as [string, ...string[]]);

exportsRouter.get("/exports/:kind.csv", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const kind = Kind.parse(req.params.kind);
  await writeAudit({ eventId, actor: req.user!.uid, action: "export.csv", target: kind });

  if (kind === "leaderboard") {
    const lb = await col(eventId, "leaderboard").doc("current").get();
    const teams = (lb.get("teams") as { rank: number; teamId: string; teamName: string; total: number; judges: number; breakdown: Record<string, number> }[]) ?? [];
    const criteria = Object.keys(teams[0]?.breakdown ?? {});
    const out = csvStream(res, `leaderboard-${eventId}.csv`, ["rank", "teamId", "teamName", "total", "judges", ...criteria]);
    for (const t of teams) out.row([t.rank, t.teamId, t.teamName, t.total, t.judges, ...criteria.map((c) => t.breakdown[c])]);
    out.end();
    return;
  }

  const spec = SPECS[kind]!;
  const out = csvStream(res, `${kind}-${eventId}.csv`, spec.header);
  // Stream in pages of 500 so a big event never sits in memory at once.
  let last: Row | undefined;
  for (;;) {
    let q = spec.query(eventId).limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) out.row(spec.row(d));
    if (snap.size < 500) break;
    last = snap.docs[snap.docs.length - 1];
  }
  out.end();
});

/** One-page PDF event summary. */
exportsRouter.get("/exports/summary.pdf", requireRole("organizer"), async (req, res) => {
  const eventId = eventIdOf(req);
  const [event, live, lb, a] = await Promise.all([
    getEvent(eventId),
    db.doc(DOC.liveStats(eventId)).get(),
    col(eventId, "leaderboard").doc("current").get(),
    analytics(eventId),
  ]);
  if (!live.exists) throw notFound("Stats");

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4 portrait
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let y = 790;
  const text = (s: string, size = 11, f = font, color = rgb(0.1, 0.1, 0.15)) => {
    page.drawText(s.replace(/[^\x20-\xFF]/g, ""), { x: 50, y, size, font: f, color });
    y -= size + 8;
  };
  const day = (t: Timestamp) => t.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  text(event.name, 22, bold);
  text(`${day(event.startAt)} – ${day(event.endAt)}  ·  ${event.mode}  ·  tracks: ${event.tracks.join(", ")}`, 10);
  y -= 10;
  text("Numbers", 14, bold);
  const s = live.data()!;
  text(`Registrations ${s.registrations}   Eligible ${s.eligible}   Teams ${s.teams}   Enrolled IDs ${s.enrolled}`);
  text(`Checked in ${s.checkedIn}   No-show rate ${(a.noShowRate * 100).toFixed(1)}%   Submissions ${s.submissions}`);
  text(`WhatsApp: ${s.outbox.sent} sent, ${s.outbox.failed} failed, ${s.outbox.queued} queued   Delivery rate ${(a.whatsappDeliveryRate * 100).toFixed(1)}%`);
  y -= 10;
  text("Top teams", 14, bold);
  const teams = ((lb.get("teams") as { rank: number; teamName: string; total: number }[] | undefined) ?? []).slice(0, 5);
  if (!teams.length) text("No locked scores yet.");
  for (const t of teams) text(`${t.rank}.  ${t.teamName}  —  ${t.total.toFixed(2)}`);
  y -= 10;
  text("Feedback", 14, bold);
  text(
    a.ratings.count
      ? Object.entries(a.ratings.averages).map(([k, v]) => `${k} ${v ?? "–"}`).join("   ") + `   (${a.ratings.count} ratings)`
      : "No ratings yet.",
  );
  text(`Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`, 8);

  const bytes = await pdf.save();
  await writeAudit({ eventId, actor: req.user!.uid, action: "export.pdf", target: "summary" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="summary-${eventId}.pdf"`);
  res.send(Buffer.from(bytes));
});
