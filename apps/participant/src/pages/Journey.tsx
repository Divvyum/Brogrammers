import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BedDouble, Bus, Car, CheckCircle2, Clock, DoorOpen, LogOut, MapPin, Map as MapIcon, MessageCircle, Send, UsersRound } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '../components/ui/Card'
import { Tabs } from '../components/ui/Tabs'
import { Avatar, EmptyState, Progress } from '../components/ui/Misc'
import { Pill } from '../components/ui/Badge'
import { IconTile } from '../components/ui/IconTile'
import { Field, Input, Select, Toggle } from '../components/ui/Form'
import { InfoNote } from '../components/ui/Preview'
import { circleName, seatNo, slotView, useCircles, useRoom, useSlots, useTravel, type CircleRow, type TravelRow } from '../lib/live'
import { useAct, useP } from '../lib/data'
import { useSession } from '../lib/session'
import { fmtDay, fmtTime } from '../lib/format'
import { toast } from '../lib/toast'
import { useUI } from '../context/UIContext'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

type Tab = 'plan' | 'circles' | 'slot' | 'room'

const MODES = ['Bus', 'Train', 'Flight', 'Shared cab', 'Own vehicle']
const local = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '')
const duration = (a?: string, b?: string) => {
  if (!a || !b) return ''
  const m = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000))
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

function TravelPlan({ plan, circles }: { plan: TravelRow | null; circles: number }) {
  const { me } = useSession()
  const { run, busy } = useAct()
  const [carpool, setCarpool] = useState(plan?.carpool ?? false)
  const [form, setForm] = useState({ city: plan?.city ?? me?.profile?.city ?? '', mode: plan ? MODES.find((m) => m.toLowerCase() === plan.mode.toLowerCase()) ?? plan.mode : 'Bus', route: plan?.route ?? '', departAt: local(plan?.departAt), arriveAt: local(plan?.arriveAt) })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const save = async () => {
    if (!form.city.trim() || !form.departAt || !form.arriveAt) return toast(tr("Fill in city, departure and arrival"), { kind: 'error' })
    const r = await run<{ circleId: string | null }>('PUT', '/travel', { city: form.city.trim(), route: form.route.trim() || `${form.city.trim()} → venue`, mode: form.mode.toLowerCase(), departAt: new Date(form.departAt).toISOString(), arriveAt: new Date(form.arriveAt).toISOString(), carpool }, (x) => (x.circleId ? 'Saved. You’re in a travel circle!' : 'Travel plan saved'))
    return r
  }
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card className="p-6">
        <CardHeader title={tr("Travel plan")} subtitle={tr("We match you with people on the same route and date")} action={plan ? <Pill tone="green">{tr("Saved")}</Pill> : <Pill tone="amber">{tr("Not saved")}</Pill>} />
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr("Travelling from (city)")}><Input value={form.city} onChange={set('city')} /></Field>
          <Field label={tr("Mode")}><Select value={form.mode} onChange={set('mode')}>{MODES.map((m) => <option key={m}>{m}</option>)}</Select></Field>
          <Field label={tr("Route")} className="sm:col-span-2" hint={tr("e.g. train number or bus route, so we can match you better")}><Input value={form.route} onChange={set('route')} /></Field>
          <Field label={tr("Departure")}><Input type="datetime-local" value={form.departAt} onChange={set('departAt')} /></Field>
          <Field label={tr("Arrival at venue")}><Input type="datetime-local" value={form.arriveAt} onChange={set('arriveAt')} /></Field>
        </div>
        <div className="mt-5 rounded-2xl bg-surface-2 p-4"><Toggle checked={carpool} onChange={setCarpool} label={tr("Open to carpool")} description={tr("Show me people who want to share a cab or ride.")} /></div>
        <div className="mt-5 flex justify-end"><button disabled={busy} className="btn-primary" onClick={() => void save()}>{tr("Save travel plan")}</button></div>
      </Card>
      <div className="space-y-5">
        <Card className="p-6">
          <CardHeader title={tr("Your trip")} />
          {!plan ? <p className="mt-4 text-sm text-muted">{tr("Save your plan to see your trip here.")}</p> : <>
          <div className="mt-4 flex items-center gap-3">
            <div className="text-center"><p className="text-lg font-extrabold text-ink">{fmtTime(plan.departAt)}</p><p className="text-xs text-muted">{plan.city}</p></div>
            <div className="relative flex-1"><div className="h-0.5 w-full border-t-2 border-dashed border-brand-300" /><span className="absolute left-1/2 top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-brand-500 text-white"><Bus size={15} /></span></div>
            <div className="text-center"><p className="text-lg font-extrabold text-ink">{fmtTime(plan.arriveAt)}</p><p className="text-xs text-muted">{tr("Venue")}</p></div>
          </div>
          <p className="mt-4 text-center text-xs text-muted">{fmtDay(plan.departAt)} · {duration(plan.departAt, plan.arriveAt)}</p></>}
        </Card>
        <InfoNote icon={<UsersRound size={15} />}>{tr("You’re in")} <b>{circles} {tr("travel circle")}{circles === 1 ? '' : 's'}</b>{tr(". Circles are updated every time you save and once an hour.")}</InfoNote>
      </div>
    </div>
  )
}

