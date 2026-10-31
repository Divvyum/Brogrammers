import { useState } from "react";
import { DataTable, Field, Loader, PageIntro, Panel, Status } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, useApi } from "../lib/hooks";
import { useCountdown } from "./Teams";

// Waitlist and replacements (plan A10): ordered waitlist, live replacement
// chains with invitation countdowns, approve replacements, offer seats.

interface WaitRow extends Record<string, unknown> {
  id: string;
  position: number;
  eligible: boolean;
  status: string;
  offerExpiresAt?: string;
  replacementId?: string;
}

interface Replacement extends Record<string, unknown> {
  id: string;
  teamId: string;
  vacantUid: string;
  candidates: string[];
  currentCandidate?: string;
  inviteExpiresAt?: string;
  passed: string[];
  acceptedUid?: string;
  status: string;
}

function Countdown({ to }: { to?: string }) {
  const c = useCountdown(to);
  return <span className={c === "passed" ? "danger-text" : ""}>{c ?? "—"}</span>;
}

export function Waitlist() {
  const { base } = useEvent();
  const waitlist = useApi<{ items: WaitRow[] }>(base ? `${base}/waitlist` : null, { refetchInterval: 30_000 });
  const reps = useApi<{ items: Replacement[] }>(base ? `${base}/replacements` : null, { refetchInterval: 30_000 });
  const { run, busy } = useAction();
  const [add, setAdd] = useState("");

  return (
    <div>
      <PageIntro eyebrow="TEAM RESCUE" title="Waitlist & replacements" subtitle="When someone withdraws, the best-fitting solo participant is invited; if nobody accepts, the waitlist gets the seat." />

      <Panel title="Replacement chains">
        <Loader query={reps}>
          {(d) => (
            <div className="chain-list">
              {d.items.length === 0 && <p className="hint">No withdrawals yet. Withdraw someone from a team on the Teams screen.</p>}
              {d.items.map((r) => (
                <div key={r.id} className="chain">
                  <div className="chain-head">
                    <b>Team {r.teamId}</b> <span className="muted">replacing {r.vacantUid}</span> <Status value={r.status} />
                  </div>
                  <ol className="chain-steps">
                    {r.candidates.map((c) => (
                      <li key={c} className={r.passed.includes(c) ? "passed" : c === r.currentCandidate ? "current" : c === r.acceptedUid ? "accepted" : ""}>
                        {c}
                        {c === r.currentCandidate && r.status === "invited" && (
                          <small>
                            {" "}
                            invited · <Countdown to={r.inviteExpiresAt} />
                          </small>
                        )}
                        {r.passed.includes(c) && <small> declined / expired</small>}
                      </li>
                    ))}
                    {r.status === "waitlist" && (
                      <li className="current">
                        Waitlist: {r.currentCandidate}{" "}
                        <small>
                          offered · <Countdown to={r.inviteExpiresAt} />
                        </small>
                      </li>
                    )}
                  </ol>
                  {r.status === "accepted" && (
                    <button className="primary" disabled={busy} onClick={() => run("POST", `${base}/replacements/${r.id}/approve`, {}, `${r.acceptedUid} joined team ${r.teamId}`)}>
                      Approve {r.acceptedUid}
                    </button>
                  )}
                  {r.status === "failed" && <p className="hint">Nobody was available. Add people to the waitlist, or find someone manually.</p>}
                </div>
              ))}
            </div>
          )}
        </Loader>
      </Panel>

      <Panel
        title="Waitlist"
        actions={
          <button className="secondary" disabled={busy} onClick={() => run("POST", `${base}/waitlist/recompute`, {}, "Order updated")}>
            Re-order
          </button>
        }
      >
        <form
          className="inline-row"
          onSubmit={async (e) => {
            e.preventDefault();
            const uids = add.split(/[\s,]+/).filter(Boolean);
            const r = await run<{ added: string[]; skipped: { uid: string; reason: string }[] }>(
              "POST",
              `${base}/waitlist`,
              { uids },
              (x) => `Added ${x.added.length}${x.skipped.length ? `; skipped ${x.skipped.map((s) => `${s.uid} (${s.reason})`).join(", ")}` : ""}`,
            );
            if (r) setAdd("");
          }}
        >
          <Field label="Add participants (IDs, comma separated)">
            <input value={add} onChange={(e) => setAdd(e.target.value)} />
          </Field>
          <button className="secondary">Add to waitlist</button>
        </form>
        <Loader query={waitlist}>
          {(d) => (
            <DataTable
              rows={d.items}
              columns={[
                { key: "position", label: "#" },
                { key: "id", label: "Participant" },
                { key: "eligible", label: "Eligible" },
                { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                { key: "offer", label: "Offer expires", render: (r) => (r.status === "offered" ? <Countdown to={r.offerExpiresAt} /> : "—") },
                {
                  key: "act",
                  label: "",
                  render: (r) =>
                    r.status === "waiting" && (
                      <button className="secondary" disabled={busy} onClick={() => run("POST", `${base}/waitlist/${r.id}/offer`, {}, "Seat offered on WhatsApp")}>
                        Offer seat
                      </button>
                    ),
                },
              ]}
            />
          )}
        </Loader>
      </Panel>
    </div>
  );
}
