import { Router } from "express";
import { EventBody, EventPatchBody, DOC } from "@hackos/shared";
import { writeAudit } from "../../core/audit.js";
import { requireEventAccess, requireRole, param } from "../../core/auth.js";
import { eventRef, getEvent } from "../../core/events.js";
import { db } from "../../core/firebase.js";
import { conflict, isoToTs } from "../../core/http.js";
import { stats } from "../../core/stats.js";
import { parseBody } from "../../core/validate.js";

// Event setup (plan D6). Mounted at /api/admin/events.

export const eventsRouter = Router();

function toDoc(body: Partial<EventBody>) {
  const doc: Record<string, unknown> = { ...body };
  for (const k of ["startAt", "endAt"] as const) if (body[k]) doc[k] = isoToTs(body[k]);
  if (body.deadlines) {
    doc.deadlines = Object.fromEntries(
      Object.entries(body.deadlines).map(([k, v]) => [k, isoToTs(v as string)]),
    );
  }
  if (body.rounds) {
    doc.rounds = body.rounds.map((r) => ({ ...r, startAt: isoToTs(r.startAt), endAt: isoToTs(r.endAt) }));
  }
  return doc;
}

async function assertCodeFree(code: string, exceptId?: string) {
  const snap = await db.collection("events").where("code", "==", code).limit(2).get();
  if (snap.docs.some((d) => d.id !== exceptId)) throw conflict(`Event code ${code} is taken`);
}

eventsRouter.post("/", requireRole(), async (req, res) => {
  const body = parseBody(req, EventBody);
  await assertCodeFree(body.code);

  const ref = db.collection("events").doc();
  const batch = db.batch();
  batch.create(ref, { ...toDoc(body), rosterVersion: 1 });
  batch.create(db.doc(DOC.liveStats(ref.id)), stats.initial());
  await writeAudit(
    { eventId: ref.id, actor: req.user!.uid, action: "event.create", target: ref.id, after: body },
    batch,
  );
  await batch.commit();
  res.status(201).json(await getEvent(ref.id));
});

eventsRouter.get("/", async (req, res) => {
  const user = req.user!;
  if (user.role === "superadmin") {
    const snap = await db.collection("events").orderBy("startAt", "desc").get();
    res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    return;
  }
  res.json({ items: [await getEvent(user.eventId)] });
});

eventsRouter.get("/:eventId", requireEventAccess, async (req, res) => {
  res.json(await getEvent(param(req, "eventId")));
});

eventsRouter.patch("/:eventId", requireEventAccess, requireRole("organizer"), async (req, res) => {
  const eventId = param(req, "eventId");
  const patch = parseBody(req, EventPatchBody);
  const before = await getEvent(eventId);

  const teamMin = patch.teamMin ?? before.teamMin;
  const teamMax = patch.teamMax ?? before.teamMax;
  if (teamMin > teamMax) throw conflict("teamMin must be ≤ teamMax");

  const doc = toDoc(patch as Partial<EventBody>);
  // Merge partial deadlines into the existing ones.
  if (doc.deadlines) doc.deadlines = { ...before.deadlines, ...(doc.deadlines as object) };

  const batch = db.batch();
  batch.update(eventRef(eventId), doc);
  await writeAudit(
    { eventId, actor: req.user!.uid, action: "event.update", target: eventId, after: patch },
    batch,
  );
  await batch.commit();
  res.json(await getEvent(eventId));
});
