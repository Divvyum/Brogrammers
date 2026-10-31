import request from "supertest";
import { COL } from "@hackos/shared";
import { createApp } from "../../src/app.js";
import { env } from "../../src/core/env.js";
import { auth, db } from "../../src/core/firebase.js";
import { stats } from "../../src/core/stats.js";

export const api = () => request(createApp());

/** Wipes Firestore and Auth in the emulators. */
export async function resetEmulators() {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${env.projectId}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${env.projectId}/accounts`, {
    method: "DELETE",
  });
  stats.stop();
}

/** Signs in through the Auth emulator and returns an ID token carrying the given claims. */
export async function tokenFor(uid: string, claims: { role: string; eventId: string }): Promise<string> {
  try {
    await auth.getUser(uid);
  } catch {
    await auth.createUser({ uid, email: `${uid}@test.local` });
  }
  await auth.setCustomUserClaims(uid, claims);
  return idTokenFromCustomToken(await auth.createCustomToken(uid));
}

export async function idTokenFromCustomToken(customToken: string): Promise<string> {
  const res = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`Auth emulator sign-in failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A valid event body for POST /api/admin/events. */
export function eventBody(overrides: Record<string, unknown> = {}) {
  const day = 86_400_000;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  return {
    name: "Test Hack",
    code: `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    mode: "offline",
    startAt: iso(7 * day),
    endAt: iso(9 * day),
    teamMin: 2,
    teamMax: 4,
    tracks: ["AI", "Open"],
    deadlines: { teamLock: iso(5 * day), submission: iso(8 * day) },
    ...overrides,
  };
}

/** Outbox messages for one person. */
export async function outboxFor(uid: string) {
  const snap = await db.collection(COL.outbox).where("to.uid", "==", uid).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string });
}

export async function auditFor(eventId: string, action: string) {
  const snap = await db.collection(`events/${eventId}/audit`).where("action", "==", action).get();
  return snap.docs.map((d) => d.data());
}
