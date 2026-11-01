import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { BellRing, CheckCircle2, Clock, Coffee, DoorOpen, LifeBuoy, MapPin, RefreshCw, Send, ShowerHead, UserRound, UtensilsCrossed } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '../components/ui/Card'
import { Tabs } from '../components/ui/Tabs'
import { Avatar, EmptyState, QR } from '../components/ui/Misc'
import { Pill } from '../components/ui/Badge'
import { Chip, Field, Select, Textarea } from '../components/ui/Form'
import { InfoNote } from '../components/ui/Preview'
import { useConfig } from '../config'
import { useContent } from '../content'
import { useAct, useEventInfo, useNow, useP } from '../lib/data'
import { useRoom } from '../lib/live'
import { api } from '../lib/api'
import { ago, fmtDT, fmtDay, fmtTime } from '../lib/format'
import { toast } from '../lib/toast'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'


type Tab = 'progress' | 'help' | 'map' | 'food'

function Progress() {
  const { data: event } = useEventInfo()
  const { data: list = [] } = useP<Array<{ id: string; text: string; name?: string; createdAt: string }>>('/progress')
  const { run, busy } = useAct()
  const [text, setText] = useState('')
  const now = useNow(60_000)
  const progressUpdates = list.map((u) => ({ text: u.text, by: u.name ?? 'Teammate', time: fmtDT(u.createdAt) }))
  const start = event ? new Date(event.startAt).getTime() : now
  const nextIn = (4 * 3_600_000 - ((now - start) % (4 * 3_600_000) + 4 * 3_600_000) % (4 * 3_600_000)) / 60_000
  const post = async () => { if (await run('POST', '/progress', { text: text.trim() }, tr("Update posted"))) setText('') }
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-6">
        <CardHeader title={tr("Post a progress update")} subtitle={tr("Mentors and organizers see these. A reminder comes every 4 hours.")} />
        <Field label={tr("What did your team get done?")} className="mt-4"><Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={tr("e.g. Finished the alert engine, starting the voice output")} className="min-h-[130px]" /></Field>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted"><BellRing size={13} /> {tr("Next reminder in")} {Math.floor(nextIn / 60)} {tr("h")} {Math.round(nextIn % 60)} {tr("m")}</span>
          <button disabled={busy || !text.trim()} className="btn-primary" onClick={() => void post()}><Send size={15} /> {tr("Post update")}</button>
        </div>
      </Card>
      <Card className="p-6">
        <CardHeader title={tr("Team updates")} />
        <ol className="mt-4 space-y-4">
          {progressUpdates.length === 0 && <li className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{tr("No updates yet. Post your first one.")}</li>}
          {progressUpdates.map((u, i) => (
            <li key={i} className="flex gap-3">
              <Avatar name={u.by} size={34} />
              <div className="min-w-0 flex-1 rounded-2xl bg-surface-2 p-3.5"><p className="text-sm text-ink-2">{u.text}</p><p className="mt-1.5 text-xs text-faint">{u.by} · {u.time}</p></div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  )
}

function Help() {
  const { helpPhone } = useContent()
  const tone = { open: 'amber', assigned: 'indigo', resolved: 'green' } as const
  const { data: room } = useRoom()
  const { data: list = [] } = useP<Array<{ id: string; text: string; roomId?: string; status: string; assignedTo?: string; createdAt: string; resolution?: string }>>('/tickets')
  const { run, busy } = useAct()
  const [type, setType] = useState('Wi-Fi / internet')
  const [where, setWhere] = useState(room?.name ?? 'Food court')
  const [text, setText] = useState('')
  const tickets = list.map((t) => ({ id: `TK-${t.id.slice(0, 5).toUpperCase()}`, text: t.text, room: t.roomId && t.roomId === room?.id ? room.name : (t.roomId ?? 'Venue'), status: t.status, assignedTo: t.assignedTo ? 'Volunteer assigned' : 'Waiting for a volunteer', time: ago(t.createdAt), resolution: t.resolution }))
  const send = async () => {
    if (text.trim().length < 3) return toast(tr("Describe the problem"), { kind: 'error' })
    if (await run('POST', '/tickets', { text: `[${type}] ${text.trim()} (at ${where})`, roomId: where === room?.name ? room.id : undefined }, tr("Sent to the help desk"))) setText('')
  }
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-6">
        <CardHeader title={tr("Ask for help")} subtitle={tr("A volunteer near your room picks it up")} />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr("Type")}><Select value={type} onChange={(e) => setType(e.target.value)}><option>{tr("Wi-Fi / internet")}</option><option>{tr("Power / hardware")}</option><option>{tr("Food / water")}</option><option>{tr("Medical")}</option><option>{tr("Something else")}</option></Select></Field>
          <Field label={tr("Where are you?")}><Select value={where} onChange={(e) => setWhere(e.target.value)}>{room && <option>{room.name}</option>}<option>{tr("Food court")}</option><option>{tr("Main Auditorium")}</option></Select></Field>
          <Field label={tr("Describe the problem")} className="sm:col-span-2"><Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={tr("e.g. Wi-Fi keeps dropping at table 14")} /></Field>
        </div>
        <div className="mt-4 flex justify-end"><button disabled={busy} className="btn-primary" onClick={() => void send()}><LifeBuoy size={16} /> {tr("Send to help desk")}</button></div>
        <div className="mt-4"><InfoNote tone="rose">{tr("Medical emergency?")} {helpPhone ? <>{tr("Call the venue doctor at")} <b>{helpPhone}</b> {tr("or go")}</> : tr("Go")} {tr("to the help desk at the main gate.")}</InfoNote></div>
      </Card>
      <Card className="p-6">
        <CardHeader title={tr("My tickets")} />
        <ul className="mt-4 space-y-3">
          {tickets.length === 0 && <li className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{tr("No tickets. Hope it stays that way!")}</li>}
          {tickets.map((t) => (
            <li key={t.id} className="rounded-2xl border border-line p-4">
              <div className="flex items-start justify-between gap-3"><p className="font-semibold text-ink">{t.text}</p><Pill tone={tone[t.status as keyof typeof tone]}>{t.status[0].toUpperCase() + t.status.slice(1)}</Pill></div>
              <p className="mt-1 text-xs text-muted">{t.id} · {t.room} · {t.time}</p>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-2"><UserRound size={14} className="text-muted" /> {t.assignedTo}</p>
              {t.resolution && <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 size={14} /> {t.resolution}</p>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

const layers = [
  { id: 'rooms', label: tr("Rooms"), color: '#6366f1' },
  { id: 'food', label: tr("Food"), color: '#f59e0b' },
  { id: 'wash', label: tr("Washrooms"), color: '#14b8a6' },
  { id: 'mentor', label: tr("Mentor desks"), color: '#ec4899' },
  { id: 'gate', label: tr("Gates & help"), color: '#ef4444' },
]
function VenueMap() {
  const config = useConfig()
  const { map } = useContent()
  const { data: myRoom } = useRoom()
  const room = { name: myRoom?.name ?? 'Not allotted', floor: myRoom?.floor }
  const [on, setOn] = useState<string[]>(layers.map((l) => l.id))
  const toggle = (id: string) => setOn(on.includes(id) ? on.filter((x) => x !== id) : [...on, id])
  const markers = map.markers.map((m) => ({ ...m, me: m.layer === 'rooms' && m.label.toLowerCase() === myRoom?.name?.toLowerCase() }))
  const mine = markers.find((m) => m.me)
  // Nearest marker of a kind to my room on the map (or the first one).
  const nearest = (layer: string) => {
    const list = markers.filter((m) => m.layer === layer)
    if (!mine) return list[0]
    return [...list].sort((a, b) => Math.hypot(a.x - mine.x, a.y - mine.y) - Math.hypot(b.x - mine.x, b.y - mine.y))[0]
  }
  if (!map.imageUrl) {
    return <Card><EmptyState icon={<MapPin size={28} />} title={tr("Venue map coming soon")} description={tr("The organizers will publish the map with rooms, food, washrooms and help desks before the event.")} /></Card>
  }
  return (
    <Card className="p-4 sm:p-6">
      <CardHeader title={tr("Venue map")} subtitle={config.venue} action={<Pill tone="indigo"><MapPin size={11} /> {tr("You:")} {room.name}</Pill>} />
      <div className="mt-4 flex flex-wrap gap-2">{layers.map((l) => <Chip key={l.id} active={on.includes(l.id)} onClick={() => toggle(l.id)}><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />{l.label}</span></Chip>)}</div>
      <div className="keep-white relative mt-4 overflow-hidden rounded-2xl border border-line bg-white">
        <img src={map.imageUrl} alt={tr("Venue map")} className="block h-auto w-full" />
        {markers.filter((m) => on.includes(m.layer)).map((m, i) => {
          const c = layers.find((l) => l.id === m.layer)!.color
          return (
            <span key={i} className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5" style={{ left: `${m.x}%`, top: `${m.y}%` }}>
              <span className={cn('relative grid place-items-center rounded-full border-[3px] border-white shadow', m.me ? 'h-[18px] w-[18px]' : 'h-[14px] w-[14px]')} style={{ background: c }}>
                {m.me && <span className="absolute -inset-2 animate-ping rounded-full opacity-30" style={{ background: c }} />}
              </span>
              <b className="whitespace-nowrap rounded-md bg-white/90 px-1.5 text-[12px] text-[#141a46]">{m.me ? `${m.label} ${tr("(you)")}` : m.label}</b>
            </span>
          )
        })}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
        {[[DoorOpen, 'Your room', room.floor ? `${room.name}, floor ${room.floor}` : room.name], [Coffee, 'Nearest food', nearest('food')?.label ?? '—'], [ShowerHead, 'Washrooms', nearest('wash')?.label ?? '—'], [LifeBuoy, 'Help desk', nearest('gate')?.label ?? '—']].map(([I, k, v]) => {
          const Icon = I as typeof DoorOpen
          return <div key={k as string} className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5"><Icon size={17} className="shrink-0 text-brand-500" /><div className="min-w-0"><p className="text-xs text-muted">{k as string}</p><p className="truncate font-semibold text-ink">{v as string}</p></div></div>
        })}
      </div>
    </Card>
  )
}

function Food() {
  const stateTone = { claimed: 'green', active: 'indigo', upcoming: 'slate', over: 'slate' } as const
  const config = useConfig()
  const now = useNow(1000)
  const pass = useQuery({ queryKey: ['/food-pass'], queryFn: async () => ({ ...(await api<{ token: string; expiresInSeconds: number }>('/food-pass')), at: Date.now() }), refetchInterval: 14 * 60_000 })
  const { data: list = [] } = useP<Array<{ id: string; name: string; startAt: string; endAt: string; claimedAt: string | null; counter: string | null }>>('/meals')
  const meals = list.map((m) => {
    const live = new Date(m.startAt).getTime() <= now && now < new Date(m.endAt).getTime()
    return { id: m.id, name: m.name, when: `${fmtDay(m.startAt)}, ${fmtTime(m.startAt)} – ${fmtTime(m.endAt)}`, state: m.claimedAt ? 'claimed' : live ? 'active' : new Date(m.endAt).getTime() < now ? 'over' : 'upcoming', claimedAt: m.claimedAt ? `${fmtTime(m.claimedAt)}${m.counter ? ` · ${m.counter}` : ''}` : undefined }
  })
  const current = meals.find((m) => m.state === 'active') ?? meals.find((m) => m.state === 'upcoming')
  const left = pass.data ? Math.max(0, pass.data.expiresInSeconds - Math.floor((now - pass.data.at) / 1000)) : 0
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Card className="flex flex-col items-center p-6 text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-faint">{tr("Food pass")}{current ? ` · ${current.name}` : ''}</p>
        <div className="mt-4 keep-white rounded-[26px] bg-white p-4 shadow-card ring-1 ring-line">{pass.data ? <QR value={pass.data.token} size={220} /> : <div className="h-[220px] w-[220px]" />}</div>
        <p className="mt-4 text-lg font-extrabold text-ink">{config.studentName}</p>
        <p className="text-sm text-muted">{tr("Show this at any food counter")}</p>
        <p className="mt-3 flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-ink-2"><Clock size={13} /> {tr("Refreshes in")} {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} {tr("· one claim per meal")}</p>
        <button disabled={pass.isFetching} className="btn-secondary mt-4" onClick={() => void pass.refetch().then(() => toast(tr("Pass refreshed"), { kind: 'success' }))}><RefreshCw size={15} /> {tr("Refresh pass")}</button>
      </Card>
      <Card className="p-6">
        <CardHeader title={tr("Meals")} subtitle={tr("Counters reject a second claim for the same meal")} />
        <ul className="mt-4 space-y-2.5">
          {meals.length === 0 && <li className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{tr("Meals will be listed here.")}</li>}
          {meals.map((m) => (
            <li key={m.id} className={cn('flex items-center gap-3 rounded-2xl p-3.5', m.state === 'active' ? 'bg-brand-50 ring-1 ring-brand-200' : 'bg-surface-2')}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600"><UtensilsCrossed size={18} /></span>
              <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{m.name}</p><p className="text-xs text-muted">{m.when}{m.claimedAt && ` ${tr("· claimed")} ${m.claimedAt}`}</p></div>
              <Pill tone={stateTone[m.state as keyof typeof stateTone]}>{m.state === 'claimed' ? tr("Claimed") : m.state === 'active' ? tr("Serving now") : m.state === 'over' ? tr("Over") : tr("Later")}</Pill>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

export default function EventDay() {
  const [params] = useSearchParams()
  const { data: tickets = [] } = useP<Array<{ status: string }>>('/tickets')
  const [tab, setTab] = useState<Tab>((['progress', 'help', 'map', 'food'] as Tab[]).find((t) => t === params.get('tab')) ?? 'progress')
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Event Day")} subtitle={tr("Everything you need while hacking")} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'progress', label: tr("Progress") }, { id: 'help', label: tr("Help desk"), count: tickets.filter((t) => t.status !== 'resolved').length }, { id: 'map', label: tr("Venue map") }, { id: 'food', label: tr("Food pass") }]} />
      {tab === 'progress' && <Progress />}
      {tab === 'help' && <Help />}
      {tab === 'map' && <VenueMap />}
      {tab === 'food' && <Food />}
    </div>
  )
}
