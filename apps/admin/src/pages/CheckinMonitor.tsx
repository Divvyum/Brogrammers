import { useState } from "react";
import { DataTable, Dialog, Loader, PageIntro, Pager, Panel, ReasonDialog, Status } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, useAllPages, usePaged } from "../lib/hooks";
import { fmtDate } from "../lib/format";
import { REJECT_TEXT } from "../scanner/verify";

// Check-in monitor (plan A14): live timeline with filters, resolve flagged
// check-ins, per-gate counts.

interface Checkin extends Record<string, unknown> {
  id: string;
  participantId: string;
  deviceId: string;
  volunteerUid: string;
  ts: string;
  method: string;
  result: string;
  rejectReason?: keyof typeof REJECT_TEXT;
  overrideNote?: string;
  processed: boolean;
  flagged: boolean;
  chain?: string;
  serverResult?: string;
  resolution?: { action: string; reason: string };
}

const FILTERS = ["all", "valid", "flagged", "rejected", "manual", "broken"] as const;

export function CheckinMonitor() {
  const { base } = useEvent();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const list = usePaged<Checkin>(base ? `${base}/checkins?filter=${filter}` : null, 50);
  const all = useAllPages<Checkin>(base ? `${base}/checkins?filter=all` : null);
  const { run, busy } = useAction();
  const [selected, setSelected] = useState<Checkin | null>(null);
  const [resolve, setResolve] = useState<"dismissed" | "made_official" | null>(null);

  // Per gate (device): totals and official check-ins.
  const gates = new Map<string, { total: number; official: number; flagged: number }>();
  for (const c of all.data ?? []) {
    const g = gates.get(c.deviceId) ?? { total: 0, official: 0, flagged: 0 };
    g.total++;
    if (c.serverResult === "official") g.official++;
    if (c.flagged) g.flagged++;
    gates.set(c.deviceId, g);
  }

  return (
    <div>
      <PageIntro
        eyebrow="GATE OPERATIONS"
        title="Check-in monitor"
        subtitle="Check-ins arrive as each scanner syncs. The earliest valid check-in per person becomes official; later ones are flagged."
        actions={
          <button className="secondary" disabled={busy} onClick={() => run<{ processed: number }>("POST", `${base}/checkins/process`, {}, (r) => `Processed ${r.processed}`)}>
            Process now
          </button>
        }
      />
      <Panel title="Gates">
        <div className="room-grid">
          {[...gates.entries()].map(([id, g]) => (
            <div key={id} className="room-tile">
              <b>{id}</b>
              <span>
                {g.official} official · {g.total} scans {g.flagged ? `· ${g.flagged} flagged` : ""}
              </span>
            </div>
          ))}
          {gates.size === 0 && <p className="hint">No scanner has synced yet.</p>}
        </div>
      </Panel>
      <div className="tabs-row">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={filter === f ? "tab on" : "tab"}
            onClick={() => {
              setFilter(f);
              list.reset();
            }}
          >
            {f}
          </button>
        ))}
      </div>
      <Loader query={list}>
        {(d) => (
          <>
            <DataTable
              rows={d.items}
              onRow={setSelected}
              columns={[
                { key: "ts", label: "Time (device)", render: (r) => fmtDate(r.ts) },
                { key: "participantId", label: "Participant" },
                { key: "deviceId", label: "Gate" },
                { key: "method", label: "Method" },
                { key: "result", label: "Device said", render: (r) => <Status value={r.result} /> },
                { key: "serverResult", label: "Server", render: (r) => <Status value={r.processed ? r.serverResult : "pending"} /> },
                { key: "flagged", label: "", render: (r) => (r.flagged ? <Status value="flagged" /> : "") },
              ]}
            />
            <Pager page={list.page} hasNext={list.hasNext} next={list.next} previous={list.previous} />
          </>
        )}
      </Loader>
      {selected && !resolve && (
        <Dialog title={`Check-in ${selected.id.slice(0, 8)}`} onClose={() => setSelected(null)}>
          <div className="detail-grid">
            <div>
              <small>PARTICIPANT</small>
              <b>{selected.participantId}</b>
            </div>
            <div>
              <small>GATE</small>
              <b>{selected.deviceId}</b>
            </div>
            <div>
              <small>VOLUNTEER</small>
              <b>{selected.volunteerUid}</b>
            </div>
            <div>
              <small>TIME</small>
              <b>{fmtDate(selected.ts)}</b>
            </div>
            <div>
              <small>CHAIN</small>
              <b>{selected.chain ?? "—"}</b>
            </div>
            <div>
              <small>SERVER</small>
              <b>{selected.serverResult ?? "pending"}</b>
            </div>
          </div>
          {selected.rejectReason && <p>Rejected on the device: {REJECT_TEXT[selected.rejectReason]}</p>}
          {selected.overrideNote && <p>Note: “{selected.overrideNote}”</p>}
          {selected.chain === "broken" && <div className="notice">This device's log was edited or has a gap, so this entry can't be trusted on its own.</div>}
          {selected.resolution && (
            <p className="muted">
              Resolved ({selected.resolution.action}): “{selected.resolution.reason}”
            </p>
          )}
          {selected.processed && (selected.flagged || selected.chain === "broken") && (
            <div className="dialog-actions">
              <button className="secondary" onClick={() => setResolve("dismissed")}>
                Dismiss flag
              </button>
              <button className="primary" onClick={() => setResolve("made_official")}>
                Make this the official check-in
              </button>
            </div>
          )}
        </Dialog>
      )}
      {selected && resolve && (
        <ReasonDialog
          title={resolve === "made_official" ? "Make official" : "Dismiss flag"}
          description={resolve === "made_official" ? "This becomes the participant's official check-in; any other is flagged as a duplicate." : "The check-in stays as it is, without the flag."}
          busy={busy}
          onClose={() => {
            setResolve(null);
            setSelected(null);
          }}
          onConfirm={(reason) => run("POST", `${base}/checkins/${selected.id}/resolve`, { action: resolve, reason }, "Resolved")}
        />
      )}
    </div>
  );
}
