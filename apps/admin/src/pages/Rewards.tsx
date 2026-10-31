import { useState } from "react";
import { REWARD_TRANSITIONS } from "@hackos/shared";
import { DataTable, DateTimeInput, Dialog, Field, Loader, PageIntro, Panel, Status } from "../components/common";
import { api } from "../api/client";
import { useEvent } from "../lib/event";
import { errorMessage, useAction, useApi } from "../lib/hooks";
import { fmtDate } from "../lib/format";
import { useToast } from "../ui/ToastContext";

// RewardLink, complaints and ratings (plan A24): reward registry with a status
// pipeline, proof upload, overdue badges; complaints inbox with respond and
// escalate; ratings with responses.

interface Reward extends Record<string, unknown> {
  id: string;
  prize: string;
  amount?: number;
  type: string;
  sponsor?: string;
  winnerTeamId?: string;
  dueAt: string;
  status: string;
  proofUrl?: string;
  overdue?: boolean;
  history: { at: string; by: string; status: string; note?: string }[];
}
interface Complaint extends Record<string, unknown> {
  id: string;
  uid: string;
  rewardId?: string;
  text: string;
  evidenceUrls: string[];
  status: string;
  deadline: string;
  history: { at: string; by: string; note: string }[];
}
interface Rating extends Record<string, unknown> {
  uid: string;
  scores: Record<string, number>;
  text?: string;
  response?: string;
}

const PIPELINE = ["announced", "verified", "processing", "delivered"];

