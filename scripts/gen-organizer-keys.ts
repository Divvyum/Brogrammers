// Generates the server's secrets into apps/server/.env (plan D7):
//   ORGANIZER_PRIVATE_PEM / ORGANIZER_PUBLIC_RAW_B64U  — signs participant credentials
//   DATA_ENC_KEY                                        — AES-256 key for phone numbers and emails
//   HASH_KEY                                            — HMAC key for lookup hashes
//
// Existing values are kept. `--rotate-organizer` replaces only the organizer
// keypair (every enrolled participant must then re-enroll). The data keys are
// never replaced: that would make stored phone numbers and emails unreadable.
//
// Usage: pnpm keys [--rotate-organizer]

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateOrganizerKeys } from "../apps/server/src/core/signing.js";

const envPath = fileURLToPath(new URL("../apps/server/.env", import.meta.url));
const rotate = process.argv.includes("--rotate-organizer");

let text = readFileSync(envPath, "utf8");
const has = (name: string) => new RegExp(`^${name}=.+`, "m").test(text);
function put(name: string, value: string) {
  const line = `${name}=${value}`;
  if (new RegExp(`^${name}=`, "m").test(text)) text = text.replace(new RegExp(`^${name}=.*$`, "m"), () => line);
  else text = `${text.trimEnd()}\n${line}\n`;
}

const changed: string[] = [];
if (!has("ORGANIZER_PRIVATE_PEM") || rotate) {
  const keys = generateOrganizerKeys();
  if (!/# Organizer signing key/.test(text)) text = `${text.trimEnd()}\n\n# Organizer signing key (scripts/gen-organizer-keys.ts)\n`;
  put("ORGANIZER_PRIVATE_PEM", `"${keys.privatePem.trim().replace(/\n/g, "\\n")}"`);
  put("ORGANIZER_PUBLIC_RAW_B64U", keys.publicRawB64u);
  changed.push("organizer keypair");
}
if (!has("DATA_ENC_KEY")) {
  put("DATA_ENC_KEY", randomBytes(32).toString("base64"));
  changed.push("DATA_ENC_KEY");
}
if (!has("HASH_KEY")) {
  put("HASH_KEY", randomBytes(32).toString("base64"));
  changed.push("HASH_KEY");
}

writeFileSync(envPath, text);
console.log(changed.length ? `Wrote ${changed.join(", ")} to apps/server/.env` : "All keys already exist; nothing changed.");
