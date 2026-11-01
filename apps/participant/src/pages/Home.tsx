import { Link } from 'react-router-dom'
import { ArrowRight, BedDouble, CalendarClock, ChevronRight, Clock, DoorOpen, FileUp, IdCard, MapPin, Megaphone, Route, Siren, UsersRound } from 'lucide-react'
import { Card, CardHeader } from '../components/ui/Card'
import { IconTile, type Tone } from '../components/ui/IconTile'
import { Avatar } from '../components/ui/Misc'
import { Pill } from '../components/ui/Badge'
import { StepTracker } from '../components/ui/StepTracker'
import { Countdown } from '../components/ui/Preview'
import { seatNo, slotView, useFeed, useMentors, useRoom, useSchedule, useSlots, useStatusSteps, useSubmission, useTeam, useCircles } from '../lib/live'
import { useConfig } from '../config'
import { useSession } from '../lib/session'
import { useEventInfo, useNow } from '../lib/data'
import { fmtDT, fmtDay } from '../lib/format'
import { useLang } from '../i18n/strings'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

type Fact = { icon: typeof DoorOpen; tone: Tone; label: string; value: string; sub: string; to: string }

export default function Home() {
  const { t } = useLang()
  const config = useConfig()
  const firstName = config.firstName
  const { me } = useSession()
  const reg = me?.registration
  const { data: event } = useEventInfo()
  const { steps: statusSteps, done } = useStatusSteps()
  const { items: schedule } = useSchedule()
  const { items: announcements } = useFeed()
  const { data: teamView } = useTeam()
  const team = teamView?.team
  const { data: room } = useRoom()
  const { data: slots } = useSlots()
  const { data: mentors } = useMentors()
  const { data: circles = [] } = useCircles()
  const { data: submission } = useSubmission()
  const now = useNow(60_000)
  const slot = slots?.find((s) => s.id === reg?.slotId)
  const sv = slot && slotView(slot)
  const nextBooking = mentors?.bookings.filter((b) => new Date(b.startAt).getTime() > now).sort((a, b) => a.startAt.localeCompare(b.startAt))[0]
  const facts: Fact[] = [
    { icon: Clock, tone: 'indigo', label: tr("Arrival slot"), value: sv ? sv.time : tr("Not booked"), sub: sv ? sv.date : tr("Book in JourneyLink"), to: '/journey' },
    { icon: BedDouble, tone: 'teal', label: tr("Room & seat"), value: room ? `${room.name}${room.seat ? ` · ${seatNo(room.seat)}` : ''}` : tr("Not allotted"), sub: room ? tr("Pre-allotted") : tr("After you book a slot"), to: '/journey' },
    { icon: CalendarClock, tone: 'violet', label: tr("Mentor session"), value: nextBooking ? fmtDT(nextBooking.startAt) : tr("None booked"), sub: nextBooking?.mentorName ?? tr("Book a mentor"), to: '/mentors' },
    { icon: FileUp, tone: 'pink', label: tr("Submission due"), value: event ? fmtDT(event.deadlines.submission) : '—', sub: submission?.current ? `${tr("Submitted v")}${submission.current.version}` : tr("Server time"), to: '/submission' },
  ]
  const upcomingDay = schedule.find((s) => new Date(s.endAt).getTime() > now)?.day ?? schedule[0]?.day
  const upcoming = schedule.filter((s) => s.day === upcomingDay && new Date(s.endAt).getTime() > now).slice(0, 4)
  const enrolled = reg?.enrollment?.status === 'enrolled'
  const notEnrolled = (team?.members ?? []).filter((m) => !m.isMe && m.enrollment !== 'enrolled')
  const next = (() => {
    const s = reg?.status
    if (s === 'flagged' || s === 'rejected') return { title: s === 'flagged' ? tr("Your registration is being reviewed") : tr("Your registration needs attention"), body: reg?.eligibility?.reason ?? tr("Open the Event page to see why and what to do."), to: '/event', cta: tr("See details") }
    if (!team) return { title: tr("Find your team"), body: `${tr("Teams have")} ${event?.teamMin ?? 2}–${event?.teamMax ?? 4} ${tr("members. Create one, join with a code, or let us suggest teammates.")}`, to: '/team', cta: tr("Go to Team") }
    if (!slot) return { title: tr("Book your arrival slot"), body: tr("Pick when you’ll reach the gate so the queue stays short. Your room is assigned after you book."), to: '/journey', cta: tr("Book a slot") }
    if (!enrolled) return { title: tr("Enroll your ID on this phone"), body: tr("Your digital ID works offline at the gate. Enroll it on the phone you’ll carry."), to: '/my-id', cta: tr("Enroll now") }
    if (!reg?.checkedInAt) return { title: `${tr("Check in at the gate on")} ${fmtDay(slot.startAt)}`, body: tr("Your ID is enrolled on this phone. At the gate, scan the volunteer’s QR and show your response QR. It works even in airplane mode."), to: '/my-id', cta: tr("Practice check-in") }
    if (!submission?.current && !submission?.locked) return { title: `${tr("Submit before")} ${fmtDT(submission?.deadline ?? event?.deadlines.submission)}`, body: tr("Upload your deck, demo video and repository. You can resubmit until the deadline."), to: '/submission', cta: tr("Open Submission") }
    return { title: event?.resultsPublishedAt ? tr("Results are out!") : tr("Results are coming"), body: event?.resultsPublishedAt ? tr("See the leaderboard, your scores and certificates.") : tr("Judging is under way. We’ll notify you when results are published."), to: '/results', cta: tr("Open Results") }
  })()
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-[30px]">{t('home.welcome')}, {firstName}! <span className="inline-block">👋</span></h1>
          <p className="mt-1 text-sm text-muted sm:text-[15px]">{t('home.subtitle')}</p>
        </div>
        <div className="flex gap-3">
          <Link to="/event" className="btn-secondary">{tr("Event page")}</Link>
          <Link to="/my-id" className="btn-primary"><IdCard size={17} /> {tr("Open My ID")}</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        {/* next action */}
        <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#4f46e5] via-[#6656f0] to-[#9b7bff] p-6 text-white shadow-btn sm:p-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-24 right-24 h-48 w-48 rounded-full bg-white/10" />
          <p className="relative text-xs font-bold uppercase tracking-[0.16em] text-white/75">{t('home.next')}</p>
          <h2 className="relative mt-2 max-w-xl text-2xl font-extrabold leading-tight sm:text-[28px]">{next.title}</h2>
          <p className="relative mt-2 max-w-xl text-sm text-white/85 sm:text-[15px]">{next.body}</p>
          <div className="relative mt-5 flex flex-wrap gap-2 text-[13px]">
            {sv && <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/25"><Clock size={14} /> {tr("Slot")} {sv.time}</span>}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/25"><MapPin size={14} /> {config.venue}</span>
            {room && <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/25"><DoorOpen size={14} /> {tr("Room")} {room.name}</span>}
          </div>
          <div className="relative mt-6 flex flex-wrap gap-3">
            <Link to={next.to} className="keep-white inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-2.5 text-sm font-bold text-brand-700 shadow-soft transition hover:brightness-95">{next.cta} <ArrowRight size={16} /></Link>
            <Link to="/journey" className="inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/40 hover:bg-white/10">{tr("Travel details")}</Link>
          </div>
        </div>

        {/* countdown */}
        <Card className="flex flex-col p-6">
          <CardHeader title={config.countdown.days === '0' && config.countdown.hours === '0' && config.countdown.minutes === '0' ? tr("Hackathon is live") : tr("Hackathon starts in")} subtitle={`${config.eventName} · ${config.eventDates}`} />
          <div className="my-auto flex justify-center py-5">
            <Countdown parts={[[config.countdown.days, tr("Days")], [config.countdown.hours, tr("Hours")], [config.countdown.minutes, tr("Minutes")]]} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-xl bg-surface-2 px-3 py-2"><p className="text-muted">{tr("Problems released")}</p><p className="font-bold text-ink">{fmtDT(event?.rounds[0]?.startAt ?? event?.startAt)}</p></div>
            <div className="rounded-xl bg-surface-2 px-3 py-2"><p className="text-muted">{tr("Submissions close")}</p><p className="font-bold text-ink">{fmtDT(event?.deadlines.submission)}</p></div>
          </div>
        </Card>
      </div>

      {/* journey */}
      <Card className="p-6">
        <CardHeader title={t('home.journey')} subtitle={tr("Tap any step to see its details")} action={<Pill tone="indigo">{done} {tr("of")} {statusSteps.length} {tr("done")}</Pill>} className="mb-6" />
        <StepTracker steps={statusSteps} />
      </Card>

      {/* facts */}
      <div className="grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-4">
        {facts.map((f) => (
          <Link key={f.label} to={f.to} className="card group flex items-center gap-3 p-4 transition hover:-translate-y-0.5 sm:gap-4 sm:p-5">
            <IconTile icon={f.icon} tone={f.tone} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-muted sm:text-[13px]">{f.label}</p>
              <p className="truncate text-sm font-bold text-ink sm:text-base">{f.value}</p>
              <p className="truncate text-[11.5px] text-faint sm:text-xs">{f.sub}</p>
            </div>
            <ChevronRight size={17} className="hidden shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-500 sm:block" />
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        <Card className="p-6">
          <CardHeader title={tr("Latest announcements")} action={<Link to="/announcements" className="text-sm font-semibold text-brand-600 hover:underline">{tr("View all")}</Link>} />
          <ul className="mt-4 space-y-2.5">
            {announcements.length === 0 && <li className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{tr("No announcements yet.")}</li>}
            {announcements.slice(0, 3).map((a) => (
              <li key={a.id}>
                <Link to="/announcements" className={cn('flex gap-3 rounded-2xl p-3 transition hover:bg-brand-50', a.emergency && 'bg-rose-50 ring-1 ring-rose-200 hover:bg-rose-50')}>
                  <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', a.emergency ? 'bg-rose-500 text-white' : 'bg-brand-50 text-brand-600')}>{a.emergency ? <Siren size={17} /> : <Megaphone size={17} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className={cn('truncate text-sm font-bold', a.emergency ? 'text-rose-700' : 'text-ink')}>{a.title}</span>{!a.seen && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{a.body}</span>
                    <span className="mt-1 block text-[11.5px] text-faint">{a.time} · {a.audience}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-6">
          <CardHeader title={tr("Upcoming schedule")} subtitle={upcomingDay ?? tr("Not published yet")} action={<Link to="/schedule" className="text-sm font-semibold text-brand-600 hover:underline">{tr("Full schedule")}</Link>} />
          <ul className="mt-4 space-y-1">
            {upcoming.length === 0 && <li className="px-2 py-2.5 text-sm text-muted">{tr("Nothing coming up.")}</li>}
            {upcoming.map((s) => (
              <li key={s.id} className="flex items-center gap-3.5 rounded-2xl px-2 py-2.5">
                <span className="w-12 shrink-0 text-sm font-bold text-ink">{s.start}</span>
                <span className={cn('h-9 w-1 shrink-0 rounded-full', s.kind === 'food' ? 'bg-amber-400' : s.kind === 'deadline' ? 'bg-rose-400' : 'bg-brand-400')} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{s.title}</span>
                  <span className="block truncate text-xs text-muted">{s.location}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-6 lg:col-span-2 xl:col-span-1">
          <CardHeader title={tr("My team")} action={team ? (team.status === 'locked' ? <Pill tone="green">{tr("Locked")}</Pill> : <Pill tone="amber">{tr("Forming")}</Pill>) : <Pill tone="slate">{tr("No team")}</Pill>} />
          <Link to="/team" className="mt-4 flex items-center gap-3 rounded-2xl bg-surface-2 p-3.5 transition hover:bg-brand-50">
            <IconTile icon={UsersRound} tone="indigo" size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold text-ink">{team?.name ?? tr("Create or join a team")}</span>
              <span className="block text-xs text-muted">{team ? `${team.track ?? config.track} · ${team.members.length} members` : `${tr("Teams of")} ${event?.teamMin ?? 2}–${event?.teamMax ?? 4}`}</span>
            </span>
            <ChevronRight size={16} className="text-faint" />
          </Link>
          {team && <div className="mt-4 flex -space-x-2">
            {team.members.map((m) => <Avatar key={m.uid} name={m.name ?? '?'} src={m.photoUrl} size={36} className="ring-2 ring-white dark:ring-[#161a38]" />)}
          </div>}
          {notEnrolled.length > 0 && <p className="mt-3 text-xs text-amber-700"><b>{notEnrolled.map((m) => m.name?.split(' ')[0]).join(', ')}</b> {notEnrolled.length === 1 ? tr("hasn’t") : tr("haven’t")} {tr("enrolled their ID yet.")}{event ? ` ${tr("Remind them before")} ${fmtDay(event.startAt)}.` : ''}</p>}
          <Link to="/journey" className="mt-4 flex items-center gap-3 rounded-2xl border border-line p-3 text-sm font-semibold text-ink-2 transition hover:bg-brand-50"><Route size={17} className="text-brand-500" /> {circles.length} {tr("travel circle")}{circles.length === 1 ? '' : 's'}</Link>
        </Card>
      </div>
    </div>
  )
}
