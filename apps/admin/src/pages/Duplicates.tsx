import { useState } from "react";
import { Loader, PageIntro, ReasonDialog, Status } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, useApi } from "../lib/hooks";
import { fmtDate } from "../lib/format";
import { ParticipantDrawer } from "./Participants";

// Duplicates review (plan A7): the two records side by side; merge or dismiss
// with a reason.

interface Dup {
  id: string;
  uidA: string;
  uidB: string;
  matchType: "phone" | "email" | "fuzzy";
  score: number;
  status: string;
}

interface Side {
  id: string;
  name: string;
  college?: string;
  status: string;
  teamId?: string;
  registeredAt?: string;
  profile: { email: string | null; phone: string | null; city?: string; year?: number };
}

export function Duplicates() {
  const { base } = useEvent();
  const [status, setStatus] = useState("open");
  const list = useApi<{ items: Dup[] }>(base ? `${base}/duplicates?status=${status}` : null);
  const { run, busy } = useAction();

  return (
    <div>
      <PageIntro
        eyebrow="DATA QUALITY"
        title="Duplicates"
        subtitle="Same phone or email, or a very similar name at the same college. Merging keeps the earlier registration."
        actions={
          <button className="secondary" disabled={busy} onClick={() => run<{ created: number }>("POST", `${base}/duplicates/detect`, {}, (r) => `${r.created} new possible duplicates`)}>
            Re-run detection
          </button>
        }
      />
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="merged">Merged</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>
      <Loader query={list}>
        {(d) => (
          <div className="card-list">
            {d.items.length === 0 && <p className="hint">No {status} duplicates.</p>}
            {d.items.map((dup) => (
              <DuplicatePair key={dup.id} dup={dup} />
            ))}
          </div>
        )}
      </Loader>
    </div>
  );
}

function DuplicatePair({ dup }: { dup: Dup }) {
  const { base } = useEvent();
  const a = useApi<Side>(`${base}/participants/${dup.uidA}`);
  const b = useApi<Side>(`${base}/participants/${dup.uidB}`);
  const { run, busy } = useAction();
  const [pending, setPending] = useState<"merge" | "dismiss" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const sides = [a.data, b.data];
  const fields: [string, (s: Side) => unknown][] = [
    ["Name", (s) => s.name],
    ["College", (s) => s.college],
    ["Email", (s) => s.profile.email],
    ["Phone", (s) => s.profile.phone],
    ["City", (s) => s.profile.city],
    ["Team", (s) => s.teamId ?? "Solo"],
    ["Registered", (s) => fmtDate(s.registeredAt)],
    ["Status", (s) => s.status],
  ];

  return (
    <div className="panel">
      <div className="panel-heading">
        <h3>
          {dup.matchType === "fuzzy" ? `Similar name (${Math.round(dup.score * 100)}%)` : `Same ${dup.matchType}`}
        </h3>
        <Status value={dup.status} />
      </div>
      <table className="compare-table">
        <thead>
          <tr>
            <th />
            {sides.map((s, i) => (
              <th key={i}>
                <button className="link-button" onClick={() => s && setOpen(s.id)}>
                  {s?.id ?? "…"}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fields.map(([name, get]) => {
            const [va, vb] = sides.map((s) => (s ? String(get(s) ?? "—") : "…"));
            return (
              <tr key={name} className={va === vb ? "same" : ""}>
                <td>{name}</td>
                <td>{va}</td>
                <td>{vb}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {dup.status === "open" && (
        <div className="button-row end">
          <button className="secondary" onClick={() => setPending("dismiss")}>
            Not the same person
          </button>
          <button className="primary" onClick={() => setPending("merge")}>
            Merge
          </button>
        </div>
      )}
      {pending && (
        <ReasonDialog
          title={pending === "merge" ? "Merge these records" : "Dismiss this match"}
          description={pending === "merge" ? "The earlier registration is kept and takes over the team place. The other is marked as merged." : "The pair won't be suggested again."}
          confirmLabel={pending === "merge" ? "Merge" : "Dismiss"}
          busy={busy}
          onClose={() => setPending(null)}
          onConfirm={(reason) => run("POST", `${base}/duplicates/${dup.id}/${pending}`, { reason }, pending === "merge" ? "Merged" : "Dismissed")}
        />
      )}
      {open && <ParticipantDrawer uid={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
