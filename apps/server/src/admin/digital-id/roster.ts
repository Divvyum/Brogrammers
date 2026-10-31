import { FieldValue, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { col, eventRef } from "../../core/events.js";
import { db } from "../../core/firebase.js";

// Volunteer devices sync the roster by version (plan quota rule 4): every change
// to what a scanner shows bumps events/{id}.rosterVersion and stamps the changed
// participants with the new version, so GET /roster?since=N returns only changes.

/** Inside a transaction. `eventSnap` must have been read in the same transaction. */
export function bumpRosterTx(tx: Transaction, eventSnap: DocumentSnapshot, uids: string[]): number {
  const version = ((eventSnap.get("rosterVersion") as number) ?? 1) + 1;
  tx.update(eventSnap.ref, { rosterVersion: version });
  for (const uid of uids) {
    tx.update(col(eventSnap.id, "participants").doc(uid), { rosterVersion: version });
  }
  return version;
}

/** Outside a transaction, for bulk changes (allotment). Returns the new version. */
export async function bumpRoster(eventId: string, uids: string[]): Promise<number> {
  const ref = eventRef(eventId);
  await ref.update({ rosterVersion: FieldValue.increment(1) });
  const version = (await ref.get()).get("rosterVersion") as number;
  const writer = db.bulkWriter();
  for (const uid of uids) writer.update(col(eventId, "participants").doc(uid), { rosterVersion: version });
  await writer.close();
  return version;
}