type Msg = { id: string; uid: string; name?: string; text: string; createdAt: string; mine: boolean }

function Circles({ circles }: { circles: CircleRow[] }) {
  const { confirm } = useUI()
  const { run, busy } = useAct()
  const [picked, setSel] = useState<string>()
  const [msg, setMsg] = useState('')
  const sel = picked && circles.some((x) => x.id === picked) ? picked : circles[0]?.id
  const c = circles.find((x) => x.id === sel)
  const { data: circleMessages = [] } = useP<Msg[]>(c ? `/circles/${c.id}/messages` : null, { refetchInterval: 15_000 })
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [circleMessages.length])
  const names = (x: CircleRow) => x.memberDetails.map((m) => m.name ?? 'Member')
  const send = async () => {
    if (!c || !msg.trim()) return
    if (await run('POST', `/circles/${c.id}/messages`, { text: msg.trim() })) setMsg('')
  }
  const editMeetup = () => {
    const v = window.prompt('Suggest a meetup point', c?.meetupPoint ?? '')?.trim()
    if (v && c) void run('PATCH', `/circles/${c.id}`, { meetupPoint: v }, tr("Meetup point updated"))
  }
  if (!c) return <Card><EmptyState icon={<UsersRound size={28} />} title={tr("No travel circle yet")} description={tr("Save your travel plan and we’ll group you with people from nearby cities arriving around the same time.")} action={<button disabled={busy} className="btn-primary" onClick={() => void run<{ groups: number }>('POST', '/circles/rematch', {}, tr("Circles refreshed"))}>{tr("Find circles")}</button>} /></Card>
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-3">
        {circles.map((x) => (
          <button key={x.id} onClick={() => setSel(x.id)} className={cn('card w-full p-4 text-left transition', sel === x.id ? 'ring-2 ring-brand-300' : 'hover:-translate-y-0.5')}>
            <div className="flex items-start justify-between gap-2"><p className="text-sm font-bold text-ink">{circleName(x)}</p><span className="shrink-0 rounded-full bg-brand-50 px-2 text-xs font-bold leading-5 text-brand-700">{x.members.length}</span></div>
            <p className="mt-1 text-xs text-muted">{x.route}</p>
            <div className="mt-3 flex items-center justify-between">
              <div className="flex -space-x-2">{names(x).slice(0, 4).map((m, i) => <Avatar key={i} name={m} size={26} className="ring-2 ring-white dark:ring-[#161a38]" />)}</div>
              {x.carpool && <Pill tone="teal"><Car size={11} /> {tr("Carpool")}</Pill>}
            </div>
          </button>
        ))}
        <button disabled={busy} className="btn-secondary w-full" onClick={() => void run('POST', '/circles/rematch', {}, tr("Circles refreshed"))}>{tr("Find more circles")}</button>
      </div>
      <Card className="flex min-h-[520px] flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1"><p className="truncate font-bold text-ink">{circleName(c)}</p><p className="text-xs text-muted">{c.members.length} {tr("members ·")} {names(c).join(', ')}</p></div>
          <button className="btn-ghost text-xs text-rose-600" onClick={() => confirm({ title: tr("Leave this circle?"), message: tr("You will stop getting messages from this circle."), confirmLabel: tr("Leave"), danger: true, onConfirm: () => void run('POST', `/circles/${c.id}/leave`, {}, tr("You left the circle")) })}><LogOut size={14} /> {tr("Leave")}</button>
        </div>
        <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-5 py-3 text-sm">
          <MapPin size={17} className="shrink-0 text-rose-500" />
          <span className="min-w-0 flex-1"><span className="text-xs text-muted">{tr("Meetup point")}</span><span className="block truncate font-semibold text-ink">{c.meetupPoint || tr("Not set yet")}</span></span>
          <button className="btn-ghost shrink-0 text-xs" onClick={editMeetup}>{tr("Suggest change")}</button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
          {circleMessages.length === 0 && <p className="text-center text-[11px] font-semibold text-faint">{tr("No messages yet. Say hello!")}</p>}
          {circleMessages.map((m, i) => (
            <div key={m.id}>
              {(i === 0 || fmtDay(circleMessages[i - 1].createdAt) !== fmtDay(m.createdAt)) && <p className="mb-3 text-center text-[11px] font-semibold text-faint">{fmtDay(m.createdAt)}</p>}
              <div className={cn('flex gap-2.5', m.mine && 'flex-row-reverse')}>
                {!m.mine && <Avatar name={m.name ?? '?'} size={30} />}
                <div className={cn('max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm', m.mine ? 'rounded-tr-md bg-brand-500 text-white' : 'rounded-tl-md bg-surface-2 text-ink-2')}>
                  {!m.mine && <p className="mb-0.5 text-xs font-bold text-brand-600">{m.name}</p>}
                  {m.text}
                  <p className={cn('mt-1 text-right text-[10.5px]', m.mine ? 'text-white/70' : 'text-faint')}>{fmtTime(m.createdAt)}</p>
                </div>
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
        <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send() }}>
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={tr("Message your circle")} className="input flex-1" />
          <button type="submit" disabled={busy || !msg.trim()} className="btn-primary px-4" aria-label={tr("Send message")}><Send size={16} /></button>
        </form>
      </Card>
    </div>
  )
}

