import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Field, Loader, PageIntro, Panel, Status } from "../components/common";
import { useSession } from "../auth/Session";
import { useEvent } from "../lib/event";
import { useAction, useApi } from "../lib/hooks";
import { fmtDate } from "../lib/format";

// Judge panel (plan A22), built for tablets: assigned teams with progress,
// submission viewer (PPT/PDF, video, GitHub insights with commit timeline and
// contributors, AI summary) and the rubric scoring form.

interface SubRow {
  teamId: string;
  teamName: string;
  track: string | null;
  repoUrl?: string;
  github: { repo: string; commits: number; flags: number; outsiders: string[] } | null;
}
interface Commit {
  sha: string;
  date: string;
  author: string;
  message: string;
  uid?: string;
  flag?: "before_start" | "after_deadline";
}
interface SubDetail {
  teamId: string;
  pptUrl?: string;
  videoUrl?: string;
  repoUrl?: string;
  submittedAt: string;
  version: number;
  receiptId: string;
  description?: string;
  aiSummary?: string;
  githubError?: string;
  github?: {
    repo: string;
    commits: number;
    timeline: Commit[];
    contributors: { login: string; commits: number; additions?: number; deletions?: number; uid?: string }[];
    flags: { sha: string; reason: string }[];
    outsiders: string[];
    readme?: string;
    fetchedAt?: string;
  };
  versions: { version: number; submittedAt: string; receiptId: string }[];
}
interface Criterion {
  id: string;
  name: string;
  weight: number;
  max: number;
}
interface Score {
  teamId: string;
  judgeUid: string;
  criteria: Record<string, number>;
  total: number;
  comment?: string;
  locked: boolean;
}

/** YouTube / Drive link → embeddable URL. */
export function embedUrl(url?: string): string | null {
  if (!url) return null;
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const drive = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(url);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  return null;
}

/** PDFs open directly; PowerPoint files through Microsoft's online viewer. */
function docViewer(url?: string): string | null {
  if (!url) return null;
  if (/\.pptx?($|\?)/i.test(url)) return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
  return url;
}

