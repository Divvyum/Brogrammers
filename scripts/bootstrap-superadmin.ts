// Makes SUPERADMIN_EMAIL (apps/server/.env) the super admin (plan D5).
// Creates the Auth account if it doesn't exist yet. Run it once per environment.
//
// Usage: pnpm superadmin [email]

import { COL } from "@hackos/shared";
import { encrypt, hashEmail } from "../apps/server/src/core/crypto.js";
import { env } from "../apps/server/src/core/env.js";
import { auth, db } from "../apps/server/src/core/firebase.js";

const email = process.argv[2] ?? process.env.SUPERADMIN_EMAIL;
if (!email) {
  console.error("Set SUPERADMIN_EMAIL in apps/server/.env or pass an email.");
  process.exit(1);
}

let user;
try {
  user = await auth.getUserByEmail(email);
} catch {
  user = await auth.createUser({ email, emailVerified: true });
}
await auth.setCustomUserClaims(user.uid, { role: "superadmin", eventId: "*" });
await db.collection(COL.users).doc(user.uid).set(
  {
    name: user.displayName ?? email.split("@")[0],
    role: "superadmin",
    eventId: "*",
    emailHash: hashEmail(email),
    emailEnc: encrypt(email),
    skills: [],
  },
  { merge: true },
);
console.log(`${email} is now super admin (uid ${user.uid}) on ${env.usingEmulators ? "the emulators" : env.projectId}.`);
console.log("Sign out and back in for the role to show up in the ID token.");
process.exit(0);