function Slots({ booked }: { booked?: string }) {
  const { confirm } = useUI()
  const { run } = useAct()
  const { data = [], isLoading } = useSlots()
  const arrivalSlots = data.map(slotView)
  const [picked, setSelected] = useState<string>()
  const selected = picked ?? booked ?? arrivalSlots.find((s) => s.booked < s.capacity)?.id ?? ''
  const book = () => run<{ room: { roomId: string; seat: string } | null }>('POST', `/slots/${selected}/book`, {}, (r) => (r.room ? `Slot booked · seat ${seatNo(r.room.seat)}` : 'Slot booked'))
  if (!isLoading && !arrivalSlots.length) return <Card><EmptyState icon={<Clock size={28} />} title={tr("Arrival slots aren’t open yet")} description={tr("You’ll get a WhatsApp message when you can book.")} /></Card>
  return (
    <div className="space-y-5">
      <InfoNote icon={<Clock size={15} />}>{tr("Pick when you’ll arrive at the gate. Each slot has limited capacity so the queue stays short. You can change your slot until it starts.")}</InfoNote>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {arrivalSlots.map((s) => {
          const left = s.capacity - s.booked
          const full = left <= 0
          const pct = (s.booked / s.capacity) * 100
          return (
            <button key={s.id} disabled={full} onClick={() => setSelected(s.id)} className={cn('card relative p-5 text-left transition disabled:cursor-not-allowed disabled:opacity-60', selected === s.id && !full && 'ring-2 ring-brand-400', !full && 'hover:-translate-y-0.5')}>
              {s.id === booked && <span className="absolute right-4 top-4"><Pill tone="green">{tr("Your slot")}</Pill></span>}
              <p className="text-xs font-semibold text-muted">{s.date}</p>
              <p className="mt-0.5 text-xl font-extrabold text-ink">{s.time}</p>
              <Progress value={pct} tone={full ? 'rose' : pct > 85 ? 'amber' : 'green'} className="mt-4" />
              <p className={cn('mt-2 text-sm font-semibold', full ? 'text-rose-600' : left < 15 ? 'text-amber-600' : 'text-emerald-600')}>{full ? tr("Full") : `${left} of ${s.capacity} ${tr("places left")}`}</p>
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white/70 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-2">{tr("Selected:")} <b className="text-ink">{arrivalSlots.find((s) => s.id === selected)?.date}, {arrivalSlots.find((s) => s.id === selected)?.time}</b></p>
        <button className="btn-primary" disabled={!selected || selected === booked} onClick={() => (booked ? confirm({ title: tr("Change your arrival slot?"), message: tr("Your current slot is released for others. Your room stays the same."), confirmLabel: tr("Change slot"), onConfirm: () => void book() }) : void book())}>{selected === booked ? tr("Already booked") : tr("Book this slot")}</button>
      </div>
    </div>
  )
}

function Room() {
  const { data: room, refetch, isFetching } = useRoom()
  return (
    <div className="space-y-5">
      {!room ? (
        <Card><EmptyState icon={<BedDouble size={28} />} title={tr("Your room isn’t allotted yet")} description={tr("Rooms are assigned after you book an arrival slot. You’ll get a WhatsApp message when it’s ready.")} action={<button disabled={isFetching} className="btn-primary" onClick={() => void refetch()}>{tr("Check again")}</button>} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#0f766e] to-[#14b8a6] p-7 text-white shadow-card">
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
            <p className="relative text-xs font-bold uppercase tracking-[0.16em] text-white/75">{tr("Room & seat · Pre-allotted")}</p>
            <div className="relative mt-4 flex items-end gap-8">
              <div><p className="text-sm text-white/75">{tr("Room")}</p><p className="text-5xl font-extrabold">{room.name}</p></div>
              <div><p className="text-sm text-white/75">{tr("Seat")}</p><p className="text-5xl font-extrabold">{seatNo(room.seat)}</p></div>
            </div>
            <p className="relative mt-4 text-white/85">{room.floor}</p>
            <div className="relative mt-5 flex flex-wrap gap-2 text-sm">
              {room.track && <span className="rounded-full bg-white/15 px-3 py-1 ring-1 ring-white/25">{tr("Track:")} {room.track}</span>}
              {room.mentorDesk && <span className="rounded-full bg-white/15 px-3 py-1 ring-1 ring-white/25">{tr("Mentor desk in room")}</span>}
              <span className="rounded-full bg-white/15 px-3 py-1 ring-1 ring-white/25">{tr("Your team sits together")}</span>
            </div>
          </div>
          <Card className="p-6">
            <CardHeader title={tr("Good to know")} />
            <ul className="mt-4 space-y-3 text-sm text-ink-2">
              <li className="flex gap-2.5"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-500" />{tr("Shown on your ID card and to the volunteer at check-in.")}</li>
              <li className="flex gap-2.5"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-500" />{tr("If rooms are rebalanced after your slot, we’ll message you the new room.")}</li>
              <li className="flex gap-2.5"><MessageCircle size={17} className="mt-0.5 shrink-0 text-emerald-500" />{tr("Send")} <b>MY ROOM</b> {tr("to the AURA WhatsApp number any time.")}</li>
            </ul>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link to="/event-day?tab=map" className="btn-secondary"><MapIcon size={16} /> {tr("Venue map")}</Link>
              <Link to="/my-id" className="btn-primary"><DoorOpen size={16} /> {tr("Show on ID")}</Link>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

export default function Journey() {
  const [tab, setTab] = useState<Tab>('plan')
  const { me } = useSession()
  const { data: plan, isLoading: planLoading } = useTravel()
  const { data: circles = [] } = useCircles()
  const { data: slots = [] } = useSlots()
  const { data: room } = useRoom()
  const mySlot = slots.find((s) => s.id === me?.registration?.slotId)
  return (
    <div className="space-y-5">
      <PageHeader title={tr("JourneyLink")} subtitle={tr("Travel together, book your arrival slot and find your room")} actions={<button className="btn-secondary" onClick={() => setTab('slot')}>{mySlot ? `${tr("Arrival slot:")} ${fmtTime(mySlot.startAt)}` : tr("Book arrival slot")} <ArrowRight size={15} /></button>} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Bus, tone: 'indigo' as const, label: tr("Travel plan"), v: plan ? `${tr("Saved ·")} ${plan.mode[0].toUpperCase()}${plan.mode.slice(1)}` : tr("Not saved") },
          { icon: UsersRound, tone: 'violet' as const, label: tr("Circles"), v: `${circles.length} joined` },
          { icon: Clock, tone: 'teal' as const, label: tr("Arrival slot"), v: mySlot ? `${fmtDay(mySlot.startAt)} · ${fmtTime(mySlot.startAt)}` : tr("Not booked") },
          { icon: BedDouble, tone: 'pink' as const, label: tr("Room"), v: room ? `${room.name}${room.seat ? ` · Seat ${seatNo(room.seat)}` : ''}` : tr("Not allotted") },
        ].map((x) => (
          <Card key={x.label} className="flex items-center gap-3 p-4"><IconTile icon={x.icon} tone={x.tone} size="sm" /><div className="min-w-0"><p className="truncate text-xs text-muted">{x.label}</p><p className="truncate text-sm font-bold text-ink">{x.v}</p></div></Card>
        ))}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'plan', label: tr("Travel plan") }, { id: 'circles', label: tr("My circles"), count: circles.length }, { id: 'slot', label: tr("Arrival slot") }, { id: 'room', label: tr("Room & seat") }]} />
      {tab === 'plan' && !planLoading && <TravelPlan key={plan ? 'saved' : 'new'} plan={plan ?? null} circles={circles.length} />}
      {tab === 'circles' && <Circles circles={circles} />}
      {tab === 'slot' && <Slots booked={me?.registration?.slotId} />}
      {tab === 'room' && <Room />}
    </div>
  )
}
