import { useMemo, useState } from "react";
import { DataTable, Loader, PageIntro, ReasonDialog, StatCard, Status } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, useAllPages } from "../lib/hooks";
import type { ParticipantRow } from "./Participants";

// Digital ID management (plan A12): enrollment status per participant,
// bulk enrollment links, revoke and reissue.

export function DigitalIds() {
  const { base } = useEvent();
  const all = useAllPages<ParticipantRow>(base ? `${base}/participants` : null);
  const { run, busy } = useAction();
  const [filter, setFilter] = useState<"all" | "not sent" | "invited" | "enrolled" | "revoked">("all");
  const [pending, setPending] = useState<null | { kind: "revoke" | "reissue"; p: ParticipantRow }>(null);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => (all.data ?? []).filter((p) => !p.mergedInto), [all.data]);
  const statusOf = (p: ParticipantRow) => p.enrollment?.status ?? "not sent";
  const counts = rows.reduce<Record<string, number>>((m, p) => ({ ...m, [statusOf(p)]: (m[statusOf(p)] ?? 0) + 1 }), {});

  return (
    <div>
      <PageIntro
        eyebrow="CREDENTIALS"
        title="Digital IDs"
        subtitle="Each participant enrolls one phone. A revoked ID is rejected by scanners after their next roster sync."
        actions={
          <button className="primary" disabled={busy} onClick={() => run<{ sent: number }>("POST", `${base}/enrollment/send`, {}, (r) => `Enrollment links queued for ${r.sent} people`)}>
            Send links to everyone eligible
          </button>
        }
      />
      <div className="stat-grid">
        <StatCard label="Not sent" value={counts["not sent"] ?? 0} />
        <StatCard label="Invited" value={counts.invited ?? 0} foot="link sent, not enrolled yet" />
        <StatCard label="Enrolled" value={counts.enrolled ?? 0} />
        <StatCard label="Revoked" value={counts.revoked ?? 0} />
      </div>
      <div className="toolbar">
        <input placeholder="Search name or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          {["all", "not sent", "invited", "enrolled", "revoked"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <Loader query={all}>
        {() => (
          <DataTable
            rows={rows.filter((p) => (filter === "all" || statusOf(p) === filter) && (!search || `${p.name} ${p.id}`.toLowerCase().includes(search.toLowerCase()))).slice(0, 200)}
            columns={[
              { key: "name", label: "Name" },
              { key: "eligibility", label: "Eligibility", render: (r) => <Status value={r.eligibility?.result} /> },
              { key: "enrollment", label: "Digital ID", render: (r) => <Status value={statusOf(r)} /> },
              { key: "teamId", label: "Team" },
              {
                key: "act",
                label: "",
                render: (r) => (
                  <div className="button-row">
                    {statusOf(r) === "not sent" && (
                      <button className="secondary" disabled={busy} onClick={() => run("POST", `${base}/enrollment/send`, { uids: [r.id] }, "Link queued")}>
                        Send link
                      </button>
                    )}
                    {statusOf(r) === "invited" && (
                      <button className="secondary" disabled={busy} onClick={() => run("POST", `${base}/enrollment/send`, { uids: [r.id] }, "New link queued; the old one stops working")}>
                        Resend
                      </button>
                    )}
                    {statusOf(r) !== "not sent" && (
                      <button className="secondary" onClick={() => setPending({ kind: "reissue", p: r })}>
                        Reissue
                      </button>
                    )}
                    {statusOf(r) === "enrolled" && (
                      <button className="secondary danger-text" onClick={() => setPending({ kind: "revoke", p: r })}>
                        Revoke
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Loader>
      {pending && (
        <ReasonDialog
          title={pending.kind === "revoke" ? `Revoke ${pending.p.name}'s ID` : `Reissue ${pending.p.name}'s ID`}
          description={
            pending.kind === "revoke"
              ? "Scanners reject this ID after their next roster sync. Use reissue instead if they just changed phones."
              : "Their current phone stops working and a new enrollment link is sent."
          }
          busy={busy}
          onClose={() => setPending(null)}
          onConfirm={(reason) => run("POST", `${base}/participants/${pending.p.id}/${pending.kind}`, { reason }, pending.kind === "revoke" ? "Revoked" : "Reissued")}
        />
      )}
    </div>
  );
}
