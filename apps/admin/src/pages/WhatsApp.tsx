import { useState } from "react";
import { DataTable, Dialog, Field, Loader, PageIntro, Pager, Panel, StatCard, Status } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, useApi, usePaged } from "../lib/hooks";
import { fmtDate } from "../lib/format";
import { QrImage } from "../components/Qr";

// WhatsApp dashboard (plan A18): connection state (waiting for the worker in
// Phase 1), queued/sent/failed counts, failures with retry, message history
// search, and message templates.

interface Message extends Record<string, unknown> {
  id: string;
  channel: string;
  to: { uid: string };
  template: string;
  vars: Record<string, string>;
  priority: number;
  status: string;
  attempts: number;
  lastError?: string;
  createdAt?: string;
  sentAt?: string;
}

interface Template extends Record<string, unknown> {
  id: string;
  channel: string;
  body: string;
  isDefault: boolean;
}

export function WhatsApp() {
  const { base } = useEvent();
  const status = useApi<{ connection: { state: string; qr?: string; waitingForWorker?: boolean; lastConnectedAt?: string; sentToday?: number; failedToday?: number }; counts: Record<string, number> }>(
    base ? `${base}/outbox/status` : null,
    // The login QR changes every ~20 seconds, so poll faster while it is showing.
    { refetchInterval: 5_000 },
  );
  const [filters, setFilters] = useState({ status: "", template: "", uid: "" });
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const messages = usePaged<Message>(base ? `${base}/outbox/messages${qs ? `?${qs}` : ""}` : null, 50);
  const templates = useApi<{ items: Template[] }>("/templates");
  const { run, busy } = useAction();
  const [open, setOpen] = useState<Message | null>(null);
  const [tpl, setTpl] = useState<Template | null>(null);

  const set = (k: keyof typeof filters, v: string) => {
    setFilters({ ...filters, [k]: v });
    messages.reset();
  };
  const c = status.data?.counts ?? {};
  const conn = status.data?.connection;

  return (
    <div>
      <PageIntro eyebrow="MESSAGING" title="WhatsApp" subtitle="Every message waits in the outbox until the WhatsApp worker sends it (Phase 2)." />
      <div className="stat-grid">
        <StatCard
          label="Connection"
          value={conn?.waitingForWorker ? "No worker" : conn?.state ?? "—"}
          foot={conn?.waitingForWorker ? "Messages stay queued until it's running" : conn?.lastConnectedAt ? `since ${fmtDate(conn.lastConnectedAt)}` : ""}
        />
        <StatCard label="Queued" value={c.queued ?? 0} foot={`${c.sending ?? 0} sending now`} />
        <StatCard label="Sent" value={c.sent ?? 0} />
        <StatCard label="Failed" value={c.failed ?? 0} foot={c.failed ? "Retry from the list below" : ""} />
      </div>

      {conn?.state === "qr" && conn.qr && (
        <Panel title="Link the WhatsApp number">
          <div className="split-panels">
            <QrImage text={conn.qr} size={300} />
            <ol className="hint" style={{ fontSize: 16, lineHeight: 1.7 }}>
              <li>On the spare SIM phone, open WhatsApp.</li>
              <li>Go to Settings → Linked devices → Link a device.</li>
              <li>Scan this code. It refreshes every 20 seconds; this page updates by itself.</li>
              <li>When the connection card says “connected”, messages start sending.</li>
            </ol>
          </div>
        </Panel>
      )}

      <div className="toolbar wrap">
        <select value={filters.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">Any status</option>
          {["queued", "sending", "sent", "failed", "skipped"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={filters.template} onChange={(e) => set("template", e.target.value)}>
          <option value="">Any template</option>
          {(templates.data?.items ?? []).map((t) => (
            <option key={t.id}>{t.id}</option>
          ))}
        </select>
        <input placeholder="Recipient ID" value={filters.uid} onChange={(e) => set("uid", e.target.value.trim())} />
      </div>
      <Loader query={messages}>
        {(d) => (
          <>
            <DataTable
              rows={d.items}
              onRow={setOpen}
              columns={[
                { key: "createdAt", label: "Queued", render: (r) => fmtDate(r.createdAt) },
                { key: "to", label: "To", render: (r) => r.to.uid },
                { key: "template", label: "Message" },
                { key: "priority", label: "Priority", render: (r) => (r.priority === 0 ? <Status value="emergency" /> : r.priority) },
                { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                { key: "attempts", label: "Tries" },
                {
                  key: "act",
                  label: "",
                  render: (r) =>
                    r.status === "failed" && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void run("POST", `${base}/outbox/${r.id}/retry`, {}, "Back in the queue");
                        }}
                      >
                        Retry
                      </button>
                    ),
                },
              ]}
            />
            <Pager page={messages.page} hasNext={messages.hasNext} next={messages.next} previous={messages.previous} />
          </>
        )}
      </Loader>

      <Panel title="Templates" actions={<button className="secondary" disabled={busy} onClick={() => run<{ created: number }>("POST", "/templates/defaults", {}, (r) => `${r.created} defaults restored`)}>Restore missing defaults</button>}>
        <Loader query={templates}>
          {(d) => (
            <DataTable
              rows={d.items}
              onRow={setTpl}
              columns={[
                { key: "id", label: "Template" },
                { key: "body", label: "Text" },
                { key: "isDefault", label: "Default", render: (r) => (r.isDefault ? "Yes" : "Edited") },
              ]}
            />
          )}
        </Loader>
      </Panel>

      {open && (
        <Dialog title={open.template} onClose={() => setOpen(null)}>
          <p>
            To <b>{open.to.uid}</b> · <Status value={open.status} /> · {open.attempts} tries
          </p>
          {open.lastError && <div className="notice">{open.lastError}</div>}
          <h4>Values</h4>
          <dl className="kv">
            {Object.entries(open.vars).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{k === "link" ? "(hidden: contains a private token)" : v}</dd>
              </div>
            ))}
          </dl>
        </Dialog>
      )}
      {tpl && <TemplateDialog tpl={tpl} onClose={() => setTpl(null)} />}
    </div>
  );
}

function TemplateDialog({ tpl, onClose }: { tpl: Template; onClose: () => void }) {
  const { run, busy } = useAction();
  const [body, setBody] = useState(tpl.body);
  return (
    <Dialog title={`Template: ${tpl.id}`} onClose={onClose}>
      <Field label="Text" hint="{{name}} placeholders are filled in when the message is sent.">
        <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="dialog-actions">
        <button className="primary" disabled={busy || !body.trim()} onClick={async () => (await run("PUT", `/templates/${tpl.id}`, { channel: tpl.channel, body }, "Template saved")) && onClose()}>
          Save
        </button>
      </div>
    </Dialog>
  );
}