export function JudgePanel() {
  const { base } = useEvent();
  const { role, user } = useSession();
  const subs = useApi<{ items: SubRow[] }>(base ? `${base}/submissions` : null);
  const scores = useApi<{ items: Score[] }>(base ? `${base}/scores` : null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const mine = (scores.data?.items ?? []).filter((s) => role !== "judge" || s.judgeUid === user?.uid);
  const scored = new Map(mine.map((s) => [s.teamId, s]));
  const done = (subs.data?.items ?? []).filter((s) => scored.get(s.teamId)?.locked).length;

  return (
    <div className="judge-panel">
      <PageIntro eyebrow="JUDGING" title="Judge panel" subtitle={subs.data ? `${done} of ${subs.data.items.length} submitted` : undefined} />
      <div className="judge-layout">
        <Panel title="Your teams" className="judge-list">
          <Loader query={subs}>
            {(d) => (
              <ul className="team-pick">
                {d.items.length === 0 && <li className="hint">No submissions assigned to you yet.</li>}
                {d.items.map((s) => {
                  const sc = scored.get(s.teamId);
                  return (
                    <li key={s.teamId}>
                      <button className={teamId === s.teamId ? "on" : ""} onClick={() => setTeamId(s.teamId)}>
                        <span>
                          <b>{s.teamName}</b>
                          <small>
                            {s.track ?? ""} {s.github?.flags ? `· ⚑ ${s.github.flags} flagged commits` : ""}
                          </small>
                        </span>
                        <Status value={sc ? (sc.locked ? "submitted" : "draft") : "to score"} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Loader>
        </Panel>
        <div className="judge-detail">{teamId ? <Submission teamId={teamId} existing={scored.get(teamId)} /> : <div className="panel blank"><h2>Pick a team</h2><p>Open a team on the left to see their submission and score it.</p></div>}</div>
      </div>
    </div>
  );
}

function Submission({ teamId, existing }: { teamId: string; existing?: Score }) {
  const { base } = useEvent();
  const { role } = useSession();
  const sub = useApi<SubDetail>(`${base}/submissions/${teamId}`);
  const { run, busy } = useAction();

  return (
    <Loader query={sub}>
      {(s) => {
        const video = embedUrl(s.videoUrl);
        const doc = docViewer(s.pptUrl);
        return (
          <div>
            <Panel title={`Submission v${s.version}`} actions={<small className="muted">Received {fmtDate(s.submittedAt)} · receipt {s.receiptId}</small>}>
              {s.description && <p>{s.description}</p>}
              <div className="viewer-grid">
                {doc ? <iframe title="Presentation" src={doc} className="viewer" /> : <div className="viewer empty">No presentation uploaded</div>}
                {video ? (
                  <iframe title="Demo video" src={video} className="viewer" allow="encrypted-media; picture-in-picture" allowFullScreen />
                ) : (
                  <div className="viewer empty">{s.videoUrl ? <a href={s.videoUrl} target="_blank" rel="noreferrer">Open video</a> : "No video"}</div>
                )}
              </div>
              {s.versions.length > 1 && (
                <p className="hint">
                  Versions: {s.versions.map((v) => `v${v.version} (${fmtDate(v.submittedAt)})`).join(" · ")}
                </p>
              )}
            </Panel>
            <GithubInsights s={s} onRefresh={() => run("POST", `${base}/submissions/${teamId}/github/refresh`, {}, "GitHub data refreshed")} busy={busy} />
            <Panel
              title="AI summary"
              actions={
                role !== "judge" && (
                  <button className="secondary" disabled={busy} onClick={() => run("POST", `${base}/submissions/${teamId}/ai-summary`, {}, "Summary written")}>
                    {s.aiSummary ? "Rewrite" : "Write summary"}
                  </button>
                )
              }
            >
              {s.aiSummary ? <p style={{ whiteSpace: "pre-wrap" }}>{s.aiSummary}</p> : <p className="hint">No summary yet.</p>}
            </Panel>
            <ScoreForm key={`${teamId}:${existing?.total ?? "new"}:${existing?.locked ?? false}`} teamId={teamId} existing={existing} />
          </div>
        );
      }}
    </Loader>
  );
}

function GithubInsights({ s, onRefresh, busy }: { s: SubDetail; onRefresh: () => void; busy: boolean }) {
  const gh = s.github;
  const perDay = useMemo(() => {
    const m = new Map<string, { day: string; ok: number; flagged: number }>();
    for (const c of [...(gh?.timeline ?? [])].reverse()) {
      const day = c.date.slice(0, 10);
      const row = m.get(day) ?? { day, ok: 0, flagged: 0 };
      if (c.flag) row.flagged++;
      else row.ok++;
      m.set(day, row);
    }
    return [...m.values()];
  }, [gh]);

  return (
    <Panel
      title={gh ? `GitHub · ${gh.repo}` : "GitHub"}
      actions={
        <span className="inline-row">
          {gh?.fetchedAt && <small className="muted">updated {fmtDate(gh.fetchedAt)}</small>}
          {s.repoUrl && (
            <button className="secondary" disabled={busy} onClick={onRefresh}>
              Refresh
            </button>
          )}
        </span>
      }
    >
      {s.githubError && <div className="notice">{s.githubError}</div>}
      {!gh ? (
        <p className="hint">{s.repoUrl ? "Not fetched yet. Press Refresh." : "No repository link."}</p>
      ) : (
        <>
          <div className="stat-grid three">
            <div className="mini-stat">
              <b>{gh.commits}</b> commits
            </div>
            <div className="mini-stat">
              <b className={gh.flags.length ? "danger-text" : ""}>{gh.flags.length}</b> outside the event window
            </div>
            <div className="mini-stat">
              <b className={gh.outsiders.length ? "danger-text" : ""}>{gh.outsiders.length}</b> authors not on the team
            </div>
          </div>
          <h4>Commits per day</h4>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={perDay}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" fontSize={10} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="ok" stackId="a" name="In window" fill="#6366f1" />
              <Bar dataKey="flagged" stackId="a" name="Flagged" fill="#f43f5e" />
            </BarChart>
          </ResponsiveContainer>
          <h4>Contributors</h4>
          <ResponsiveContainer width="100%" height={Math.max(80, gh.contributors.length * 28)}>
            <BarChart data={gh.contributors.slice(0, 10)} layout="vertical" margin={{ left: 30 }}>
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="login" width={110} fontSize={11} />
              <Tooltip />
              <Bar dataKey="commits">
                {gh.contributors.slice(0, 10).map((c) => (
                  <Cell key={c.login} fill={c.uid ? "#6366f1" : "#f59e0b"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <small className="hint">Green: matched to a team member by GitHub username. Gold: not on the team.</small>
          <h4>Flagged commits</h4>
          <ul className="commit-list">
            {gh.timeline
              .filter((c) => c.flag)
              .slice(0, 15)
              .map((c) => (
                <li key={c.sha}>
                  <code>{c.sha.slice(0, 7)}</code> {fmtDate(c.date)} · {c.author} · {c.message} <span className="tag danger">{c.flag?.replace("_", " ")}</span>
                </li>
              ))}
            {gh.flags.length === 0 && <li className="hint">None. Every commit is inside the event window.</li>}
          </ul>
          {gh.readme && (
            <details>
              <summary>README</summary>
              <pre className="readme">{gh.readme}</pre>
            </details>
          )}
        </>
      )}
    </Panel>
  );
}

function ScoreForm({ teamId, existing }: { teamId: string; existing?: Score }) {
  const { base } = useEvent();
  const { role } = useSession();
  const rubric = useApi<{ criteria: Criterion[] }>(`${base}/rubric/current`);
  const { run, busy } = useAction();
  // Initial values come from the saved score; the parent remounts this form
  // (key) when the team or the saved score changes.
  const [values, setValues] = useState<Record<string, number>>(existing?.criteria ?? {});
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [reason, setReason] = useState("");

  const criteria = rubric.data?.criteria ?? [];
  const total = criteria.reduce((t, c) => t + ((values[c.id] ?? 0) / c.max) * c.weight, 0);
  const complete = criteria.every((c) => values[c.id] !== undefined);
  const locked = existing?.locked;
  const judgeQuery = role === "judge" ? "" : existing ? `?judgeUid=${existing.judgeUid}` : null;

  const save = (submit: boolean) =>
    run<{ total: number; locked: boolean }>(
      "PUT",
      `${base}/scores/${teamId}${judgeQuery ?? ""}`,
      { criteria: values, comment: comment || undefined, submit, reason: locked ? reason : undefined, round: "current" },
      (r) => (r.locked ? `Submitted: ${r.total}/100` : `Draft saved: ${r.total}/100`),
    );

  if (role !== "judge" && judgeQuery === null) return <Panel title="Score"><p className="hint">Organizers can only correct an existing judge's score.</p></Panel>;

  return (
    <Panel title="Score" actions={<span className="score-total">{Math.round(total * 100) / 100} / 100</span>}>
      <Loader query={rubric}>
        {() => (
          <>
            {criteria.map((c) => (
              <div key={c.id} className="score-row">
                <label htmlFor={`c-${c.id}`}>
                  <b>{c.name}</b> <small className="muted">weight {c.weight}%</small>
                </label>
                <input id={`c-${c.id}`} type="range" min={0} max={c.max} step={1} value={values[c.id] ?? 0} onChange={(e) => setValues({ ...values, [c.id]: Number(e.target.value) })} />
                <output>
                  {values[c.id] ?? "–"} / {c.max}
                </output>
              </div>
            ))}
            <Field label="Feedback for the team">
              <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            {locked && (
              <Field label="Reason for changing a submitted score (required, audited)">
                <input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
            <div className="button-row end">
              {!locked && (
                <button className="secondary" disabled={busy || !complete} onClick={() => save(false)}>
                  Save draft
                </button>
              )}
              <button className="primary" disabled={busy || !complete || (locked && reason.trim().length < 3)} onClick={() => save(true)}>
                {locked ? "Save change" : "Submit and lock"}
              </button>
            </div>
          </>
        )}
      </Loader>
    </Panel>
  );
}
