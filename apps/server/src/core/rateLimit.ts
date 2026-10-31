import { rateLimit } from "express-rate-limit";
import { env } from "./env.js";

const json = { error: "RATE_LIMITED", message: "Too many requests, try again later" };

/** Everything under /api. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.isTest ? 100_000 : 600,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: json,
});

/** Login, PIN and enrollment routes: guessing a 6-digit PIN must be slow. */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.isTest ? 100_000 : 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: json,
});
