import { useState } from "react";
import { AudiencePicker, Confirm, DataTable, Field, Loader, PageIntro, Panel, Status, type Audience } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, useApi } from "../lib/hooks";
import { fmtDate } from "../lib/format";
import { AudienceCount, audienceText, useRoomsAndTeams } from "./Schedule";

// Announcements composer (plan A17): audience picker, "Draft with AI", preview,
// emergency toggle (with a confirmation), sent history with seen percentage.

interface Sent extends Record<string, unknown> {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  emergency: boolean;
  recipients?: number;
  seenCount: number;
  seenPct: number;
  createdAt?: string;
}

export function Announcements() {
  const { base } = useEvent();
  const { rooms, teams } = useRoomsAndTeams();
  const history = useApi<{ items: Sent[] }>(base ? `${base}/announcements` : null, { refetchInterval: 60_000 });
  const { run, busy } = useAction();
  const [a, setA] = useState({ title: "", body: "", audience: { type: "all", ids: [] } as Audience, emergency: false });
  const [notes, setNotes] = useState("");
  const [tone, setTone] = useState<"friendly" | "formal" | "urgent">("friendly");
  const [confirm, setConfirm] = useState(false);

  const send = async () => {
    const r = await run<{ recipients: number }>("POST", `${base}/announcements`, a, (x) => `Sent to ${x.recipients} people`);
    if (r) setA({ title: "", body: "", audience: { type: "all", ids: [] }, emergency: false });
  };

  return (
    <div>
      <PageIntro eyebrow="EVENT DAY" title="Announcements" subtitle="Sent on WhatsApp and as a push notification. Emergencies jump the queue." />
      <div className="split-panels">
        <Panel title="Compose">
          <Field label="Rough notes for AI (optional)">
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="lunch moved to 2pm, cafeteria, bring ID" />
          </Field>
          <div className="inline-row">
            <select value={tone} onChange={(e) => setTone(e.target.value as typeof tone)}>
              <option value="friendly">Friendly</option>
              <option value="formal">Formal</option>
              <option value="urgent">Urgent</option>
            </select>
            <button
              className="secondary"
              disabled={busy || notes.trim().length < 3}
              onClick={async () => {
                const r = await run<{ title: string; body: string }>("POST", `${base}/announcements/ai-draft`, { notes, tone }, "Draft ready: check it before sending");
                if (r) setA({ ...a, title: r.title, body: r.body });
              }}
            >
              {busy ? "Drafting…" : "✨ Draft with AI"}
            </button>
          </div>
          <Field label="Title">
            <input value={a.title} maxLength={120} onChange={(e) => setA({ ...a, title: e.target.value })} />
          </Field>
          <Field label="Message">
            <textarea rows={5} value={a.body} maxLength={2000} onChange={(e) => setA({ ...a, body: e.target.value })} />
          </Field>
          <Field label="Audience">
            <AudiencePicker value={a.audience} onChange={(audience) => setA({ ...a, audience })} rooms={rooms} teams={teams} />
          </Field>
          <AudienceCount audience={a.audience} path={`${base}/announcements/preview-audience`} />
          <label className="check emergency">
            <input type="checkbox" checked={a.emergency} onChange={(e) => setA({ ...a, emergency: e.target.checked })} /> Emergency (sent before everything else)
          </label>
          <div className="button-row end">
            <button
              className={a.emergency ? "primary danger" : "primary"}
              disabled={busy || !a.title.trim() || !a.body.trim() || (a.audience.type !== "all" && !a.audience.ids.length)}
              onClick={() => (a.emergency ? setConfirm(true) : void send())}
            >
              {a.emergency ? "Send emergency" : "Send"}
            </button>
          </div>
        </Panel>
        <Panel title="Preview">
          <div className={`phone-preview ${a.emergency ? "emergency" : ""}`}>
            <div className="bubble">
              <b>
                {a.emergency ? "⚠ " : ""}
                {a.title || "Title"}
              </b>
              <p>{a.body || "Your message appears here."}</p>
            </div>
            <small className="muted">To: {audienceText(a.audience)}</small>
          </div>
        </Panel>
      </div>
      <Panel title="Sent">
        <Loader query={history}>
          {(d) => (
            <DataTable
              rows={d.items}
              columns={[
                { key: "createdAt", label: "Sent", render: (r) => fmtDate(r.createdAt) },
                { key: "title", label: "Title", render: (r) => <>{r.emergency && <Status value="emergency" />} {r.title}</> },
                { key: "audience", label: "Audience", render: (r) => audienceText(r.audience) },
                { key: "recipients", label: "Recipients" },
                { key: "seenPct", label: "Seen", render: (r) => `${r.seenPct}% (${r.seenCount})` },
              ]}
            />
          )}
        </Loader>
      </Panel>
      {confirm && (
        <Confirm
          title="Send an emergency announcement?"
          description={`It goes to ${audienceText(a.audience)} ahead of every other message, on WhatsApp and as a push notification.`}
          confirmLabel="Send emergency"
          danger
          busy={busy}
          onClose={() => setConfirm(false)}
          onConfirm={() => send()}
        />
      )}
    </div>
  );
}
