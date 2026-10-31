import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Load apps/server/.env no matter which directory the process started in
// (the scripts in /scripts import server modules too).
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test" || Boolean(process.env.VITEST),
  port: Number(process.env.PORT ?? 3000),
  projectId: required("FIREBASE_PROJECT_ID"),
  usingEmulators: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean),
  participantAppUrl: process.env.PARTICIPANT_APP_URL ?? "http://localhost:5174",
  appCheckEnforced: process.env.APP_CHECK_ENFORCE === "true",
  /** Turns off cron jobs and Firestore listeners (tests start them by hand). */
  jobsDisabled: process.env.JOBS_DISABLED === "true",

  // Read lazily so the server can start (and tests can run) before the keys exist.
  get organizerPrivatePem() {
    return required("ORGANIZER_PRIVATE_PEM");
  },
  get organizerPublicKey() {
    return required("ORGANIZER_PUBLIC_RAW_B64U");
  },
  /** 32 bytes, base64. AES-256-GCM key for phone numbers and emails. */
  get dataEncKey() {
    return required("DATA_ENC_KEY");
  },
  /** HMAC key for phone/email lookup hashes, so the hashes can't be reversed by guessing. */
  get hashKey() {
    return required("HASH_KEY");
  },
  geminiApiKey: optional("GEMINI_API_KEY"),
  githubToken: optional("GITHUB_TOKEN"),
  waEnabled: process.env.WA_ENABLED === "true",
  waPrintQr: process.env.WA_PRINT_QR !== "false",
  waWorkerId: process.env.WA_WORKER_ID ?? `worker-${process.pid}`,
  waSessionKey: optional("WA_SESSION_KEY"),
};
