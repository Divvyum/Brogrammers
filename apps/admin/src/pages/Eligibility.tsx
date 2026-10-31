import { useState } from "react";
import { DataTable, Dialog, Field, Loader, PageIntro, Pager, Status } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, usePaged } from "../lib/hooks";
import type { ParticipantRow } from "./Participants";

// Eligibility review (plan A8): flagged and rejected lists with reasons,
// override with a reason, and "Re-run rules".

export function Eligibility() {
  const { base } = useEvent();
  const [status, setStatus] = useState<"flagged" | "rejected" | "eligible">("flagged");
  const list = usePaged<ParticipantRow>(base ? `${base}/participants?status=${status}` : null, 50);
  const { run, busy } = useAction();
  const [selected, setSelected] = useState<ParticipantRow | null>(null);
  const [override, setOverride] = useState({ result: "eligible", reason: "" });

  return (
    <div>
      <PageIntro
        eyebrow="REGISTRATION QUALITY"
        title="Eligibility review"
        subtitle="Year of study, approved colleges, required fields and team size. Manual decisions stick when the rules re-run."
        actions={
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run<{ eligible: number; flagged: number; rejected: number; changed: number }>(
                "POST",
                `${base}/eligibility/run`,
                {},
                (r) => `${r.eligible} eligible · ${r.flagged} flagged · ${r.rejected} rejected (${r.changed} changed)`,
              )
            }
          >
            Re-run rules
          </button>
        }
      />
      <div className="tabs-row">
        {(["flagged", "rejected", "eligible"] as const).map((s) => (
          <button
            key={s}
            className={status === s ? "tab on" : "tab"}
            onClick={() => {
              setStatus(s);
              list.reset();
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <Loader query={list}>
        {(d) => (
          <>
            <DataTable
              rows={d.items}
              onRow={(r) => {
                setSelected(r);
                setOverride({ result: r.eligibility?.result === "eligible" ? "rejected" : "eligible", reason: "" });
              }}
              columns={[
                { key: "name", label: "Name" },
                { key: "college", label: "College" },
                { key: "result", label: "Result", render: (r) => <Status value={r.eligibility?.result} /> },
                { key: "reason", label: "Reason", render: (r) => r.eligibility?.reason ?? "—" },
                { key: "override", label: "Manual", render: (r) => (r.eligibility?.override ? "Yes" : "") },
              ]}
            />
            <Pager page={list.page} hasNext={list.hasNext} next={list.next} previous={list.previous} />
          </>
        )}
      </Loader>
      {selected && (
        <Dialog title={`Override: ${selected.name}`} onClose={() => setSelected(null)}>
          <p className="muted">Current: {selected.eligibility?.result} — {selected.eligibility?.reason}</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run("POST", `${base}/participants/${selected.id}/eligibility`, override, "Decision saved");
              if (ok) setSelected(null);
            }}
          >
            <Field label="Decision">
              <select value={override.result} onChange={(e) => setOverride({ ...override, result: e.target.value })}>
                <option value="eligible">Eligible</option>
                <option value="flagged">Flagged</option>
                <option value="rejected">Rejected</option>
              </select>
            </Field>
            <Field label="Reason (shown to the participant)">
              <textarea value={override.reason} onChange={(e) => setOverride({ ...override, reason: e.target.value })} required minLength={3} />
            </Field>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setSelected(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy || override.reason.trim().length < 3}>
                Save decision
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
