import { useState } from "react";
import { DataTable, Dialog, Loader, PageIntro, Panel } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, useApi } from "../lib/hooks";

// Judging setup (plan A21): rubric builder with a live weight total that must
// equal 100, judge assignment (manual + auto-balance), assignments overview.

interface Criterion {
  id: string;
  name: string;
  weight: number;
  max: number;
}
interface Judge extends Record<string, unknown> {
  uid: string;
  name: string;
  teamIds: string[];
}

export function JudgingSetup() {
  const { base, event } = useEvent();
  const rounds = ["current", ...(event?.rounds ?? []).map((r) => r.id)];
  const [round, setRound] = useState("current");
  const rubric = useApi<{ criteria: Criterion[] }>(base ? `${base}/rubric/${round}` : null);
  const judges = useApi<{ items: Judge[] }>(base ? `${base}/judges` : null);
  const teams = useApi<{ items: { id: string; name: string }[] }>(base ? `${base}/teams?limit=50` : null);
  const { run, busy } = useAction();
  const [perTeam, setPerTeam] = useState(2);
  const [assign, setAssign] = useState<Judge | null>(null);
  const loads = (judges.data?.items ?? []).map((j) => j.teamIds.length);

  return (
    <div>
      <PageIntro eyebrow="JUDGING" title="Judging setup" subtitle="The rubric locks once the first score in a round is submitted." />
      <RubricEditor
        key={`${round}:${rubric.dataUpdatedAt}:${rubric.errorUpdatedAt}`}
        round={round}
        rounds={rounds}
        onRound={setRound}
        initial={rubric.data?.criteria ?? [{ id: "innovation", name: "Innovation", weight: 100, max: 10 }]}
      />

      <Panel
        title="Judges"
        actions={
          <div className="inline-row">
            <label className="check">
              Judges per team <input type="number" min={1} max={10} value={perTeam} onChange={(e) => setPerTeam(Number(e.target.value))} style={{ width: 60 }} />
            </label>
            <button className="primary" disabled={busy} onClick={() => run<{ loads: Record<string, number> }>("POST", `${base}/judges/auto-assign`, { judgesPerTeam: perTeam }, (r) => `Balanced: ${Object.values(r.loads).join(", ")} teams each`)}>
              Auto-assign
            </button>
          </div>
        }
      >
        <Loader query={judges}>
          {(d) => (
            <>
              <DataTable
                rows={d.items}
                rowKey={(r) => r.uid}
                onRow={setAssign}
                empty="No judges yet. Add them on the Staff screen."
                columns={[
                  { key: "name", label: "Judge" },
                  { key: "teams", label: "Teams", render: (r) => r.teamIds.length },
                  { key: "teamIds", label: "Assigned", render: (r) => r.teamIds.slice(0, 8).join(", ") + (r.teamIds.length > 8 ? "…" : "") },
                ]}
              />
              {loads.length > 0 && (
                <p className="hint">
                  Load: {Math.min(...loads)}–{Math.max(...loads)} teams per judge{Math.max(...loads) - Math.min(...loads) <= 1 ? " (balanced)" : ""}
                </p>
              )}
            </>
          )}
        </Loader>
      </Panel>
      {assign && <AssignDialog judge={assign} teams={teams.data?.items ?? []} onClose={() => setAssign(null)} />}
    </div>
  );
}

function AssignDialog({ judge, teams, onClose }: { judge: Judge; teams: { id: string; name: string }[]; onClose: () => void }) {
  const { base } = useEvent();
  const { run, busy } = useAction();
  const [chosen, setChosen] = useState<string[]>(judge.teamIds);
  return (
    <Dialog title={`Teams for ${judge.name}`} onClose={onClose}>
      <div className="chip-list scroll">
        {teams.map((t) => (
          <button key={t.id} type="button" className={chosen.includes(t.id) ? "chip on" : "chip"} onClick={() => setChosen(chosen.includes(t.id) ? chosen.filter((x) => x !== t.id) : [...chosen, t.id])}>
            {t.name}
          </button>
        ))}
      </div>
      <div className="dialog-actions">
        <span className="hint">{chosen.length} selected</span>
        <button className="primary" disabled={busy} onClick={async () => (await run("PUT", `${base}/judges/${judge.uid}/assignments`, { teamIds: chosen }, "Assignments saved")) && onClose()}>
          Save
        </button>
      </div>
    </Dialog>
  );
}

/** Remounted (via key) when the round or its saved rubric changes. */
function RubricEditor({ round, rounds, onRound, initial }: { round: string; rounds: string[]; onRound: (r: string) => void; initial: Criterion[] }) {
  const { base, event } = useEvent();
  const { run, busy } = useAction();
  const [criteria, setCriteria] = useState<Criterion[]>(initial);
  const total = criteria.reduce((t, c) => t + (Number(c.weight) || 0), 0);
  const ids = criteria.map((c) => c.id);
  const valid = total === 100 && criteria.every((c) => c.id && c.name && c.max > 0) && new Set(ids).size === ids.length;
  const update = (i: number, patch: Partial<Criterion>) => setCriteria(criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
      <Panel
        title="Rubric"
        actions={
          <select value={round} onChange={(e) => onRound(e.target.value)}>
            {rounds.map((r) => (
              <option key={r} value={r}>
                {r === "current" ? "Main round" : event?.rounds?.find((x) => x.id === r)?.name ?? r}
              </option>
            ))}
          </select>
        }
      >
        <table className="edit-table">
          <thead>
            <tr>
              <th>Criterion</th>
              <th>ID</th>
              <th>Weight %</th>
              <th>Max score</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {criteria.map((c, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={c.name}
                    onChange={(e) => update(i, { name: e.target.value, id: c.id || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_") })}
                  />
                </td>
                <td>
                  <input value={c.id} onChange={(e) => update(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
                </td>
                <td>
                  <input type="number" min={0} max={100} value={c.weight} onChange={(e) => update(i, { weight: Number(e.target.value) })} />
                </td>
                <td>
                  <input type="number" min={1} value={c.max} onChange={(e) => update(i, { max: Number(e.target.value) })} />
                </td>
                <td>
                  <button className="text-button" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="toolbar between">
          <button className="secondary" onClick={() => setCriteria([...criteria, { id: "", name: "", weight: 0, max: 10 }])}>
            + Criterion
          </button>
          <span className={total === 100 ? "weight-ok" : "weight-bad"}>Total weight: {total} / 100</span>
          <button className="primary" disabled={busy || !valid} onClick={() => run("PUT", `${base}/rubric/${round}`, { criteria }, "Rubric saved")}>
            Save rubric
          </button>
        </div>
      </Panel>
  );
}
