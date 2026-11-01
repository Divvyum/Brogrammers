import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, CalendarDays, CircleAlert, CircleX, Clock, FileText, Globe, MapPin, Trophy, Upload, UsersRound } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '../components/ui/Card'
import { IconTile } from '../components/ui/IconTile'
import { KV } from '../components/ui/Misc'
import { Pill } from '../components/ui/Badge'
import { InfoNote } from '../components/ui/Preview'
import { Field, Textarea } from '../components/ui/Form'
import { useConfig } from '../config'
import { useContent } from '../content'
import { useSession } from '../lib/session'
import { useAct, useEventInfo, useNow } from '../lib/data'
import { timelineOf } from '../lib/live'
import { fmtDT, fmtDate, fmtRange } from '../lib/format'
import { uploadFile, errorText } from '../lib/api'
import { openWhatsApp } from '../lib/offline'
import { toast } from '../lib/toast'
import { useUI } from '../context/UIContext'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

type RegState = 'not_registered' | 'eligible' | 'flagged' | 'rejected'

function StatusCard({ state }: { state: RegState }) {
  const { confirm } = useUI()
  const config = useConfig()
  const { me } = useSession()
  const { run } = useAct()
  const fileRef = useRef<HTMLInputElement>(null)
  const { whatsappNumber } = useContent()
  const reason = me?.registration?.eligibility?.reason ?? ''
  const uploadId = async (f?: File) => {
    if (!f) return
    try {
      const url = await uploadFile('complaint-evidence', f)
      await run('POST', '/registration/recheck', { reason: `College ID uploaded: ${url}` }, tr("College ID sent to the organizers"))
    } catch (e) {
      toast(errorText(e), { kind: 'error' })
    }
  }
  if (state === 'not_registered') {
    return (
      <Card className="p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <IconTile icon={Trophy} tone="amber" size="lg" />
          <div className="flex-1">
            <h3 className="text-lg font-bold text-ink">{tr("Registrations are open")}</h3>
            <p className="text-sm text-muted">{tr("Your profile is ready. Register to get your eligibility checked instantly.")}</p>
          </div>
          <a href="/onboarding" className="btn-primary px-6 py-3">{tr("Register for")} {config.eventName}</a>
        </div>
      </Card>
    )
  }
  const v = {
    eligible: { icon: BadgeCheck, tone: 'green' as const, title: tr("You’re eligible!"), pill: tr("Eligible"), body: reason || tr("All checks passed."), next: tr("Next: your team is locked. Book your arrival slot and enroll your ID."), ring: 'ring-emerald-200' },
    flagged: { icon: CircleAlert, tone: 'amber' as const, title: tr("Your registration needs a quick review"), pill: tr("Flagged for review"), body: reason || tr("An organizer will check your registration by hand. This usually takes less than a day."), next: tr("What to do: upload your college ID card so the organizer can approve you faster."), ring: 'ring-amber-200' },
    rejected: { icon: CircleX, tone: 'rose' as const, title: tr("You’re not eligible for this event"), pill: tr("Rejected"), body: reason || tr("Your profile doesn’t match this event’s eligibility rules."), next: tr("If this is a mistake, fix your year of study in your profile and ask for a re-check."), ring: 'ring-rose-200' },
  }[state]
  return (
    <Card className={cn('p-6 ring-1', v.ring)}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <IconTile icon={v.icon} tone={v.tone} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-ink">{v.title}</h3><Pill tone={v.tone === 'green' ? 'green' : v.tone}>{v.pill}</Pill></div>
          <p className="mt-1.5 text-sm text-muted"><b className="text-ink-2">{tr("Reason:")}</b> {v.body}</p>
          <div className="mt-3"><InfoNote tone={v.tone === 'green' ? 'green' : v.tone}>{v.next}</InfoNote></div>
          <div className="mt-4 flex flex-wrap gap-3">
            {state === 'eligible' && <><Link to="/journey" className="btn-primary">{tr("Book arrival slot")}</Link><Link to="/my-id" className="btn-secondary">{tr("My ID")}</Link></>}
            {state === 'flagged' && <><button className="btn-primary" onClick={() => fileRef.current?.click()}><Upload size={16} /> {tr("Upload college ID")}</button><input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => void uploadId(e.target.files?.[0])} /><button className="btn-secondary" onClick={() => openWhatsApp(whatsappNumber, 'HELP')}>{tr("Message organizers")}</button></>}
            {state === 'rejected' && <><Link to="/profile" className="btn-primary">{tr("Edit profile")}</Link><button className="btn-secondary" onClick={() => confirm({ title: tr("Ask for a re-check?"), message: tr("An organizer will review your registration again. Tell them what changed."), confirmLabel: tr("Send request"), reason: true, reasonRequired: true, reasonLabel: tr("What changed?"), reasonPlaceholder: tr("e.g. I updated my year of study, I am in year 4"), onConfirm: (why) => void run('POST', '/registration/recheck', { reason: why ?? '' }, tr("Re-check requested")) })}>{tr("Ask for a re-check")}</button></>}
          </div>
        </div>
      </div>
    </Card>
  )
}

