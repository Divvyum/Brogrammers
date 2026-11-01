import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Crown, DoorOpen, Hourglass, KeyRound, Link2, Lock, LogOut, Plus, Sparkles, UserMinus, UserPlus, UsersRound } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '../components/ui/Card'
import { Avatar, GithubIcon } from '../components/ui/Misc'
import { Pill, StatusPill } from '../components/ui/Badge'
import { IconTile } from '../components/ui/IconTile'
import { Field, Input, Select, Toggle } from '../components/ui/Form'
import { Countdown, InfoNote } from '../components/ui/Preview'
import { EmptyState } from '../components/ui/Misc'
import { toast } from '../lib/toast'
import { useAct, useEventInfo, useNow, useP, type EventInfo, type TeamView } from '../lib/data'
import { useOffers, useTeam, type Offers } from '../lib/live'
import { useSession } from '../lib/session'
import { ago, countdown, fmtDT } from '../lib/format'
import { useUI } from '../context/UIContext'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

type View = 'locked' | 'forming' | 'none' | 'replacement' | 'waitlist'

type Suggestion = { uid: string; name: string; college: string | null; city: string | null; track: string | null; skills: string[]; missing: string[]; sameTrack: boolean; score: number }

function Suggestions({ team }: { team: TeamView['team'] }) {
  const [sent, setSent] = useState<string[]>([])
  const { me } = useSession()
  const { data, refetch, isFetching } = useP<{ suggestions: Suggestion[] }>('/matching')
  const { run } = useAct()
  const top = data?.suggestions[0]?.score || 1
  const suggestions = (data?.suggestions ?? []).slice(0, 6).map((s) => ({
    ...s,
    match: Math.max(40, Math.min(99, Math.round(60 + (s.score / top) * 39))),
    why: [s.missing.length ? `Has ${s.missing.slice(0, 2).join(', ')}${team ? ' your team is missing' : ' that complements you'}` : 'Similar skills', s.sameTrack ? 'same track' : null].filter(Boolean).join(', '),
  }))
  const leader = team && team.leaderUid === me?.uid && team.status !== 'locked'
  const connect = async (uid: string) => { if (await run('POST', '/connections', { toUid: uid }, tr("Connection request sent"))) setSent([...sent, uid]) }
  const invite = (uid: string) => {
    if (!team) return toast(tr("Create a team first, then invite people"), { kind: 'info' })
    if (!leader) return toast(tr("Only the team leader can invite"), { kind: 'info' })
    void run('POST', `/teams/${team.id}/invitations`, { toUid: uid }, tr("Invitation sent on WhatsApp"))
  }
  return (
    <Card className="p-6">
      <CardHeader title={<span className="flex items-center gap-2"><Sparkles size={18} className="text-violet-500" /> {tr("Smart teammate suggestions")}</span>} subtitle={tr("Ranked by complementary skills, same track and availability")} action={<button className="btn-ghost text-xs" disabled={isFetching} onClick={() => void refetch()}>{tr("Refresh")}</button>} />
      {suggestions.length === 0 && <p className="mt-4 rounded-2xl bg-surface-2 p-4 text-sm text-muted">{isFetching ? tr("Finding people…") : tr("No suggestions right now. Everyone may already be in a team.")}</p>}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {suggestions.map((s) => (
          <div key={s.uid} className="rounded-2xl border border-line p-4">
            <div className="flex items-start gap-3">
              <Avatar name={s.name} size={42} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2"><p className="truncate font-bold text-ink">{s.name}</p><span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-bold text-violet-700">{s.match}% match</span></div>
                <p className="truncate text-xs text-muted">{[s.college, s.city, s.track].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">{s.skills.map((k) => <span key={k} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">{k}</span>)}</div>
            <p className="mt-2 text-xs text-muted">{s.why}</p>
            <div className="mt-3 flex gap-2">
              <button disabled={sent.includes(s.uid)} className="btn-primary flex-1 px-3 py-2 text-xs" onClick={() => void connect(s.uid)}>{sent.includes(s.uid) ? tr("Request sent") : <><UserPlus size={14} /> {tr("Connect")}</>}</button>
              <button className="btn-secondary flex-1 px-3 py-2 text-xs" onClick={() => invite(s.uid)}>{tr("Invite to team")}</button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function ReplacementToggle({ initial }: { initial: TeamView['openToReplacement'] }) {
  const [on, setOn] = useState(initial?.on ?? false)
  const [skills, setSkills] = useState((initial?.skills ?? []).join(', '))
  const [availability, setAvailability] = useState(initial?.availability ?? 'Full event')
  const { run } = useAct()
  const save = (v = on) => run('PUT', '/replacement/open', { on: v, skills: skills.split(',').map((x) => x.trim()).filter(Boolean), availability }, v ? tr("Preferences saved") : tr("You’re no longer open to replacement"))
  return (
    <Card className="p-6">
      <Toggle checked={on} onChange={(v) => { setOn(v); void save(v) }} label={tr("Open to replacement")} description={tr("If a team loses a member, we may invite you to fill the spot.")} />
      {on && (
        <div className="anim-fade mt-4 space-y-3 border-t border-line pt-4">
          <Field label={tr("Skills you can fill in with")}><Input value={skills} onChange={(e) => setSkills(e.target.value)} /></Field>
          <Field label={tr("Availability")}><Select value={availability} onChange={(e) => setAvailability(e.target.value)}><option>{tr("Full event")}</option><option>{tr("Day 1 only")}</option><option>{tr("Day 2 and 3")}</option></Select></Field>
          <button className="btn-secondary w-full" onClick={() => void save()}>{tr("Save preferences")}</button>
        </div>
      )}
    </Card>
  )
}

function MyTeam({ view, event }: { view: TeamView; event?: EventInfo }) {
  const { confirm } = useUI()
  const { run } = useAct()
  const now = useNow(60_000)
  const team = view.team!
  const locked = team.status === 'locked'
  const iAmLeader = team.members.some((m) => m.isMe && m.isLeader)
  const lockIn = countdown(event?.deadlines.teamLock, now)
  const teamLock = fmtDT(event?.deadlines.teamLock)
  const copy = (text: string, msg: string, description?: string) => navigator.clipboard.writeText(text).then(() => toast(msg, { description, kind: 'success' }), () => toast(text, { kind: 'info' }))
  const teamRequests = view.requests.map((r) => ({ type: r.type, who: team.members.find((m) => m.uid === r.uid)?.name ?? 'Someone', status: r.status, when: ago(r.createdAt) }))
  const [newReq, setNewReq] = useState(false)
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <Card className="p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <IconTile icon={UsersRound} tone="indigo" size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-extrabold text-ink">{team.name}</h2>{locked ? <Pill tone="green"><Lock size={11} /> {tr("Locked")}</Pill> : <Pill tone="amber">{tr("Forming")}</Pill>}</div>
              <p className="text-sm text-muted">{team.track} · {team.members.length} {tr("of")} {event?.teamMax ?? 4} {tr("members")}</p>
            </div>
            <div className="rounded-2xl bg-surface-2 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-faint">{tr("Invite code")}</p>
              <div className="flex items-center gap-2"><span className="font-mono text-lg font-bold text-ink">{team.inviteCode}</span><button aria-label={tr("Copy invite code")} className="rounded-lg p-1.5 text-muted hover:bg-brand-50 hover:text-brand-600" onClick={() => void copy(team.inviteCode, 'Invite code copied')}><Copy size={15} /></button></div>
            </div>
          </div>
          {locked
            ? <div className="mt-5"><InfoNote tone="green" icon={<Lock size={15} />}>{tr("Teams locked on")} {teamLock}{tr(". Changes now need organizer approval, and withdrawing starts the replacement process.")}</InfoNote></div>
            : <div className="mt-5 flex flex-col gap-4 rounded-2xl bg-amber-50 p-4 sm:flex-row sm:items-center"><Hourglass size={20} className="shrink-0 text-amber-600" /><p className="flex-1 text-sm text-amber-800">{tr("Team locks on")} <b>{teamLock}</b>{tr(". Add members and finish changes before then.")}</p><Countdown size="sm" tone="amber" parts={[[lockIn.days, tr("Days")], [lockIn.hours.padStart(2, '0'), tr("Hours")], [lockIn.minutes.padStart(2, '0'), tr("Mins")]]} /></div>}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-6 pt-6"><h3 className="text-[17px] font-bold text-ink">{tr("Members")}</h3>{!locked && <button className="btn-secondary px-4 py-2 text-xs" onClick={() => void copy(`${location.origin}/team?code=${team.inviteCode}`, 'Invite link copied', 'Share it on WhatsApp with your teammate.')}><Link2 size={14} /> {tr("Share invite link")}</button>}</div>
          <ul className="mt-3 divide-y divide-line">
            {team.members.map((m) => (
              <li key={m.uid} className="flex flex-wrap items-center gap-3 px-6 py-4 sm:flex-nowrap">
                <Avatar name={m.name ?? '?'} src={m.photoUrl} size={42} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-semibold text-ink">{m.name}{m.isLeader && <Crown size={14} className="text-amber-500" />}{m.isMe && <span className="text-xs font-medium text-muted">{tr("(you)")}</span>}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-muted">{m.college}{m.githubUsername && <> · <GithubIcon size={11} /> {m.githubUsername}</>}</p>
                </div>
                <div className="hidden flex-wrap gap-1 md:flex">{(m.skills ?? []).slice(0, 4).map((s) => <span key={s} className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{s}</span>)}</div>
                <StatusPill status={m.enrollment === 'enrolled' ? 'Enrolled' : 'Pending'} />
                {!locked && iAmLeader && !m.isMe && <button aria-label={`${tr("Remove")} ${m.name}`} className="rounded-lg p-2 text-faint hover:bg-rose-50 hover:text-rose-600" onClick={() => confirm({ title: `${tr("Remove")} ${m.name}?`, message: tr("They will leave the team and can join another team before the lock."), confirmLabel: tr("Remove"), danger: true, onConfirm: () => void run('DELETE', `/teams/${team.id}/members/${m.uid}`, undefined, `${m.name} removed`) })}><UserMinus size={17} /></button>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-end gap-3 border-t border-line bg-surface-2 px-6 py-4">
            {locked
              ? <button className="btn-danger" onClick={() => confirm({ title: tr("Withdraw from the event?"), message: tr("You will lose your seat. Your team keeps going: we invite a replacement from people open to replacement, then the waitlist. This can’t be undone."), confirmLabel: tr("Withdraw"), danger: true, reason: true, reasonRequired: true, reasonLabel: tr("Reason for withdrawing"), reasonPlaceholder: tr("e.g. Family emergency, can’t travel"), onConfirm: (reason) => void run('POST', '/teams/withdraw', { reason }, tr("You have withdrawn. We’ll find your team a replacement.")) })}><LogOut size={16} /> {tr("Withdraw from event")}</button>
              : <button className="btn-secondary text-rose-600" onClick={() => confirm({ title: tr("Leave this team?"), message: tr("You stay registered and can join or create another team before the lock."), confirmLabel: tr("Leave team"), danger: true, reason: true, onConfirm: () => void run('POST', '/teams/leave', {}, tr("You left the team")) })}><DoorOpen size={16} /> {tr("Leave team")}</button>}
          </div>
        </Card>
        {!locked && <Suggestions team={team} />}
      </div>
      <div className="space-y-5">
        <ReplacementToggle initial={view.openToReplacement} />
        <Card className="p-6">
          <CardHeader title={tr("Team change requests")} subtitle={tr("Changes after the lock go to the organizers")} />
          <ul className="mt-4 space-y-2.5">
            {teamRequests.length === 0 && <li className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">{tr("No pending requests.")}</li>}
            {teamRequests.map((r, i) => (
              <li key={i} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3">
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold capitalize text-ink">{r.type}: {r.who}</span><span className="text-xs text-muted">{r.when}</span></span>
                <StatusPill status={r.status === 'pending' ? 'Pending' : r.status === 'approved' ? 'Approved' : 'Rejected'} />
              </li>
            ))}
          </ul>
          <button className="btn-secondary mt-4 w-full" onClick={() => setNewReq(true)}><Plus size={15} /> {tr("New change request")}</button>
          {newReq && <ChangeRequest teamId={team.id} onDone={() => setNewReq(false)} />}
        </Card>
        <Card className="p-6">
          <CardHeader title={tr("Team repository")} subtitle={tr("Judges see commits from this repo")} />
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-sm"><GithubIcon size={16} /><span className="truncate font-mono text-[13px] text-ink-2">{team.repoUrl ? team.repoUrl.replace('https://', '') : tr("Not set yet")}</span></div>
          <p className="mt-2 text-xs text-muted">{tr("Edit it on the Submission page.")}</p>
        </Card>
      </div>
    </div>
  )
}

function ChangeRequest({ teamId, onDone }: { teamId: string; onDone: () => void }) {
  const [type, setType] = useState<'leave' | 'replace'>('replace')
  const [reason, setReason] = useState('')
  const { run, busy } = useAct()
  return (
    <div className="anim-fade mt-4 space-y-3 border-t border-line pt-4">
      <Field label={tr("Request")}><Select value={type} onChange={(e) => setType(e.target.value as 'leave' | 'replace')}><option value="replace">{tr("Replace a member")}</option><option value="leave">{tr("I want to leave")}</option></Select></Field>
      <Field label={tr("Reason")}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("Tell the organizers what changed")} /></Field>
      <button disabled={busy || reason.trim().length < 3} className="btn-primary w-full" onClick={() => void run('POST', '/team-requests', { type, teamId, reason: reason.trim() }, tr("Request sent to the organizers")).then((r) => r && onDone())}>{tr("Send request")}</button>
    </div>
  )
}

function Invitations({ list }: { list: TeamView['invitations'] }) {
  const { run, busy } = useAct()
  const invites = list.filter((i) => (i as { invitedBy?: string }).invitedBy)
  if (!invites.length) return null
  return (
    <Card className="p-6">
      <CardHeader title={tr("Team invitations")} subtitle={tr("A team leader invited you to join")} />
      <ul className="mt-4 space-y-2.5">
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3">
            <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{tr("Invitation to team")} <span className="font-mono">{i.teamId}</span><span className="block text-xs font-normal text-muted">{ago(i.createdAt)}</span></span>
            <button disabled={busy} className="btn-secondary px-3 py-2 text-xs" onClick={() => void run('POST', `/invitations/${i.id}/decline`, {}, tr("Invitation declined"))}>{tr("Decline")}</button>
            <button disabled={busy} className="btn-primary px-3 py-2 text-xs" onClick={() => void run('POST', `/invitations/${i.id}/accept`, {}, tr("You joined the team!"))}>{tr("Accept")}</button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function NoTeam({ event, invitations }: { event?: EventInfo; invitations: TeamView['invitations'] }) {
  const { me } = useSession()
  const { run, busy } = useAct()
  const [name, setName] = useState('')
  const [track, setTrack] = useState(me?.registration?.track ?? event?.tracks[0] ?? '')
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('code') ?? '')
  return (
    <div className="space-y-5">
      <Invitations list={invitations} />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card className="p-6">
          <IconTile icon={Plus} tone="indigo" />
          <h3 className="mt-4 text-lg font-bold text-ink">{tr("Create a team")}</h3>
          <p className="text-sm text-muted">{tr("You become the leader and get an invite code to share.")}</p>
          <div className="mt-4 space-y-3">
            <Field label={tr("Team name")}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. Byte Benders")} /></Field>
            <Field label={tr("Track")}><Select value={track} onChange={(e) => setTrack(e.target.value)}>{(event?.tracks ?? []).map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <button disabled={busy || !name.trim()} className="btn-primary w-full" onClick={() => void run('POST', '/teams', { name: name.trim(), track: track || undefined }, tr("Team created! Share the invite code."))}>{tr("Create team")}</button>
          </div>
        </Card>
        <Card className="p-6">
          <IconTile icon={KeyRound} tone="teal" />
          <h3 className="mt-4 text-lg font-bold text-ink">{tr("Join with a code")}</h3>
          <p className="text-sm text-muted">{tr("Ask your team leader for their invite code.")}</p>
          <div className="mt-4 space-y-3">
            <Field label={tr("Invite code")}><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="K3J9ZQ2A" className="font-mono uppercase" /></Field>
            <button disabled={busy || !code.trim()} className="btn-secondary w-full" onClick={() => void run('POST', '/teams/join', { inviteCode: code.trim().toUpperCase() }, tr("You joined the team!"))}>{tr("Join team")}</button>
          </div>
          <p className="mt-3 text-xs text-muted">{tr("Teams have")} {event?.teamMin ?? 2}–{event?.teamMax ?? 4} {tr("members and lock on")} {fmtDT(event?.deadlines.teamLock)}.</p>
        </Card>
      </div>
      <Suggestions team={null} />
    </div>
  )
}

function OfferCard({ kind, offers }: { kind: 'replacement' | 'waitlist'; offers: Offers }) {
  const { confirm } = useUI()
  const { run } = useAct()
  const now = useNow(1000)
  const rep = offers.replacements[0]
  const r = { teamName: rep?.teamName ?? '', track: rep?.track ?? '—', vacantRole: 'A member withdrew', leader: 'Team leader', members: '—' }
  const waitlistOffer = { position: offers.waitlist?.position ?? '—', seat: 'Solo seat, you can join or form a team before the lock' }
  const isRep = kind === 'replacement'
  const [h, m, s] = countdown(isRep ? rep?.expiresAt : offers.waitlist?.offerExpiresAt, now).clock.split(':')
  const answer = (yes: boolean) => isRep
    ? run('POST', `/replacements/${rep!.id}/${yes ? 'accept' : 'decline'}`, {}, yes ? tr("Accepted! The leader and organizers will confirm.") : tr("Offer declined"))
    : run('POST', '/waitlist/respond', { accept: yes }, yes ? tr("Seat accepted!") : tr("Offer declined"))
  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-r from-[#4f46e5] to-[#9b7bff] px-6 py-5 text-white sm:px-8">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/75">{isRep ? tr("Replacement invitation") : tr("Waitlist seat offer")}</p>
        <h2 className="mt-1 text-2xl font-extrabold">{isRep ? `${r.teamName} ${tr("wants you on their team")}` : tr("A seat just opened up for you!")}</h2>
      </div>
      <div className="grid grid-cols-1 gap-6 p-6 sm:p-8 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3 text-sm">
          {isRep ? (
            <>
              <p className="text-muted">{tr("A member of")} <b className="text-ink">{r.teamName}</b> {tr("withdrew. You were picked because you’re open to replacement and your skills match.")}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-2xl bg-surface-2 p-3"><p className="text-xs text-muted">{tr("Role")}</p><p className="font-semibold text-ink">{r.vacantRole}</p></div>
                <div className="rounded-2xl bg-surface-2 p-3"><p className="text-xs text-muted">{tr("Track")}</p><p className="font-semibold text-ink">{r.track}</p></div>
                
              </div>
              <InfoNote>{tr("After you accept, the team leader confirms and then an organizer approves. If you don’t answer in time, the next person is invited.")}</InfoNote>
            </>
          ) : (
            <>
              <p className="text-muted">{tr("You were")} <b className="text-ink">#{waitlistOffer.position}</b> {tr("on the waitlist.")} {waitlistOffer.seat}.</p>
              <InfoNote>{tr("Accept to get a confirmed seat. Then join or create a team, book an arrival slot and enroll your ID.")}</InfoNote>
            </>
          )}
        </div>
        <div className="flex flex-col items-center justify-center rounded-3xl bg-surface-2 p-5">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-faint">{tr("Answer within")}</p>
          <Countdown tone="rose" parts={[[h, tr("Hours")], [m, tr("Minutes")], [s, tr("Seconds")]]} />
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-3 border-t border-line bg-surface-2 px-6 py-4 sm:px-8">
        <button className="btn-secondary" onClick={() => confirm({ title: tr("Decline this offer?"), message: tr("We will offer the spot to the next person. You stay on the list for future openings."), confirmLabel: tr("Decline"), danger: true, reason: true, onConfirm: () => void answer(false) })}>{tr("Decline")}</button>
        <button className="btn-primary" onClick={() => void answer(true)}>{tr("Accept")} {isRep ? tr("and join team") : 'seat'}</button>
      </div>
    </Card>
  )
}

export default function Team() {
  const navigate = useNavigate()
  const { data: event } = useEventInfo()
  const { data: teamView, isLoading } = useTeam()
  const { data: offers } = useOffers()
  const view: View | 'loading' = isLoading || !teamView ? 'loading'
    : offers?.replacements.length ? 'replacement'
    : offers?.waitlist?.status === 'offered' ? 'waitlist'
    : teamView.team ? (teamView.team.status === 'locked' ? 'locked' : 'forming')
    : 'none'
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Team")} subtitle={tr("Your team, invitations and teammate suggestions")} actions={teamView?.team ? undefined : <button className="btn-secondary" onClick={() => navigate('/community')}>{tr("Browse community")}</button>} />
      {view === 'loading' && <Card><EmptyState title={tr("Loading your team…")} /></Card>}
      {(view === 'locked' || view === 'forming') && <MyTeam view={teamView!} event={event} />}
      {view === 'none' && <NoTeam event={event} invitations={teamView!.invitations} />}
      {view === 'replacement' && <OfferCard kind="replacement" offers={offers!} />}
      {view === 'waitlist' && <OfferCard kind="waitlist" offers={offers!} />}
      <p className={cn('text-center text-xs text-faint', view !== 'none' && 'hidden')}>{tr("Tip: turn on “Open to replacement” to be considered when a team loses a member.")}</p>
    </div>
  )
}
