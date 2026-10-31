import { FieldValue, type Transaction, type WriteBatch } from "firebase-admin/firestore";
import { eventPath } from "@hackos/shared";
import { db } from "./firebase.js";

export interface AuditInput {
  eventId: string;
  /** uid of the person acting, or "system" for jobs. */
  actor: string;
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

function auditDoc(a: AuditInput) {
  return {
    actor: a.actor,
    action: a.action,
    target: a.target,
    before: a.before ?? null,
    after: a.after ?? null,
    reason: a.reason ?? null,
    ts: FieldValue.serverTimestamp(),
  };
}

/**
 * Every admin mutation calls this. Audit docs are create-only: nothing in the
 * server updates them, and the rules deny client writes.
 * Pass a transaction or batch to write the audit entry atomically with the change.
 */
export async function writeAudit(a: AuditInput, tx?: Transaction | WriteBatch): Promise<void> {
  const ref = db.collection(eventPath(a.eventId, "audit")).doc();
  if (tx) {
    (tx as WriteBatch).create(ref, auditDoc(a));
    return;
  }
  await ref.create(auditDoc(a));
}
