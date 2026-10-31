import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Confirm, DataTable, Loader, PageIntro, Panel, Status } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, useApi } from "../lib/hooks";
import { fmtDate } from "../lib/format";

// Results (plan A23): judge consistency report, leaderboard preview with
// breakdowns, visibility toggle, publish results, issue certificates.

interface Row extends Record<string, unknown> {
  rank: number;
  teamId: string;
  teamName: string;
  total: number;
  judges: number;
  breakdown: Record<string, number>;
}
interface Consistency {
  judgeUid: string;
  average: number;
  count: number;
  z: number;
}

export function Results() {
  const { base, event } = useEvent();
  const lb = useApi<{ teams: Row[]; outlierJudges: { judgeUid: string }[] }>(base ? `${base}/leaderboard` : null);
  const cons = useApi<{ consistency: Consistency[]; outlierJudges: { judgeUid: string }[] }>(base ? `${base}/judging/consistency` : null);
  const judges = useApi<{ items: { uid: string; name: string }[] }>(base ? `${base}/judges` : null);
  const certs = useApi<{ items: { id: string; type: string; name: string; rank?: number; issuedAt: string }[] }>(base ? `${base}/certificates` : null);
  const { run, busy } = useAction();
  const [confirm, setConfirm] = useState<null | "publish" | "participation" | "winner" | "mentor">(null);
  const judgeName = (uid: string) => judges.data?.items.find((j) => j.uid === uid)?.name ?? uid;
  const criteria = Object.keys(lb.data?.teams[0]?.breakdown ?? {});

  return (
    <div>
      <PageIntro
        eyebrow="JUDGING"
        title="Results"
        subtitle={event?.resultsPublishedAt ? `Published ${fmtDate(event.resultsPublishedAt)}` : "Not published yet. Only locked scores count."}
        actions={
          <>
            <button className="secondary" disabled={busy} onClick={() => run("POST", `${base}/leaderboard/recompute`, {}, "Leaderboard recomputed")}>
              Recompute
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(event?.leaderboardVisible)}
                onChange={(e) => run("POST", `${base}/results/visibility`, { visible: e.target.checked }, e.target.checked ? "Leaderboard visible to participants" : "Leaderboard hidden")}
              />
              Visible to participants
            </label>
            <button className="primary" onClick={() => setConfirm("publish")}>
              Publish results
            </button>
          </>
        }
      />

      <Panel title="Judge consistency">
        <Loader query={cons}>
          {(d) => (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={d.consistency.map((c) => ({ ...c, name: judgeName(c.judgeUid) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis domain={[-2.5, 2.5]} />
                  <Tooltip formatter={(v) => [String(v), "z-score"]} />
                  <ReferenceLine y={1.5} stroke="#c9553f" strokeDasharray="4 4" />
                  <ReferenceLine y={-1.5} stroke="#c9553f" strokeDasharray="4 4" />
                  <Bar dataKey="z">
                    {d.consistency.map((c) => (
                      <Cell key={c.judgeUid} fill={Math.abs(c.z) >= 1.5 ? "#c9553f" : "#1f6a4b"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {d.outlierJudges.length ? (
                <div className="notice">
                  Outliers: {d.outlierJudges.map((o) => judgeName(o.judgeUid)).join(", ")}. Their average is far from the panel's; consider adding another judge to their teams.
                </div>
              ) : (
                <p className="hint">All judges are within 1.5 standard deviations of the panel.</p>
              )}
              <DataTable
                rows={d.consistency as unknown as Record<string, unknown>[]}
                rowKey={(r) => String(r.judgeUid)}
                columns={[
                  { key: "judgeUid", label: "Judge", render: (r) => judgeName(String(r.judgeUid)) },
                  { key: "count", label: "Teams scored" },
                  { key: "average", label: "Average total" },
                  { key: "z", label: "z-score" },
                ]}
              />
            </>
          )}
        </Loader>
      </Panel>

      <Panel title="Leaderboard">
        <Loader query={lb}>
          {(d) => (
            <DataTable
              rows={d.teams}
              rowKey={(r) => r.teamId}
              empty="No locked scores yet."
              columns={[
                { key: "rank", label: "#" },
                { key: "teamName", label: "Team" },
                { key: "total", label: "Total" },
                ...criteria.map((c) => ({ key: c, label: c, render: (r: Row) => r.breakdown[c] })),
                { key: "judges", label: "Judges" },
              ]}
            />
          )}
        </Loader>
      </Panel>

      <Panel title="Certificates">
        <div className="button-row">
          <button className="secondary" onClick={() => setConfirm("participation")}>
            Issue participation (checked-in people)
          </button>
          <button className="secondary" onClick={() => setConfirm("winner")}>
            Issue winners (top 3 teams)
          </button>
          <button className="secondary" onClick={() => setConfirm("mentor")}>
            Issue mentor certificates
          </button>
        </div>
        <Loader query={certs}>
          {(d) => (
            <DataTable
              rows={d.items as unknown as Record<string, unknown>[]}
              empty="None issued yet."
              columns={[
                { key: "name", label: "Name" },
                { key: "type", label: "Type", render: (r) => <Status value={String(r.type)} /> },
                { key: "rank", label: "Rank" },
                { key: "issuedAt", label: "Issued", render: (r) => fmtDate(r.issuedAt) },
                {
                  key: "id",
                  label: "",
                  render: (r) => (
                    <a href={`/api/public/certificates/${String(r.id)}/pdf`} target="_blank" rel="noreferrer">
                      PDF
                    </a>
                  ),
                },
              ]}
            />
          )}
        </Loader>
      </Panel>

      {confirm === "publish" && (
        <Confirm
          title="Publish results?"
          description="The leaderboard becomes visible and every participant gets a WhatsApp message. Do this once judging is finished."
          confirmLabel="Publish"
          busy={busy}
          onClose={() => setConfirm(null)}
          onConfirm={() => run<{ notified: number }>("POST", `${base}/results/publish`, {}, (r) => `Published · ${r.notified} people notified`)}
        />
      )}
      {confirm && confirm !== "publish" && (
        <Confirm
          title={`Issue ${confirm} certificates?`}
          description="Each person gets a WhatsApp message with their certificate link. Nobody gets the same certificate twice."
          confirmLabel="Issue"
          busy={busy}
          onClose={() => setConfirm(null)}
          onConfirm={() => run<{ issued: number; skipped: number }>("POST", `${base}/certificates/issue`, { type: confirm, topTeams: 3 }, (r) => `Issued ${r.issued} (${r.skipped} already had one)`)}
        />
      )}
    </div>
  );
}
