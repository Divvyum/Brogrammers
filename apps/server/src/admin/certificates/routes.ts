import { Router } from "express";
import { COL, IssueCertificatesBody } from "@hackos/shared";
import { rateLimit } from "express-rate-limit";
import { eventIdOf, requireRole } from "../../core/auth.js";
import { env } from "../../core/env.js";
import { db } from "../../core/firebase.js";
import { notFound } from "../../core/http.js";
import { parseBody } from "../../core/validate.js";
import { issueCertificates, loadCertificate, renderCertificate } from "./certificates.js";

// Certificates (plan D25).

/** Admin: /api/admin/events/:eventId/certificates */
export const certificatesRouter = Router({ mergeParams: true });
/** Public: /api/public/certificates */
export const publicCertificatesRouter = Router();

certificatesRouter.get("/certificates", requireRole("organizer"), async (req, res) => {
  const snap = await db.collection(COL.certificates).where("eventId", "==", eventIdOf(req)).get();
  res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

certificatesRouter.post("/certificates/issue", requireRole("organizer"), async (req, res) => {
  const body = parseBody(req, IssueCertificatesBody);
  res.json(await issueCertificates(eventIdOf(req), body.type, req.user!.uid, body.uids, body.topTeams));
});

publicCertificatesRouter.use(
  rateLimit({ windowMs: 60_000, limit: env.isTest ? 100_000 : 60, standardHeaders: "draft-8", legacyHeaders: false }),
);

/** Anyone with the link can check a certificate is genuine. Shows only what's printed on it. */
publicCertificatesRouter.get("/:certId", async (req, res) => {
  const c = await loadCertificate(req.params.certId!);
  if (!c) {
    res.status(404).json({ valid: false, error: "NOT_FOUND", message: "No certificate with this ID" });
    return;
  }
  res.json({
    valid: !c.get("revoked"),
    certId: c.id,
    type: c.get("type"),
    name: c.get("name"),
    eventName: c.get("eventName"),
    rank: c.get("rank") ?? null,
    teamName: c.get("teamName") ?? null,
    issuedAt: c.get("issuedAt"),
  });
});

publicCertificatesRouter.get("/:certId/pdf", async (req, res) => {
  const pdf = await renderCertificate(req.params.certId!);
  if (!pdf) throw notFound("Certificate");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="hackos-certificate-${req.params.certId}.pdf"`);
  res.send(Buffer.from(pdf));
});
