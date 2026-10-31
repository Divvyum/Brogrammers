import { useState } from "react";
import { Drawer } from "@hackos/ui";
import { Confirm, DataTable, Field, Loader, PageIntro, Pager, Panel, ReasonDialog, Status } from "../components/common";
import { useSession } from "../auth/Session";
import { useEvent } from "../lib/event";
import { useAction, useApi, useNow, usePaged } from "../lib/hooks";

// Teams (plan A9): list, detail, change requests, lock state with countdown,
// force add/remove with a reason, and withdrawals that start the replacement chain.

interface TeamRow extends Record<string, unknown> {
  id: string;
  name: string;
  track?: string;
  status: string;
  memberUids: string[];
  leaderUid: string;
  inviteCode: string;
}

interface Request extends Record<string, unknown> {
  id: string;
  type: string;
  uid: string;
  teamId: string;
  status: string;
  reason?: string;
}

export function useCountdown(target?: string) {
  const now = useNow(1000);
  if (!target) return null;
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return "passed";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`;
}

export function Teams() {
  const { base, event } = useEvent();
  const { role } = useSession();
  const isOrg = role === "organizer" || role === "superadmin";
  const [filters, setFilters] = useState({ status: "", track: "" });
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const teams = usePaged<TeamRow>(base ? `${base}/teams${qs ? `?${qs}` : ""}` : null, 50);
  const requests = useApi<{ items: Request[] }>(base && isOrg ? `${base}/team-requests?status=pending` : null);
  const { run, busy } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [lockNow, setLockNow] = useState(false);
  const countdown = useCountdown(event?.deadlines.teamLock);

  return (
    <div>
      <PageIntro
        eyebrow="TEAM OPERATIONS"
        title="Teams"
        subtitle={
          event?.teamsLockedAt
            ? "Teams are locked. Changes need a force add/remove."
            : `Teams lock automatically in ${countdown ?? "—"}.`
        }
        actions={
          isOrg && !event?.teamsLockedAt && (
            <button className="secondary" onClick={() => setLockNow(true)}>
              Lock all teams now
            </button>
          )
        }
      />
      {isOrg && (
        <Panel title={`Change requests (${requests.data?.items.length ?? 0} pending)`}>
          <Loader query={requests}>
            {(d) => (
              <DataTable
                rows={d.items}
                empty="No pending requests."
                columns={[
                  { key: "type", label: "Request" },
                  { key: "uid", label: "Participant" },
                  { key: "teamId", label: "Team" },
                  { key: "reason", label: "Note" },
                  {
                    key: "act",
                    label: "",
                    render: (r) => (
                      <div className="button-row">
                        <button className="secondary" disabled={busy} onClick={() => run("POST", `${base}/team-requests/${r.id}/decision`, { decision: "rejected" }, "Rejected")}>
                          Reject
                        </button>
                        <button className="primary" disabled={busy || Boolean(event?.teamsLockedAt)} onClick={() => run("POST", `${base}/team-requests/${r.id}/decision`, { decision: "approved" }, "Approved")}>
                          Approve
                        </button>
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </Loader>
        </Panel>
      )}
      <div className="toolbar">
        <select value={filters.status} onChange={(e) => (setFilters({ ...filters, status: e.target.value }), teams.reset())}>
          <option value="">Any status</option>
          <option value="forming">Forming</option>
          <option value="locked">Locked</option>
        </select>
        <select value={filters.track} onChange={(e) => (setFilters({ ...filters, track: e.target.value }), teams.reset())}>
          <option value="">Any track</option>
          {event?.tracks.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <Loader query={teams}>
        {(d) => (
          <>
            <DataTable
              rows={d.items}
              onRow={(r) => setOpen(r.id)}
              columns={[
                { key: "name", label: "Team" },
                { key: "track", label: "Track" },
                { key: "members", label: "Members", render: (r) => `${r.memberUids.length} / ${event?.teamMax ?? "?"}` },
                { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                { key: "inviteCode", label: "Invite code" },
              ]}
            />
            <Pager page={teams.page} hasNext={teams.hasNext} next={teams.next} previous={teams.previous} />
          </>
        )}
      </Loader>
      {open && <TeamDrawer teamId={open} onClose={() => setOpen(null)} canEdit={isOrg} />}
      {lockNow && (
        <Confirm
          title="Lock all teams now"
          description="Pending requests are rejected and every member is told on WhatsApp. This can't be undone."
          confirmLabel="Lock teams"
          danger
          busy={busy}
          onClose={() => setLockNow(false)}
          onConfirm={() => run("POST", `${base}/teams/lock`, {}, "Teams locked")}
        />
      )}
    </div>
  );
}

function TeamDrawer({ teamId, onClose, canEdit }: { teamId: string; onClose: () => void; canEdit: boolean }) {
  const { base } = useEvent();
  const team = useApi<TeamRow & { members: { id: string; name: string; college?: string; status: string }[] }>(`${base}/teams/${teamId}`);
  const { run, busy } = useAction();
  const [addUid, setAddUid] = useState("");
  const [pending, setPending] = useState<null | { kind: "add" | "remove" | "withdraw"; uid: string }>(null);

  return (
    <Drawer title="Team" onClose={onClose}>
      <Loader query={team}>
        {(t) => (
          <div className="drawer-body">
            <h3>{t.name}</h3>
            <p className="muted">
              {t.track ?? "No track"} · invite code {t.inviteCode} · <Status value={t.status} />
            </p>
            <ul className="member-list">
              {t.members.map((m) => (
                <li key={m.id}>
                  <span>
                    <b>{m.name}</b> {m.id === t.leaderUid && <small className="tag">leader</small>}
                    <small className="muted"> {m.college}</small>
                  </span>
                  {canEdit && (
                    <span className="button-row">
                      <button className="text-button" onClick={() => setPending({ kind: "withdraw", uid: m.id })}>
                        Withdraw
                      </button>
                      <button className="text-button danger-text" onClick={() => setPending({ kind: "remove", uid: m.id })}>
                        Remove
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <form
                className="inline-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  setPending({ kind: "add", uid: addUid.trim() });
                }}
              >
                <Field label="Force-add participant (ID)">
                  <input value={addUid} onChange={(e) => setAddUid(e.target.value)} required />
                </Field>
                <button className="secondary">Add</button>
              </form>
            )}
          </div>
        )}
      </Loader>
      {pending && (
        <ReasonDialog
          title={pending.kind === "add" ? `Add ${pending.uid}` : pending.kind === "remove" ? "Remove member" : "Withdraw member"}
          description={
            pending.kind === "withdraw"
              ? "They leave the team and the replacement chain invites the best-fitting solo participant."
              : pending.kind === "add"
                ? "Works even on a locked team or above the size limit."
                : "They leave the team. No replacement is searched for."
          }
          busy={busy}
          onClose={() => setPending(null)}
          onConfirm={(reason) =>
            pending.kind === "add"
              ? run("POST", `${base}/teams/${teamId}/members`, { uid: pending.uid, reason }, "Added")
              : pending.kind === "remove"
                ? run("DELETE", `${base}/teams/${teamId}/members/${pending.uid}`, { reason }, "Removed")
                : run("POST", `${base}/teams/${teamId}/withdraw`, { uid: pending.uid, reason }, "Withdrawn; replacement search started")
          }
        />
      )}
    </Drawer>
  );
}
