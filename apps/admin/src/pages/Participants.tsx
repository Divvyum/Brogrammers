import { useState } from "react";
import { Drawer } from "@hackos/ui";
import { PARTICIPANT_STATUSES } from "@hackos/shared";
import { DataTable, Loader, PageIntro, Pager, Status } from "../components/common";
import { useSession } from "../auth/Session";
import { useEvent } from "../lib/event";
import { useApi, usePaged } from "../lib/hooks";
import { fmtDate, label } from "../lib/format";

// Participants (plan A6): paginated, filtered table and a detail drawer with the
// status timeline and audit history. Volunteers see contact details masked
// (the server masks them).

export interface ParticipantRow extends Record<string, unknown> {
  id: string;
  name: string;
  college?: string;
  status: string;
  track?: string;
  teamId?: string;
  slotId?: string;
  roomId?: string;
  seat?: string;
  eligibility?: { result: string; reason: string; override?: boolean };
  enrollment?: { status: string };
  checkedInAt?: string;
  mergedInto?: string;
}

interface Detail extends ParticipantRow {
  profile: Record<string, unknown> & { email: string | null; phone: string | null; skills?: string[]; year?: number; city?: string; githubUsername?: string };
  audit: { id: string; action: string; actor: string; ts: string; reason?: string | null }[];
}

export function Participants() {
  const { base, event } = useEvent();
  const { role } = useSession();
  const [filters, setFilters] = useState({ status: "", college: "", track: "", teamId: "" });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const list = usePaged<ParticipantRow>(base ? `${base}/participants${qs ? `?${qs}` : ""}` : null, 50);

  const setFilter = (k: keyof typeof filters, v: string) => {
    setFilters({ ...filters, [k]: v });
    list.reset();
  };

  return (
    <div>
      <PageIntro eyebrow="PEOPLE" title="Participants" subtitle={role === "volunteer" ? "Look someone up. Contact details are masked." : "Everyone registered for this event."} />
      <div className="toolbar wrap">
        <input placeholder="Search this page by name or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">Any status</option>
          {PARTICIPANT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <select value={filters.track} onChange={(e) => setFilter("track", e.target.value)}>
          <option value="">Any track</option>
          {event?.tracks.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input placeholder="College (exact)" value={filters.college} onChange={(e) => setFilter("college", e.target.value)} />
        <input placeholder="Team ID" value={filters.teamId} onChange={(e) => setFilter("teamId", e.target.value)} />
      </div>
      <Loader query={list}>
        {(d) => (
          <>
            <DataTable
              rows={d.items.filter((p) => !search || `${p.name} ${p.id}`.toLowerCase().includes(search.toLowerCase()))}
              onRow={(r) => setOpen(r.id)}
              columns={[
                { key: "name", label: "Name", render: (r) => <>{r.name}{r.mergedInto && <small className="muted"> (merged)</small>}</> },
                { key: "college", label: "College" },
                { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                { key: "track", label: "Track" },
                { key: "teamId", label: "Team" },
                { key: "roomId", label: "Room / seat", render: (r) => r.seat ?? r.roomId ?? "—" },
                { key: "enrollment", label: "Digital ID", render: (r) => <Status value={r.enrollment?.status ?? "not sent"} /> },
              ]}
            />
            <Pager page={list.page} hasNext={list.hasNext} next={list.next} previous={list.previous} />
          </>
        )}
      </Loader>
      {open && <ParticipantDrawer uid={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function ParticipantDrawer({ uid, onClose }: { uid: string; onClose: () => void }) {
  const { base } = useEvent();
  const detail = useApi<Detail>(`${base}/participants/${uid}`);
  return (
    <Drawer title="Participant" onClose={onClose}>
      <Loader query={detail}>
        {(p) => {
          const reached = PARTICIPANT_STATUSES.indexOf(p.status as (typeof PARTICIPANT_STATUSES)[number]);
          return (
            <div className="drawer-body">
              <h3>{p.name}</h3>
              <p className="muted">
                {p.college ?? "—"} · {p.profile.city ?? "—"} · year {p.profile.year ?? "—"}
              </p>
              <div className="detail-grid">
                <div>
                  <small>EMAIL</small>
                  <b>{p.profile.email ?? "—"}</b>
                </div>
                <div>
                  <small>PHONE</small>
                  <b>{p.profile.phone ?? "—"}</b>
                </div>
                <div>
                  <small>GITHUB</small>
                  <b>{p.profile.githubUsername ?? "—"}</b>
                </div>
                <div>
                  <small>TEAM</small>
                  <b>{p.teamId ?? "Solo"}</b>
                </div>
                <div>
                  <small>SLOT</small>
                  <b>{p.slotId ?? "—"}</b>
                </div>
                <div>
                  <small>SEAT</small>
                  <b>{p.seat ?? "—"}</b>
                </div>
                <div>
                  <small>DIGITAL ID</small>
                  <b>{p.enrollment?.status ?? "not sent"}</b>
                </div>
                <div>
                  <small>CHECKED IN</small>
                  <b>{fmtDate(p.checkedInAt)}</b>
                </div>
                <div>
                  <small>SKILLS</small>
                  <b>{p.profile.skills?.join(", ") || "—"}</b>
                </div>
              </div>
              {p.eligibility && (
                <p>
                  <Status value={p.eligibility.result} /> {p.eligibility.reason}
                  {p.eligibility.override && <small className="muted"> (manual override)</small>}
                </p>
              )}
              <h4>Status</h4>
              <ol className="timeline">
                {PARTICIPANT_STATUSES.filter((s) => !["flagged", "rejected"].includes(s) || s === p.status).map((s) => (
                  <li key={s} className={PARTICIPANT_STATUSES.indexOf(s) <= reached ? "done" : ""}>
                    {label(s)}
                  </li>
                ))}
              </ol>
              {p.audit.length > 0 && (
                <>
                  <h4>History</h4>
                  <ul className="audit-list">
                    {p.audit.map((a) => (
                      <li key={a.id}>
                        <b>{a.action}</b> <span className="muted">{fmtDate(a.ts)} · {a.actor}</span>
                        {a.reason && <div>“{a.reason}”</div>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          );
        }}
      </Loader>
    </Drawer>
  );
}
