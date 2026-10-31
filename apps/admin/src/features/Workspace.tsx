import { useEffect, useMemo, useState } from "react";
import { api, eventPath, downloadBlob } from "../api/client";
import { useToast } from "../ui/ToastContext";
import { ConfirmDialog, EmptyState, ErrorState, Skeleton, Table } from "@hackos/ui";

type Row = Record<string, unknown> & { id?: string };
type Action = { label: string; method: "GET" | "POST" | "PUT"; path: string; payload?: string; requiresReason?: boolean };
type Config = { title: string; description: string; path?: string; columns: string[]; actions?: Action[]; exportKind?: string };

const configs: Record<string, Config> = {
  Schedule: { title: "Schedule", description: "Review and publish event sessions.", path: "schedule", columns: ["id", "title", "startAt", "endAt", "location", "audience"], actions: [{ label: "Preview audience", method: "POST", path: "schedule/preview-audience", payload: '{"type":"all","ids":[]}' }, { label: "Add schedule item", method: "POST", path: "schedule", payload: '{"title":"","startAt":"","endAt":"","location":"","audience":{"type":"all","ids":[]}}' }] },
  "Problem statements": { title: "Problem statements", description: "Manage statements and release timing.", path: "problems", columns: ["id", "title", "track", "releaseAt", "released"], actions: [{ label: "Create statement", method: "POST", path: "problems", payload: '{"title":"","track":"","body":"","releaseAt":""}' }] },
  Announcements: { title: "Announcements", description: "Draft announcements and preview the audience before sending.", path: "announcements", columns: ["id", "title", "status", "createdAt", "audience"], actions: [{ label: "AI draft", method: "POST", path: "announcements/ai-draft", payload: '{"notes":"","tone":"friendly"}' }, { label: "Preview audience", method: "POST", path: "announcements/preview-audience", payload: '{"type":"all","ids":[]}' }, { label: "Create announcement", method: "POST", path: "announcements", payload: '{"title":"","body":"","audience":{"type":"all","ids":[]}}' }] },
  WhatsApp: { title: "Messaging health", description: "Inspect delivery status and retry failed messages.", path: "outbox/messages?limit=50", columns: ["id", "channel", "status", "to", "createdAt", "error"], actions: [{ label: "Refresh status", method: "GET", path: "outbox/status" }] },
  "Mentor views": { title: "Mentor operations", description: "Review mentor availability, slots and team progress.", path: "mentor-slots", columns: ["id", "mentorUid", "teamId", "startAt", "endAt", "status", "notes"] },
  "Volunteer operations": { title: "Volunteer operations", description: "Tasks, support tickets and food counter status.", path: "tasks", columns: ["id", "title", "assignedTo", "status", "dueAt"], actions: [{ label: "Tickets", method: "GET", path: "tickets?status=open" }, { label: "Food stats", method: "GET", path: "food/stats" }] },
  "Judging setup": { title: "Judging setup", description: "Rubric, judge roster and team assignments.", path: "judges", columns: ["uid", "name", "email", "teamIds"], actions: [{ label: "Auto assign judges", method: "POST", path: "judges/auto-assign", payload: '{"judgesPerTeam":2}' }, { label: "Assign selected judge", method: "PUT", path: "judges/:selected/assignments", payload: '{"teamIds":[]}' }, { label: "Save current round rubric", method: "PUT", path: "rubric/current", payload: '{"criteria":[{"id":"quality","label":"Quality","weight":100,"maxScore":10}]}' }] },
  "Judge panel": { title: "Judge panel", description: "Assigned submissions, repository insights and scoring.", path: "submissions", columns: ["teamId", "teamName", "track", "githubUrl", "pptUrl", "videoUrl", "status"], actions: [{ label: "Refresh selected GitHub insights", method: "POST", path: "submissions/:selected/github/refresh", payload: "{}" }, { label: "Draft selected AI summary", method: "POST", path: "submissions/:selected/ai-summary", payload: "{}" }, { label: "Save selected score", method: "PUT", path: "scores/:selected", payload: '{"criteria":{},"comment":"","submit":false,"round":"current"}' }] },
  // BACKEND-GAP: D24 publish, visibility and certificate APIs do not persist a reason in audit records.
  Results: { title: "Results", description: "Review scores, leaderboard consistency, publication and certificates.", path: "leaderboard", columns: ["teamId", "teamName", "rank", "total", "track"], actions: [{ label: "Recompute leaderboard", method: "POST", path: "leaderboard/recompute" }, { label: "Publish results", method: "POST", path: "results/publish", payload: "{}", requiresReason: true }, { label: "Consistency report", method: "GET", path: "judging/consistency" }, { label: "Show results", method: "POST", path: "results/visibility", payload: '{"visible":true}', requiresReason: true }, { label: "Issue participation certificates", method: "POST", path: "certificates/issue", payload: '{"type":"participation","topTeams":3}', requiresReason: true }, { label: "List certificates", method: "GET", path: "certificates" }] },
  "Rewards & feedback": { title: "Rewards and feedback", description: "Review reward fulfillment, complaints and participant ratings.", path: "rewards", columns: ["id", "title", "status", "recipientUid", "updatedAt"], actions: [{ label: "Complaints", method: "GET", path: "complaints" }, { label: "Ratings", method: "GET", path: "ratings" }] },
  "Exports & analytics": { title: "Exports and analytics", description: "Download event exports or inspect aggregate analytics.", path: "analytics", columns: ["registrations", "eligible", "teams", "checkedIn", "submissions", "noShowRate", "whatsappDeliveryRate"], exportKind: "attendance" },
  "Audit log": { title: "Audit history", description: "Audit details appear in participant detail and downloadable audit exports.", columns: [], exportKind: "audit" },
};

