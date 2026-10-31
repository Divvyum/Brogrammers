import cors from "cors";
import express, { Router } from "express";
import helmet from "helmet";
import { allotmentRouter } from "./admin/allotment/routes.js";
import { analyticsRouter } from "./admin/analytics/routes.js";
import { announcementsRouter } from "./admin/announcements/routes.js";
import { auditRouter } from "./admin/audit/routes.js";
import { certificatesRouter, publicCertificatesRouter } from "./admin/certificates/routes.js";
import { checkinsRouter } from "./admin/checkins/routes.js";
import { digitalIdRouter } from "./admin/digital-id/routes.js";
import { eventsRouter } from "./admin/events/routes.js";
import { exportsRouter } from "./admin/exports/routes.js";
import { judgingRouter } from "./admin/judging/routes.js";
import { mentorsRouter } from "./admin/mentors/routes.js";
import { opsRouter } from "./admin/ops/routes.js";
import { outboxRouter, templatesRouter } from "./admin/outbox/routes.js";
import { problemsRouter } from "./admin/problems/routes.js";
import { registrationsRouter } from "./admin/registrations/routes.js";
import { replacementRouter } from "./admin/replacement/routes.js";
import { rewardsRouter } from "./admin/rewards/routes.js";
import { scheduleRouter } from "./admin/schedule/routes.js";
import { staffRouter, volunteerLoginRouter } from "./admin/staff/routes.js";
import { statsRouter } from "./admin/stats/routes.js";
import { submissionsRouter } from "./admin/submissions/routes.js";
import { teamsRouter } from "./admin/teams/routes.js";
import { appCheck, requireAuth, requireEventAccess } from "./core/auth.js";
import { env } from "./core/env.js";
import { db } from "./core/firebase.js";
import { errorHandler, jsonReplacer, requestLogger } from "./core/http.js";
import { apiLimiter } from "./core/rateLimit.js";
import { participantPublicRouter, participantRouter } from "./participant/routes.js";

export function createApp() {
  const app = express();
  app.set("json replacer", jsonReplacer);
  app.set("trust proxy", 1); // behind nginx/Caddy on the VPS
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  if (!env.isTest) app.use(requestLogger);
  app.use("/api", apiLimiter);

  // ---------- public ----------
  app.get("/api/public/health", async (_req, res) => {
    let firestore = "ok";
    try {
      await db.collection("_health").limit(1).get();
    } catch {
      firestore = "unreachable";
    }
    res.json({ status: "ok", firestore, emulators: env.usingEmulators });
  });
  app.use("/api/public/certificates", publicCertificatesRouter);

  // ---------- participant ----------
  app.use("/api/p", appCheck, participantPublicRouter);
  app.use("/api/p", appCheck, requireAuth, participantRouter);

  // ---------- admin ----------
  const admin = Router();
  admin.use(appCheck);
  admin.use("/auth", volunteerLoginRouter);
  admin.use(requireAuth);
  admin.use("/staff", staffRouter);
  admin.use("/events", eventsRouter);
  admin.use("/templates", templatesRouter);

  const perEvent = Router({ mergeParams: true });
  perEvent.use(requireEventAccess);
  for (const r of [
    registrationsRouter,
    teamsRouter,
    replacementRouter,
    allotmentRouter,
    digitalIdRouter,
    checkinsRouter,
    statsRouter,
    scheduleRouter,
    problemsRouter,
    announcementsRouter,
    outboxRouter,
    mentorsRouter,
    opsRouter,
    judgingRouter,
    submissionsRouter,
    certificatesRouter,
    rewardsRouter,
    exportsRouter,
    analyticsRouter,
    auditRouter,
  ]) {
    perEvent.use(r);
  }
  admin.use("/events/:eventId", perEvent);
  app.use("/api/admin", admin);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "NOT_FOUND", message: "No such route" });
  });
  app.use(errorHandler);
  return app;
}
