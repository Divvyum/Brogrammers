import type { RequestHandler } from "express";
import { HttpError, forbidden } from "../core/http.js";

/** Requires a participant claim and exposes the claim's event as req.params.eventId. */
export const requireParticipant: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Not signed in");
  if (req.user.role !== "participant") throw forbidden("Participant account required");
  if (!req.user.eventId || req.user.eventId === "*") throw forbidden("Participant has no event");
  req.params.eventId = req.user.eventId;
  next();
};
