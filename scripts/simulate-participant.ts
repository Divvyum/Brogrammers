// Participant simulator (plan D7): stands in for the participant app in Phase 1
// so the volunteer scanner can be tested.
//
//   pnpm simulate enroll [--count 5] [--event <eventId>]
//       Creates device keys for N participants, enrolls them (signs credentials)
//       and saves the keys to scripts/.sim/devices.json.
//
//   pnpm simulate respond --uid p001 --challenge '<challenge QR JSON>'
//       Signs the challenge as that participant's device and writes the response
//       QR to scripts/.sim/response-<uid>.png (also printed in the terminal).
//
//   pnpm simulate list
//       Shows the simulated devices and their backup codes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { COL } from "@hackos/shared";
import { b64u, Challenge, challengeMessage, type ChallengeResponse, type SignedCredential, utf8 } from "@hackos/shared/crypto";
import { completeEnrollment } from "../apps/server/src/admin/digital-id/credentials.js";
import { col } from "../apps/server/src/core/events.js";
import { db } from "../apps/server/src/core/firebase.js";

const dir = fileURLToPath(new URL("./.sim/", import.meta.url));
const devicesFile = `${dir}devices.json`;

interface SimDevice {
  eventId: string;
  uid: string;
  name: string;
  privateJwk: JsonWebKey;
  credential: SignedCredential;
  backupCode: string;
}

function loadDevices(): Record<string, SimDevice> {
  return existsSync(devicesFile) ? JSON.parse(readFileSync(devicesFile, "utf8")) : {};
}
function saveDevices(d: Record<string, SimDevice>) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(devicesFile, JSON.stringify(d, null, 2));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function defaultEventId(): Promise<string> {
  const snap = await db.collection(COL.events).limit(1).get();
  if (snap.empty) throw new Error("No event found. Run `pnpm seed` first.");
  return snap.docs[0]!.id;
}

async function enroll() {
  const eventId = arg("event") ?? (await defaultEventId());
  const count = Number(arg("count") ?? 5);
  const devices = loadDevices();
  const candidates = await col(eventId, "participants").where("eligibility.result", "==", "eligible").limit(count * 3).get();
  const picked = candidates.docs.filter((p) => !devices[p.id] && p.get("enrollment.status") !== "enrolled").slice(0, count);
  if (!picked.length) {
    console.log("No eligible, unenrolled participants left. Run the eligibility engine first (`pnpm seed --pipeline`).");
    return;
  }

  for (const p of picked) {
    // Extractable only because this is a simulator; the real app uses extractable=false.
    const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = b64u.enc(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    const { credential, backupCode } = await completeEnrollment(eventId, p.id, pub);
    devices[p.id] = {
      eventId,
      uid: p.id,
      name: p.get("name"),
      privateJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
      credential,
      backupCode,
    };
    console.log(`Enrolled ${p.id} ${p.get("name")} (backup code ${backupCode})`);
  }
  saveDevices(devices);
}

async function respond() {
  const uid = arg("uid");
  const raw = arg("challenge");
  if (!uid || !raw) throw new Error("Usage: pnpm simulate respond --uid <uid> --challenge '<json>'");
  const device = loadDevices()[uid];
  if (!device) throw new Error(`${uid} has no simulated device. Run \`pnpm simulate enroll\` first.`);

  const chal = Challenge.parse(JSON.parse(raw));
  if (chal.ev !== device.credential.payload.eventId) throw new Error("Challenge is for a different event");

  const key = await crypto.subtle.importKey("jwk", device.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const msg = challengeMessage({ n: chal.n, vid: chal.vid, ev: chal.ev, pid: uid });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(msg));
  const response: ChallengeResponse = { t: "resp", cred: device.credential, sig: b64u.enc(sig) };
  const text = JSON.stringify(response);

  const png = `${dir}response-${uid}.png`;
  await QRCode.toFile(png, text, { errorCorrectionLevel: "M", width: 480 });
  console.log(await QRCode.toString(text, { type: "terminal", small: true, errorCorrectionLevel: "M" }));
  console.log(`Response QR saved to ${png} (${text.length} chars)`);
}

function list() {
  const devices = Object.values(loadDevices());
  if (!devices.length) return console.log("No simulated devices yet.");
  for (const d of devices) console.log(`${d.uid}  ${d.name.padEnd(24)} backup code ${d.backupCode}`);
}

const cmd = process.argv[2];
try {
  if (cmd === "enroll") await enroll();
  else if (cmd === "respond") await respond();
  else if (cmd === "list") list();
  else console.log("Commands: enroll [--count N] [--event ID] | respond --uid UID --challenge JSON | list");
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
process.exit();
