import type { Request, RequestHandler } from "express";
import { Claims, type Role } from "@hackos/shared";
import { getAppCheck } from "firebase-admin/app-check";
import { env } from "./env.js";
import { app, auth } from "./firebase.js";
import { forbidden, HttpError } from "./http.js";

export interface AuthContext {
  uid: string;
  email?: string;
  role: Role;
  /** The event this account belongs to; "*" for the super admin. */
  eventId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthContext;
    }
  }
}

/** Verifies the Firebase ID token in `Authorization: Bearer <token>` and reads the role claims. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Missing ID token");

  let decoded;
  try {
    decoded = await auth.verifyIdToken(token, true);
  } catch {
    throw new HttpError(401, "UNAUTHENTICATED", "Invalid or expired ID token");
  }
  const claims = Claims.safeParse(decoded);
  if (!claims.success) throw forbidden("Account has no role yet");

  req.user = { uid: decoded.uid, email: decoded.email, ...claims.data };
  next();
};

/** Allows only the listed roles. The super admin is always allowed. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const role = req.user?.role;
    if (!role) throw new HttpError(401, "UNAUTHENTICATED", "Not signed in");
    if (role !== "superadmin" && !roles.includes(role)) {
      throw forbidden(`Requires role: ${roles.join(" or ")}`);
    }
    next();
  };
}

/** For routes under /events/:eventId: the account must belong to that event. */
export const requireEventAccess: RequestHandler = (req, _res, next) => {
  const { user } = req;
  const eventId = param(req, "eventId");
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Not signed in");
  if (user.role !== "superadmin" && user.eventId !== eventId) {
    throw forbidden("This account belongs to a different event");
  }
  next();
};

/** Checks the App Check token when APP_CHECK_ENFORCE=true (production only). */
export const appCheck: RequestHandler = async (req, _res, next) => {
  if (!env.appCheckEnforced) return next();
  const token = req.header("X-Firebase-AppCheck");
  if (!token) throw new HttpError(401, "APP_CHECK", "Missing App Check token");
  try {
    await getAppCheck(app).verifyToken(token);
  } catch {
    throw new HttpError(401, "APP_CHECK", "Invalid App Check token");
  }
  next();
};

/** A route parameter as a single string. */
export function param(req: Request, name: string): string {
  const v = req.params[name];
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) throw new HttpError(400, "BAD_REQUEST", `Missing ${name}`);
  return s;
}

/** The event a request acts on, from the route. */
export const eventIdOf = (req: Request) => param(req, "eventId");
