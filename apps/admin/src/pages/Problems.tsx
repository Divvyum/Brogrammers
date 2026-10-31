import { useState } from "react";
import { DateTimeInput, Dialog, Field, Loader, PageIntro, Status } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, useApi } from "../lib/hooks";
import { fmtDate } from "../lib/format";
import { useCountdown } from "./Teams";

// Problem statements (plan A16): per track, with a release time, countdown and
// preview. Participants can only read a problem once it's released.

interface Problem {
  id: string;
  track: string;
  title: string;
  body: string;
  releaseAt: string;
  released: boolean;
}

function Release({ p }: { p: Problem }) {
  const c = useCountdown(p.releaseAt);
  return p.released ? <Status value="released" /> : <span className="tag">releases in {c}</span>;
}

export function Problems() {
  const { base, event } = useEvent();
  const list = useApi<{ items: Problem[] }>(base ? `${base}/problems` : null, { refetchInterval: 30_000 });
  const { run, busy } = useAction();
  const [edit, setEdit] = useState<Partial<Problem> | null>(null);
  const [preview, setPreview] = useState<Problem | null>(null);

  return (
    <div>
      <PageIntro
        eyebrow="EVENT DAY"
        title="Problem statements"
        subtitle="Released automatically at their time; the track is told on WhatsApp and by push."
        actions={
          <button className="primary" onClick={() => setEdit({ track: event?.tracks[0], releaseAt: event?.startAt })}>
            + Problem statement
          </button>
        }
      />
      <Loader query={list}>
        {(d) => (
          <div className="card-grid">
            {(event?.tracks ?? []).map((track) => {
              const items = d.items.filter((p) => p.track === track);
              return (
                <div key={track} className="panel">
                  <h3>{track}</h3>
                  {items.length === 0 && <p className="hint">No statement yet.</p>}
                  {items.map((p) => (
                    <div key={p.id} className="problem">
                      <b>{p.title}</b>
                      <small className="muted">{fmtDate(p.releaseAt)}</small>
                      <Release p={p} />
                      <div className="button-row">
                        <button className="text-button" onClick={() => setPreview(p)}>
                          Preview
                        </button>
                        <button className="text-button" onClick={() => setEdit(p)}>
                          Edit
                        </button>
                        {!p.released && (
                          <button className="text-button" disabled={busy} onClick={() => run("POST", `${base}/problems/${p.id}/release`, {}, "Released now")}>
                            Release now
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Loader>
      {preview && (
        <Dialog title={`${preview.track}: ${preview.title}`} onClose={() => setPreview(null)}>
          <p className="muted">What participants see once it's released:</p>
          <div className="preview-box">
            <h3>{preview.title}</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{preview.body}</p>
          </div>
        </Dialog>
      )}
      {edit && <ProblemDialog problem={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ProblemDialog({ problem, onClose }: { problem: Partial<Problem>; onClose: () => void }) {
  const { base, event } = useEvent();
  const { run, busy } = useAction();
  const [p, setP] = useState({ track: problem.track ?? "", title: problem.title ?? "", body: problem.body ?? "", releaseAt: problem.releaseAt ?? "" });
  const save = async () => {
    const ok = problem.id ? await run("PATCH", `${base}/problems/${problem.id}`, p, "Saved") : await run("POST", `${base}/problems`, p, "Scheduled");
    if (ok) onClose();
  };
  return (
    <Dialog title={problem.id ? "Edit problem statement" : "New problem statement"} onClose={onClose}>
      <Field label="Track">
        <select value={p.track} disabled={problem.released} onChange={(e) => setP({ ...p, track: e.target.value })}>
          {event?.tracks.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Field>
      <Field label="Title">
        <input value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
      </Field>
      <Field label="Statement">
        <textarea rows={8} value={p.body} onChange={(e) => setP({ ...p, body: e.target.value })} />
      </Field>
      <Field label="Release at" hint={problem.released ? "Already released: only the text can change." : undefined}>
        <DateTimeInput value={p.releaseAt} onChange={(v) => setP({ ...p, releaseAt: v })} />
      </Field>
      <div className="dialog-actions">
        {problem.id && !problem.released && (
          <button className="secondary danger-text" disabled={busy} onClick={async () => (await run("DELETE", `${base}/problems/${problem.id}`, undefined, "Deleted")) && onClose()}>
            Delete
          </button>
        )}
        <button className="primary" disabled={busy || !p.title || !p.body || !p.releaseAt} onClick={save}>
          Save
        </button>
      </div>
    </Dialog>
  );
}
