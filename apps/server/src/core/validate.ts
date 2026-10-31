import type { Request } from "express";
import type { z } from "zod";

// Parse inside the handler so the result is typed: `const body = parseBody(req, Schema)`.
// A ZodError becomes a 400 in the error handler.

export function parseBody<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  return schema.parse(req.body ?? {});
}

export function parseQuery<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  return schema.parse(req.query);
}
