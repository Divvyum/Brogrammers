import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { db } from "../firebase";
import { PageIntro, Panel, StatCard } from "../components/common";
import { useEvent } from "../lib/event";
import { useAction, useApi, useNow } from "../lib/hooks";
import { fmtTime, pct } from "../lib/format";

// Live dashboard (plan A5). Reads only events/{id}/stats/live, which the server
// keeps up to date, so the dashboard costs one read per change (quota rule 3).

interface LiveStats {
  registrations: number;
  eligible: number;
  flagged: number;
  teams: number;
  enrolled: number;
  checkedIn: number;
  arrivedBySlot: Record<string, { expected: number; arrived: number }>;
  roomOccupancy: Record<string, { capacity: number; occupied: number }>;
  submissions: number;
  outbox: { queued: number; sent: number; failed: number };
  openTickets: number;
  updatedAt?: { toDate: () => Date };
}

export function Dashboard() {
  const { eventId, base, event } = useEvent();
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [error, setError] = useState("");
  const slots = useApi<{ items: { id: string; startAt: string; endAt: string; capacity: number }[] }>(base ? `${base}/slots` : null);
  const rooms = useApi<{ items: { id: string; name: string; capacity: number; occupied: number }[] }>(base ? `${base}/rooms` : null);
  const wa = useApi<{ connection: { state: string; waitingForWorker?: boolean } }>(base ? `${base}/outbox/status` : null, { refetchInterval: 30_000 });
  const { run, busy } = useAction();
  const now = useNow(30_000);

  useEffect(() => {
    if (!eventId) return;
    return onSnapshot(
      doc(db, "events", eventId, "stats", "live"),
      (s) => setStats(s.exists() ? (s.data() as LiveStats) : null),
      (e) => setError(e.message),
    );
  }, [eventId]);

  if (!eventId) return <div className="panel blank"><h2>No event yet</h2><p>Create one in Event setup.</p></div>;
  if (error) return <div className="notice">{error}</div>;
  if (!stats) return <div className="panel blank"><h2>Waiting for stats…</h2></div>;

  const roomName = new Map((rooms.data?.items ?? []).map((r) => [r.id, r.name]));
  const slotRows = (slots.data?.items ?? []).map((s) => ({
    slot: fmtTime(s.startAt),
    Expected: stats.arrivedBySlot[s.id]?.expected ?? 0,
    Arrived: stats.arrivedBySlot[s.id]?.arrived ?? 0,
    endAt: s.endAt,
  }));
  const funnel = [
    { stage: "Registered", value: stats.registrations },
    { stage: "Eligible", value: stats.eligible },
    { stage: "Enrolled ID", value: stats.enrolled },
    { stage: "Checked in", value: stats.checkedIn },
    { stage: "Submitted", value: stats.submissions },
  ];
  const occupancy = Object.entries(stats.roomOccupancy).map(([id, r]) => ({ id, name: roomName.get(id) ?? id, ...r }));

  // Alerts: full rooms, and slots that ended with fewer than half the expected arrivals.
  const alerts = [
    ...occupancy.filter((r) => r.capacity && r.occupied >= r.capacity).map((r) => `Room ${r.name} is full (${r.occupied}/${r.capacity}).`),
    ...slotRows
      .filter((s) => new Date(s.endAt).getTime() < now && s.Expected > 0 && s.Arrived / s.Expected < 0.5)
      .map((s) => `Slot ${s.slot} is running late: ${s.Arrived} of ${s.Expected} arrived.`),
    ...(stats.outbox.failed > 0 ? [`${stats.outbox.failed} WhatsApp messages failed.`] : []),
  ];

  return (
    <div>
      <PageIntro
        eyebrow="LIVE"
        title={event?.name ?? "Dashboard"}
        subtitle={`Updated ${stats.updatedAt ? stats.updatedAt.toDate().toLocaleTimeString("en-IN") : "—"} · numbers update every 10 seconds`}
        actions={
          <button className="secondary" disabled={busy} onClick={() => run("POST", `${base}/stats/recompute`, {}, "Recounted from scratch")}>
            Recount
          </button>
        }
      />
      {alerts.length > 0 && (
        <div className="alert-list">
          {alerts.map((a) => (
            <div key={a} className="notice">
              {a}
            </div>
          ))}
        </div>
      )}
      <div className="stat-grid">
        <StatCard index="01" label="Registrations" value={stats.registrations} foot={`${stats.flagged} flagged for review`} />
        <StatCard index="02" label="Eligible" value={stats.eligible} foot={stats.registrations ? pct(stats.eligible / stats.registrations) : "—"} />
        <StatCard index="03" label="Teams" value={stats.teams} foot={`${stats.enrolled} digital IDs enrolled`} />
        <StatCard index="04" label="Checked in" value={stats.checkedIn} foot={`${stats.submissions} submissions`} />
      </div>

      <div className="overview-grid">
        <Panel title="Registration funnel">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={funnel} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="stage" width={90} />
              <Tooltip />
              <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Arrivals per slot">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={slotRows}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="slot" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Expected" fill="#cdd0fd" />
              <Bar dataKey="Arrived" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="overview-grid">
        <Panel title="Room occupancy" actions={<Link to="/rooms" className="link-button">Room board →</Link>}>
          <div className="room-grid">
            {occupancy.map((r) => {
              const ratio = r.capacity ? r.occupied / r.capacity : 0;
              return (
                <div key={r.id} className={`room-tile ${ratio >= 1 ? "full" : ratio >= 0.85 ? "near" : ""}`}>
                  <b>{r.name}</b>
                  <span>
                    {r.occupied}/{r.capacity}
                  </span>
                  <div className="bar">
                    <div style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                  </div>
                </div>
              );
            })}
            {occupancy.length === 0 && <p className="hint">No rooms yet.</p>}
          </div>
        </Panel>
        <Panel title="Operations">
          <div className="metric-lines">
            <div className="metric">
              WhatsApp
              <b>{wa.data?.connection.waitingForWorker ? "Waiting for worker" : wa.data?.connection.state ?? "—"}</b>
            </div>
            <div className="metric">
              Messages queued / sent / failed
              <b>
                {stats.outbox.queued} / {stats.outbox.sent} / {stats.outbox.failed}
              </b>
            </div>
            <div className="metric">
              Open help-desk tickets
              <b>{stats.openTickets}</b>
            </div>
            <div className="metric">
              Submissions
              <b>{stats.submissions}</b>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
