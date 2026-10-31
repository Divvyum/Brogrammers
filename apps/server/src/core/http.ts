import type { ErrorRequestHandler, RequestHandler } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new HttpError(400, "BAD_REQUEST", msg, details);
export const notFound = (what = "Resource") => new HttpError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (msg: string) => new HttpError(409, "CONFLICT", msg);
export const forbidden = (msg = "Forbidden") => new HttpError(403, "FORBIDDEN", msg);

/** Firestore Timestamps go out as ISO strings. Used as Express's "json replacer". */
export function jsonReplacer(this: unknown, key: string, value: unknown) {
  const raw = (this as Record<string, unknown>)?.[key];
  if (raw instanceof Timestamp) return raw.toDate().toISOString();
  return value;
}

/** ISO string from a request body → Firestore Timestamp. */
export const isoToTs = (iso: string) => Timestamp.fromDate(new Date(iso));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "VALIDATION", message: "Invalid input", details: z.treeifyError(err) });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "BAD_JSON", message: "Request body is not valid JSON" });
    return;
  }
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: "INTERNAL", message: "Something went wrong" });
};

export const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    if (req.originalUrl === "/api/public/health") return;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
};
