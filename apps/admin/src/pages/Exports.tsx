import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader, PageIntro, Panel, StatCard } from "../components/common";
import { api, downloadBlob } from "../api/client";
import { useEvent } from "../lib/event";
import { errorMessage, useApi } from "../lib/hooks";
import { fmtTime, label, pct } from "../lib/format";
import { useToast } from "../ui/ToastContext";

// Exports and analytics (plan A25): a button for every CSV and the PDF summary;
// analytics charts.

const CSVS: [string, string][] = [
  ["attendance", "Attendance"],
  ["teams", "Teams"],
  ["eligibility", "Eligibility"],
  ["checkins", "Check-ins (with flags)"],
  ["scores", "Scores"],
  ["leaderboard", "Leaderboard"],
  ["rewards", "Rewards"],
  ["audit", "Audit log"],
];

interface Analytics {
  funnel: { stage: string; count: number }[];
  attendanceBySlot: { slotId: string; startAt: string; expected: number; arrived: number; rate: number }[];
  attendanceRate: number;
  noShowRate: number;
  whatsappDeliveryRate: number;
  whatsapp: { sent: number; failed: number };
  averageJudgeSpread: number | null;
  teamsWithMultipleJudges: number;
  ratings: { count: number; averages: Record<string, number | null> };
}

export function Exports() {
  const { base, event } = useEvent();
  const a = useApi<Analytics>(base ? `${base}/analytics` : null);
  const { show } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (path: string, filename: string) => {
    setBusy(filename);
    try {
      downloadBlob(await api<Blob>(`${base}/${path}`), filename);
    } catch (e) {
      show(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageIntro eyebrow="AFTER THE EVENT" title="Exports & analytics" subtitle="CSV files open directly in Excel." />
      <Panel title="Downloads">
        <div className="download-grid">
          {CSVS.map(([kind, name]) => (
            <button key={kind} className="secondary" disabled={busy !== null} onClick={() => download(`exports/${kind}.csv`, `${event?.code ?? "event"}-${kind}.csv`)}>
              ⬇ {name} {busy === `${event?.code ?? "event"}-${kind}.csv` && "…"}
            </button>
          ))}
          <button className="primary" disabled={busy !== null} onClick={() => download("exports/summary.pdf", `${event?.code ?? "event"}-summary.pdf`)}>
            ⬇ Event summary (PDF)
          </button>
        </div>
      </Panel>
      <Loader query={a}>
        {(d) => (
          <>
            <div className="stat-grid">
              <StatCard label="Attendance" value={pct(d.attendanceRate)} foot={`no-show ${pct(d.noShowRate)}`} />
              <StatCard label="WhatsApp delivery" value={pct(d.whatsappDeliveryRate)} foot={`${d.whatsapp.sent} sent · ${d.whatsapp.failed} failed`} />
              <StatCard label="Judge spread" value={d.averageJudgeSpread ?? "—"} foot={`avg. std. dev. across ${d.teamsWithMultipleJudges} teams`} />
              <StatCard label="Ratings" value={d.ratings.count} foot="feedback forms" />
            </div>
            <div className="overview-grid">
              <Panel title="Registration funnel">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={d.funnel.map((f) => ({ ...f, stage: label(f.stage) }))} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="stage" width={110} fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#1f6a4b" />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Attendance per slot">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={d.attendanceBySlot.map((s) => ({ ...s, slot: fmtTime(s.startAt) }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="slot" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="expected" name="Expected" fill="#c9d8cc" />
                    <Bar dataKey="arrived" name="Arrived" fill="#1f6a4b" />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </div>
            <Panel title="Feedback averages (out of 5)">
              <div className="rating-bars">
                {Object.entries(d.ratings.averages).map(([k, v]) => (
                  <div key={k}>
                    <span>{k}</span>
                    <div className="bar">
                      <div style={{ width: `${((v ?? 0) / 5) * 100}%` }} />
                    </div>
                    <b>{v ?? "—"}</b>
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}
      </Loader>
    </div>
  );
}