export function Rewards() {
  const { base } = useEvent();
  const rewards = useApi<{ items: Reward[] }>(base ? `${base}/rewards` : null);
  const complaints = useApi<{ items: Complaint[] }>(base ? `${base}/complaints` : null);
  const ratings = useApi<{ count: number; averages: Record<string, number | null>; items: Rating[] }>(base ? `${base}/ratings` : null);
  const [reward, setReward] = useState<Partial<Reward> | null>(null);
  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [rating, setRating] = useState<Rating | null>(null);

  return (
    <div>
      <PageIntro
        eyebrow="AFTER THE EVENT"
        title="Rewards & feedback"
        subtitle="Every prize is tracked to delivery with proof. Overdue rewards and unanswered complaints are flagged automatically."
        actions={
          <button className="primary" onClick={() => setReward({})}>
            + Reward
          </button>
        }
      />
      <Panel title="Rewards">
        <Loader query={rewards}>
          {(d) => (
            <div className="card-list">
              {d.items.length === 0 && <p className="hint">No rewards yet.</p>}
              {d.items.map((r) => (
                <button key={r.id} className="reward-card" onClick={() => setReward(r)}>
                  <div>
                    <b>{r.prize}</b> {r.overdue && <span className="tag danger">overdue</span>}
                    <small className="muted">
                      {r.amount ? `₹${r.amount.toLocaleString("en-IN")} · ` : ""}
                      {r.type} {r.sponsor ? `· ${r.sponsor}` : ""} · team {r.winnerTeamId ?? "—"} · due {fmtDate(r.dueAt)}
                    </small>
                  </div>
                  <ol className="pipeline">
                    {PIPELINE.map((s) => (
                      <li key={s} className={r.status === "disputed" ? "" : PIPELINE.indexOf(s) <= PIPELINE.indexOf(r.status) ? "done" : ""}>
                        {s}
                      </li>
                    ))}
                    {r.status === "disputed" && <li className="bad">disputed</li>}
                  </ol>
                </button>
              ))}
            </div>
          )}
        </Loader>
      </Panel>

      <Panel title="Complaints">
        <Loader query={complaints}>
          {(d) => (
            <DataTable
              rows={d.items}
              onRow={setComplaint}
              empty="No complaints."
              columns={[
                { key: "text", label: "Complaint" },
                { key: "uid", label: "From" },
                { key: "deadline", label: "Answer by", render: (r) => <span className={new Date(r.deadline) < new Date() && !["resolved"].includes(r.status) ? "danger-text" : ""}>{fmtDate(r.deadline)}</span> },
                { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
              ]}
            />
          )}
        </Loader>
      </Panel>

      <Panel title={`Ratings (${ratings.data?.count ?? 0})`}>
        <Loader query={ratings}>
          {(d) => (
            <>
              <div className="rating-bars">
                {Object.entries(d.averages).map(([k, v]) => (
                  <div key={k}>
                    <span>{k}</span>
                    <div className="bar">
                      <div style={{ width: `${((v ?? 0) / 5) * 100}%` }} />
                    </div>
                    <b>{v ?? "—"}</b>
                  </div>
                ))}
              </div>
              <DataTable
                rows={d.items}
                rowKey={(r) => r.uid}
                onRow={setRating}
                columns={[
                  { key: "uid", label: "Participant" },
                  { key: "avg", label: "Average", render: (r) => (Object.values(r.scores).reduce((a, b) => a + b, 0) / Object.values(r.scores).length).toFixed(1) },
                  { key: "text", label: "Comment" },
                  { key: "response", label: "Your reply" },
                ]}
              />
            </>
          )}
        </Loader>
      </Panel>

      {reward && <RewardDialog reward={reward} onClose={() => setReward(null)} />}
      {complaint && <ComplaintDialog complaint={complaint} onClose={() => setComplaint(null)} />}
      {rating && <RatingDialog rating={rating} onClose={() => setRating(null)} />}
    </div>
  );
}

function RewardDialog({ reward, onClose }: { reward: Partial<Reward>; onClose: () => void }) {
  const { base } = useEvent();
  const { run, busy } = useAction();
  const { show } = useToast();
  const [r, setR] = useState({ prize: reward.prize ?? "", amount: reward.amount ?? "", type: reward.type ?? "cash", sponsor: reward.sponsor ?? "", winnerTeamId: reward.winnerTeamId ?? "", dueAt: reward.dueAt ?? "" });
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const body = { ...r, amount: r.amount === "" ? undefined : Number(r.amount), sponsor: r.sponsor || undefined, winnerTeamId: r.winnerTeamId || undefined };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const sig = await api<Record<string, string | number> & { uploadUrl: string; maxBytes: number }>(`${base}/uploads/sign`, { method: "POST", body: { folder: "reward-proofs" } });
      if (file.size > sig.maxBytes) throw new Error(`File is over ${Math.round(sig.maxBytes / 1_048_576)} MB`);
      const form = new FormData();
      form.append("file", file);
      for (const k of ["api_key", "timestamp", "signature", "folder", "allowed_formats"]) form.append(k, String(k === "api_key" ? sig.apiKey : sig[k]));
      const res = await fetch(sig.uploadUrl, { method: "POST", body: form });
      const json = (await res.json()) as { secure_url?: string; error?: { message: string } };
      if (!json.secure_url) throw new Error(json.error?.message ?? "Upload failed");
      await run("POST", `${base}/rewards/${reward.id}/proof`, { proofUrl: json.secure_url }, "Proof uploaded");
    } catch (e) {
      show(errorMessage(e), "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog title={reward.id ? reward.prize! : "New reward"} onClose={onClose}>
      <div className="form-grid tight">
        <Field label="Prize">
          <input value={r.prize} onChange={(e) => setR({ ...r, prize: e.target.value })} />
        </Field>
        <Field label="Amount (₹)">
          <input type="number" value={r.amount} onChange={(e) => setR({ ...r, amount: e.target.value })} />
        </Field>
        <Field label="Type">
          <input value={r.type} onChange={(e) => setR({ ...r, type: e.target.value })} />
        </Field>
        <Field label="Sponsor">
          <input value={r.sponsor} onChange={(e) => setR({ ...r, sponsor: e.target.value })} />
        </Field>
        <Field label="Winning team ID">
          <input value={r.winnerTeamId} onChange={(e) => setR({ ...r, winnerTeamId: e.target.value })} />
        </Field>
        <Field label="Due by">
          <DateTimeInput value={r.dueAt} onChange={(v) => setR({ ...r, dueAt: v })} />
        </Field>
      </div>
      <button
        className="secondary"
        disabled={busy || !r.prize || !r.dueAt}
        onClick={async () => {
          const ok = reward.id ? await run("PATCH", `${base}/rewards/${reward.id}`, body, "Saved") : await run("POST", `${base}/rewards`, body, "Reward added");
          if (ok && !reward.id) onClose();
        }}
      >
        {reward.id ? "Save details" : "Add reward"}
      </button>

      {reward.id && (
        <>
          <h4>
            Status: <Status value={reward.status} /> {reward.overdue && <span className="tag danger">overdue</span>}
          </h4>
          <Field label="Note (optional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="button-row">
            {(REWARD_TRANSITIONS[reward.status!] ?? []).map((s) => (
              <button key={s} className={s === "disputed" ? "secondary danger-text" : "primary"} disabled={busy} onClick={async () => (await run("POST", `${base}/rewards/${reward.id}/status`, { status: s, note: note || undefined }, `Now ${s}`)) && onClose()}>
                Mark {s}
              </button>
            ))}
          </div>
          <h4>Proof of delivery</h4>
          {reward.proofUrl ? (
            <a href={reward.proofUrl} target="_blank" rel="noreferrer">
              View proof
            </a>
          ) : (
            <p className="hint">Needed before marking delivered.</p>
          )}
          <input type="file" accept="image/*,application/pdf" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          {uploading && <p className="hint">Uploading…</p>}
          {(reward.history?.length ?? 0) > 0 && (
            <>
              <h4>History</h4>
              <ul className="audit-list">
                {reward.history!.map((h, i) => (
                  <li key={i}>
                    <b>{h.status}</b> <span className="muted">{fmtDate(h.at)}</span> {h.note}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

function ComplaintDialog({ complaint, onClose }: { complaint: Complaint; onClose: () => void }) {
  const { base } = useEvent();
  const { run, busy } = useAction();
  const [note, setNote] = useState("");
  const respond = (status: string) => run("POST", `${base}/complaints/${complaint.id}/respond`, { note, status }, `Complaint ${status}`);
  return (
    <Dialog title="Complaint" onClose={onClose}>
      <p>{complaint.text}</p>
      <p className="muted">
        From {complaint.uid} · answer by {fmtDate(complaint.deadline)} · <Status value={complaint.status} />
      </p>
      {complaint.evidenceUrls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer" className="block">
          Evidence
        </a>
      ))}
      {complaint.history.length > 0 && (
        <ul className="audit-list">
          {complaint.history.map((h, i) => (
            <li key={i}>
              <span className="muted">{fmtDate(h.at)} · {h.by}</span> {h.note}
            </li>
          ))}
        </ul>
      )}
      {complaint.status !== "resolved" && (
        <>
          <Field label="Reply (sent to them on WhatsApp)">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="dialog-actions">
            <button className="secondary danger-text" disabled={busy || !note.trim()} onClick={async () => (await respond("escalated")) && onClose()}>
              Escalate
            </button>
            <button className="secondary" disabled={busy || !note.trim()} onClick={async () => (await respond("responded")) && onClose()}>
              Reply
            </button>
            <button className="primary" disabled={busy || !note.trim()} onClick={async () => (await respond("resolved")) && onClose()}>
              Reply and resolve
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function RatingDialog({ rating, onClose }: { rating: Rating; onClose: () => void }) {
  const { base } = useEvent();
  const { run, busy } = useAction();
  const [response, setResponse] = useState(rating.response ?? "");
  return (
    <Dialog title={`Rating from ${rating.uid}`} onClose={onClose}>
      <dl className="kv">
        {Object.entries(rating.scores).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{"★".repeat(v)}{"☆".repeat(5 - v)}</dd>
          </div>
        ))}
      </dl>
      {rating.text && <p>“{rating.text}”</p>}
      <Field label="Your response">
        <textarea value={response} onChange={(e) => setResponse(e.target.value)} />
      </Field>
      <div className="dialog-actions">
        <button className="primary" disabled={busy || !response.trim()} onClick={async () => (await run("POST", `${base}/ratings/${rating.uid}/response`, { response }, "Response saved")) && onClose()}>
          Save
        </button>
      </div>
    </Dialog>
  );
}
