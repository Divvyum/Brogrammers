// Seeds the Firebase emulators with realistic data (plan D7).
//
// Usage (emulators must be running: `pnpm emulators` or `pnpm dev`):
//   pnpm seed            wipe the emulators, then seed
//   pnpm seed --pipeline also run duplicate detection, eligibility and allotment

import { detectDuplicates } from "../apps/server/src/admin/registrations/duplicates.js";
import { runEligibility } from "../apps/server/src/admin/eligibility/engine.js";
import { runAllotment } from "../apps/server/src/admin/allotment/allotment.service.js";
import { env } from "../apps/server/src/core/env.js";
import { stats } from "../apps/server/src/core/stats.js";
import { resetEmulators, seed } from "./lib/seed-data.js";

if (!env.usingEmulators) {
  console.error("Refusing to seed: FIRESTORE_EMULATOR_HOST is not set, so this would write to the real project.");
  process.exit(1);
}
for (const key of ["DATA_ENC_KEY", "HASH_KEY"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in apps/server/.env. Run \`pnpm keys\` first.`);
    process.exit(1);
  }
}

await resetEmulators(env.projectId);
const s = await seed();
console.log(`\nSeeded event ${s.eventId} (code ${s.eventCode}): ${s.participants} participants, ${s.teams} teams.`);

if (process.argv.includes("--pipeline")) {
  const dups = await detectDuplicates(s.eventId);
  const elig = await runEligibility(s.eventId);
  const allot = await runAllotment(s.eventId, "seed");
  console.log(`Duplicates found: ${dups}`);
  console.log(`Eligibility: ${elig.eligible} eligible, ${elig.flagged} flagged, ${elig.rejected} rejected`);
  console.log(`Allotment: ${allot.assigned} seated, ${allot.unassigned.length} unplaced groups, ${allot.capacityViolations} capacity violations`);
  // The pipeline schedules a debounced recount; this script exits first, so recount now.
  await stats.recompute(s.eventId);
}

console.log(`\nStaff logins: "Continue with Google" and pick the account, or the development form with password ${s.password}:`);
for (const st of s.staff) {
  console.log(`  ${st.role.padEnd(10)} ${st.email.padEnd(26)}${st.pin ? ` scanner PIN ${st.pin}` : ""}`);
}
console.log(`\nPlanted duplicates: ${s.plantedDuplicates.map((d) => `${d.uids.join("/")} (${d.kind})`).join(", ")}`);
console.log(`Planted ineligible: ${s.ineligible.map((x) => `${x.uid} (${x.why})`).join(", ")}`);
process.exit(0);
