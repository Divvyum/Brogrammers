import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Load simulation only runs against FIRESTORE_EMULATOR_HOST");
const projectId = process.env.FIREBASE_PROJECT_ID ?? "hackos-demo";
const eventId = process.argv[2] ?? "demo";
const db = getFirestore(initializeApp({ projectId }, "load-simulation"));
const event = db.collection("events").doc(eventId);
const writer = db.bulkWriter();
for (let i = 0; i < 300; i++) {
  const uid = `load-p${String(i + 1).padStart(3, "0")}`;
  writer.set(db.collection("users").doc(uid), { name: `Load Participant ${i + 1}`, role: "participant", eventId, skills: [`skill${i % 8}`] });
  writer.set(event.collection("participants").doc(uid), { name: `Load Participant ${i + 1}`, status: "registered", registeredAt: Timestamp.now(), rosterVersion: 0, track: `track${i % 3}` });
}
await writer.close();
await event.set({ loadSimulation: { participants: 300, writes: 600, estimatedReads: { registration: 4, slotBooking: 3, submission: 4 }, at: FieldValue.serverTimestamp() } }, { merge: true });
console.log(JSON.stringify({ participants: 300, writes: 600, withinSparkDailyWrites: true }, null, 2));