export default function EventPage() {
  const config = useConfig()
  const content = useContent()
  const { me: who } = useSession()
  const { data: e } = useEventInfo()
  const { run, busy } = useAct()
  const [question, setQuestion] = useState('')
  const r = who?.registration
  const result = r?.eligibility?.result
  const state: RegState = !r ? 'not_registered' : result === 'rejected' || r.status === 'rejected' ? 'rejected' : result === 'flagged' || r.status === 'flagged' ? 'flagged' : 'eligible'
  const me = { uid: who?.uid ?? '', track: r?.track ?? '', registeredAt: fmtDate(r?.registeredAt) }
  const rules = e?.eligibilityRules ?? {}
  const event = {
    name: e?.name ?? config.eventName,
    dates: fmtRange(e?.startAt, e?.endAt),
    venue: config.venue,
    mode: e ? e.mode[0].toUpperCase() + e.mode.slice(1) : '',
    teamMin: e?.teamMin ?? 2,
    teamMax: e?.teamMax ?? 4,
    tracks: e?.tracks ?? [],
    deadlines: { teamLock: fmtDT(e?.deadlines.teamLock) },
    prizes: content.prizes,
    eligibility: [
      rules.allowedYears?.length ? `Students in year ${rules.allowedYears.join(', ')}` : 'Students of any year',
      rules.allowedColleges?.length ? `Colleges: ${rules.allowedColleges.slice(0, 6).join(', ')}${rules.allowedColleges.length > 6 ? '…' : ''}` : 'Open to all colleges',
      `Teams of ${e?.teamMin ?? 2} to ${e?.teamMax ?? 4} people`,
      ...content.rules,
    ],
    timeline: timelineOf(e),
  }
  const now = useNow(60_000)
  const reached = event.timeline.filter((t) => new Date(t.at).getTime() <= now).length
  const open = !e || now < new Date(e.deadlines.teamLock).getTime()
  const sendQuestion = async () => {
    if (question.trim().length < 3) return toast(tr("Type your question first"), { kind: 'error' })
    if (await run('POST', '/tickets', { text: `Question: ${question.trim()}` }, tr("Question sent to the organizers"))) setQuestion('')
  }
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Event & Registration")} subtitle={tr("Event details, rules and your registration status")} />

      <StatusCard state={state} />

      <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#4f46e5] via-[#6d5cf5] to-[#a78bfa] p-6 text-white shadow-btn sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/10" />
        <Pill tone={open ? 'green' : 'slate'} className="relative">{open ? tr("Registrations open") : tr("Registrations closed")}</Pill>
        <h2 className="relative mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{event.name}</h2>
        <p className="relative mt-2 max-w-2xl text-white/85">{content.tagline || tr("Build solutions for real problems, with mentors from industry and prizes for the best teams.")}</p>
        <div className="relative mt-5 flex flex-wrap gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/25"><CalendarDays size={15} /> {event.dates}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/25"><MapPin size={15} /> {event.venue}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/25"><Globe size={15} /> {event.mode}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/25"><UsersRound size={15} /> {tr("Teams of")} {event.teamMin}–{event.teamMax}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card className="p-6">
            <CardHeader title={tr("Tracks")} subtitle={`${tr("Problem statements unlock on")} ${fmtDT(e?.rounds[0]?.startAt ?? e?.startAt)}`} />
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {event.tracks.map((t) => (
                <div key={t} className={cn('rounded-2xl border p-4', t === me.track ? 'border-brand-300 bg-brand-50' : 'border-line')}>
                  <p className="text-sm font-bold text-ink">{t}</p>
                  <p className="mt-0.5 text-xs text-muted">{tr("Problem statements at release")}</p>
                  {t === me.track && <p className="mt-2 text-xs font-semibold text-brand-600">{tr("Your track")}</p>}
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-6">
            <CardHeader title={tr("Prizes")} />
            {event.prizes.length === 0 && <p className="mt-3 text-sm text-muted">{tr("Prizes will be announced soon.")}</p>}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {event.prizes.map((p) => (
                <div key={p.place} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3.5">
                  <IconTile icon={Trophy} tone={p.tone} size="sm" />
                  <div><p className="text-sm font-bold text-ink">{p.place}</p><p className="text-xs text-muted">{p.prize}</p></div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-6">
            <CardHeader title={tr("Eligibility rules")} />
            <ul className="mt-3 space-y-2.5">
              {event.eligibility.map((r) => <li key={r} className="flex items-start gap-2.5 text-sm text-ink-2"><BadgeCheck size={17} className="mt-0.5 shrink-0 text-emerald-500" /> {r}</li>)}
            </ul>
          </Card>
        </div>
        <div className="space-y-5">
          <Card className="p-6">
            <CardHeader title={tr("Key dates")} />
            <ol className="relative mt-4 space-y-4 border-l-2 border-track pl-5">
              {event.timeline.map((t, i) => (
                <li key={t.label} className="relative">
                  <span className={cn('absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white dark:ring-[#161a38]', i < reached ? 'bg-emerald-500' : i === reached ? 'bg-brand-500' : 'bg-track')} />
                  <p className="text-sm font-semibold text-ink">{t.label}</p>
                  <p className="text-xs text-muted">{t.date}</p>
                </li>
              ))}
            </ol>
          </Card>
          <Card className="p-6">
            <CardHeader title={tr("My registration")} />
            <div className="mt-2 divide-y divide-line">
              <KV k="Registered on" v={me.registeredAt} />
              <KV k="Participant ID" v={<span className="font-mono text-[13px]">{me.uid}</span>} />
              <KV k="Track" v={me.track} />
              <KV k="Team lock" v={<span className="inline-flex items-center gap-1"><Clock size={13} /> {event.deadlines.teamLock}</span>} />
            </div>
          </Card>
          <Card className="p-6">
            <CardHeader title={tr("Code of conduct")} />
            <p className="mt-2 text-sm text-muted">{tr("Be kind, credit others’ work, and keep the venue clean. Report problems through Event Day → Help.")}</p>
            <button className="btn-ghost mt-3 px-0 text-brand-600" onClick={() => (content.rulesUrl ? window.open(content.rulesUrl, '_blank', 'noopener') : toast(tr("The full rules will be shared before the event"), { kind: 'info' }))}><FileText size={16} /> {tr("Read the full rules (PDF)")}</button>
          </Card>
          <Card className="p-6">
            <CardHeader title={tr("Questions?")} />
            <Field label={tr("Ask the organizers")} className="mt-3"><Textarea value={question} onChange={(ev) => setQuestion(ev.target.value)} placeholder={tr("Type your question")} className="min-h-[80px]" /></Field>
            <button disabled={busy} className="btn-secondary mt-3 w-full" onClick={() => void sendQuestion()}>{tr("Send question")}</button>
          </Card>
        </div>
      </div>
    </div>
  )
}