function rowsOf(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items as Row[];
    if (Array.isArray(record.teams)) return record.teams as Row[];
    return [record as Row];
  }
  return [];
}

export function Workspace({ section, eventId }: { section: string; eventId: string }) {
  const config = configs[section];
  const [data, setData] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const { show } = useToast();
  const path = config?.path;
  const columns = useMemo(() => config?.columns ?? [], [config]);

  async function load() {
    if (!config || !path) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      setData(await api(eventPath(eventId, path)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this module.");
    } finally {
      setLoading(false);
    }
  }

  // The fetch is the external synchronization for the selected event/module.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [eventId, path]);

  async function run(action: Action, reason = "") {
    try {
      const selectedId = String(selected?.teamId ?? selected?.uid ?? selected?.id ?? "");
      if (action.path.includes(":selected") && !selectedId) {
        show("Select a row first.", "error");
        return;
      }
      const requestPath = action.path.replace(":selected", encodeURIComponent(selectedId));
      const result = await api(eventPath(eventId, requestPath), {
        method: action.method,
        body: action.method === "GET" ? undefined : { ...(payload.trim() ? JSON.parse(payload) as Record<string, unknown> : action.payload ? JSON.parse(action.payload) as Record<string, unknown> : {}), ...(reason ? { reason } : {}) },
      });
      setData(result);
      show(`${action.label} completed.`, "success");
      await load();
    } catch (cause) {
      show(cause instanceof Error ? cause.message : "Action failed.", "error");
    }
  }

  async function exportData() {
    try {
      const kind = config?.exportKind ?? "audit";
      const file = await api<Blob>(eventPath(eventId, `exports/${kind}.csv`));
      downloadBlob(file, `${kind}.csv`);
    } catch (cause) {
      show(cause instanceof Error ? cause.message : "Export failed.", "error");
    }
  }

  if (!config) return <ErrorState message="There is no configured backend view for this section." />;
  const rows = rowsOf(data);
  return <section className="feature-workspace">
    <header className="page-intro"><span className="eyebrow">EVENT OPERATIONS</span><h2>{config.title}</h2><p>{config.description}</p></header>
    {loading ? <Skeleton /> : error ? <ErrorState message={error} retry={() => void load()} /> : columns.length ? rows.length ? <Table rows={rows} columns={columns.map((key) => ({ key, label: key.replace(/[A-Z]/g, (letter) => ` ${letter}`).toUpperCase() }))} rowKey={(row) => String(row.id ?? row.teamId ?? row.uid ?? JSON.stringify(row))} onRowClick={setSelected} /> : <EmptyState title="No records" detail="No matching records are available yet." /> : null}
    {selected && <div className="panel feature-selected"><h3>Selected record</h3><pre>{JSON.stringify(selected, null, 2)}</pre><button className="secondary" onClick={() => setSelected(null)}>Close details</button></div>}
    {config.exportKind && <button className="secondary" onClick={() => void exportData()}>Download {config.exportKind} CSV</button>}
    {config.actions?.map((action) => <div className="feature-action" key={action.path}>
      <button className="secondary" onClick={() => action.requiresReason ? setPendingAction(action) : void run(action)}>{action.label}</button>
      {action.payload && <label className="payload-label">Request body (JSON)<textarea value={payload || action.payload} onChange={(event) => setPayload(event.target.value)} aria-label={`${action.label} request body`} /> </label>}
    </div>)}
    {section === "Audit log" && <p className="hint">// BACKEND-GAP: Divyam has not exposed a general audit list route. The UI can only show the real audit export or per-participant audit history when that route is available.</p>}
    {pendingAction && <ConfirmDialog title={pendingAction.label} description="This action changes event results. Enter a reason to continue." confirmLabel={pendingAction.label} onCancel={() => setPendingAction(null)} onConfirm={(reason) => { const action = pendingAction; setPendingAction(null); void run(action, reason); }} />}
  </section>;
}
