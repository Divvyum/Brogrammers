import cors from "cors";
import express, { Router } from "express";
import helmet from "helmet";
import { allotmentRouter } from "./admin/allotment/routes.js";
import { checkinsRouter } from "./admin/checkins/routes.js";
import { digitalIdRouter } from "./admin/digital-id/routes.js";
import { eventsRouter } from "./admin/events/routes.js";
import { registrationsRouter } from "./admin/registrations/routes.js";
import { replacementRouter } from "./admin/replacement/routes.js";
import { staffRouter, volunteerLoginRouter } from "./admin/staff/routes.js";
import { statsRouter } from "./admin/stats/routes.js";
import { teamsRouter } from "./admin/teams/routes.js";
import { appCheck, requireAuth, requireEventAccess } from "./core/auth.js";
import { env } from "./core/env.js";
import { db } from "./core/firebase.js";
import { errorHandler, jsonReplacer, requestLogger } from "./core/http.js";
import { apiLimiter } from "./core/rateLimit.js";

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

  // ---------- admin ----------
  const admin = Router();
  admin.use(appCheck);
  admin.use("/auth", volunteerLoginRouter);
  admin.use(requireAuth);
  admin.use("/staff", staffRouter);
  admin.use("/events", eventsRouter);

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
