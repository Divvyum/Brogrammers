import { useState } from 'react'
import { Bell, CalendarCheck, Clock, MapPin, X } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '../components/ui/Card'
import { Tabs } from '../components/ui/Tabs'
import { Avatar } from '../components/ui/Misc'
import { Pill, StatusPill } from '../components/ui/Badge'
import { Modal } from '../components/ui/Overlay'
import { Field, Textarea } from '../components/ui/Form'
import { InfoNote } from '../components/ui/Preview'
import { EmptyState } from '../components/ui/Misc'
import { useMentors } from '../lib/live'
import { useAct, useNow } from '../lib/data'
import { useSession } from '../lib/session'
import { useRoom } from '../lib/live'
import { fmtDay, fmtTime } from '../lib/format'
import { useUI } from '../context/UIContext'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

/** Calendar of open 15-minute slots, book or cancel, my bookings (plan S9, M14). */
export default function Mentors() {
  const { confirm } = useUI()
  const { me } = useSession()
  const { data, isLoading } = useMentors()
  const { data: room } = useRoom()
  const { run, busy } = useAct()
  const mentors = (data?.mentors ?? []).map((x) => ({ ...x, expertise: x.tracks.join(' · ') || tr("All tracks"), track: x.tracks[0] ?? 'All tracks', company: 'Mentor' }))
  const bookings = data?.bookings ?? []
  const allSlots = [...mentors.flatMap((x) => x.openSlots.map((sl) => ({ ...sl, mentorUid: x.uid }))), ...bookings]
  const mentorDays = Array.from(new Set(allSlots.sort((a, b) => a.startAt.localeCompare(b.startAt)).map((sl) => fmtDay(sl.startAt))))
  const [picked, setDay] = useState<string>()
  const day = picked && mentorDays.includes(picked) ? picked : mentorDays[0]
  const onDay = allSlots.filter((sl) => fmtDay(sl.startAt) === day)
  const mentorTimes = Array.from(new Set(onDay.map((sl) => fmtTime(sl.startAt)))).sort()
  const slotAt = (mentor: string, time: string) => onDay.find((sl) => sl.mentorUid === mentor && fmtTime(sl.startAt) === time)
  const mentorSlotStatus = (mentor: string, time: string): 'open' | 'mine' | 'none' => {
    const sl = slotAt(mentor, time)
    return !sl ? 'none' : bookings.some((b) => b.id === sl.id) ? 'mine' : 'open'
  }
  const [book, setBook] = useState<{ mentor: string; time: string } | null>(null)
  const [topic, setTopic] = useState('')
  const m = mentors.find((x) => x.uid === book?.mentor)
  const now = useNow(60_000)
  const myBookings = bookings.map((b) => {
    const past = new Date(b.endAt).getTime() < now
    return { id: b.id, mentor: b.mentorName ?? 'Mentor', expertise: b.topic ?? tr("General session"), when: `${fmtDay(b.startAt)}, ${fmtTime(b.startAt)} – ${fmtTime(b.endAt)}`, where: room?.mentorDesk ? `${tr("Mentor desk, Room")} ${room.name}` : tr("Mentor desk"), status: past ? 'done' : 'booked', reminder: tr("10 min before on WhatsApp"), mine: b.bookedBy === me?.uid }
  })
  const confirmBooking = async () => {
    const sl = book && slotAt(book.mentor, book.time)
    if (!sl) return
    if (await run('POST', `/mentor-slots/${sl.id}/book`, { topic: topic.trim() || undefined }, tr("Session booked. Your team gets a WhatsApp reminder."))) { setBook(null); setTopic('') }
  }
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Mentors")} subtitle={tr("Book 15-minute sessions. Each team can hold up to 3 bookings.")} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 px-6 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-[17px] font-bold text-ink">{tr("Available slots")}</h3>
            {mentorDays.length > 0 && <Tabs value={day ?? ''} onChange={setDay} tabs={mentorDays.map((d) => ({ id: d, label: d }))} />}
          </div>
          {mentorTimes.length === 0 && <EmptyState title={isLoading ? tr("Loading slots…") : tr("No open slots")} description={isLoading ? undefined : tr("Mentors publish their slots before the event. Check back soon.")} />}
          <div className="mt-5 overflow-x-auto">
            <table className={cn('w-full min-w-[640px] border-separate border-spacing-0', mentorTimes.length === 0 && 'hidden')}>
              <thead>
                <tr>
                  <th className="th sticky left-0 z-10 w-20 bg-surface-2">{tr("Time")}</th>
                  {mentors.map((x) => (
                    <th key={x.uid} className="th bg-surface-2 normal-case tracking-normal">
                      <div className="flex items-center gap-2"><Avatar name={x.name} size={28} /><span className="min-w-0"><span className="block truncate text-[13px] font-bold text-ink">{x.name}</span><span className="block truncate text-[11px] font-medium text-muted">{x.expertise}</span></span></div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mentorTimes.map((t) => (
                  <tr key={t}>
                    <td className="sticky left-0 border-t border-line bg-white px-4 py-2 text-sm font-semibold text-ink-2">{t}</td>
                    {mentors.map((x) => {
                      const st = mentorSlotStatus(x.uid, t)
                      return (
                        <td key={x.uid} className="border-t border-line px-2 py-1.5">
                          <button disabled={st === 'none'} onClick={() => st === 'open' && setBook({ mentor: x.uid, time: t })} className={cn('h-9 w-full rounded-xl text-xs font-semibold transition', st === 'open' && 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100', st === 'none' && 'cursor-not-allowed bg-track text-faint', st === 'mine' && 'bg-brand-500 text-white shadow-btn')}>
                            {st === 'open' ? tr("Book") : st === 'none' ? '—' : tr("Your team")}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="p-6">
            <CardHeader title={tr("My bookings")} subtitle={`${myBookings.length} ${tr("of 3 used")}`} />
            <ul className="mt-4 space-y-3">
              {myBookings.length === 0 && <li className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">{tr("No sessions booked yet.")}</li>}
              {myBookings.map((b) => (
                <li key={b.id} className="rounded-2xl border border-line p-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={b.mentor} size={38} />
                    <div className="min-w-0 flex-1"><p className="truncate font-semibold text-ink">{b.mentor}</p><p className="truncate text-xs text-muted">{b.expertise}</p></div>
                    <StatusPill status={b.status === 'booked' ? 'Confirmed' : 'Completed'} />
                  </div>
                  <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-2"><Clock size={14} className="text-muted" /> {b.when}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2"><MapPin size={14} className="text-muted" /> {b.where}</p>
                  {b.status === 'booked' && b.mine && (
                    <div className="mt-3 flex items-center justify-between">
                      <span className="flex items-center gap-1 text-xs text-muted"><Bell size={12} /> {b.reminder}</span>
                      <button className="btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => confirm({ title: tr("Cancel this session?"), message: tr("The slot is released for other teams."), confirmLabel: tr("Cancel session"), danger: true, onConfirm: () => void run('DELETE', `/mentor-slots/${b.id}/book`, undefined, tr("Session cancelled")) })}><X size={13} /> {tr("Cancel")}</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-6">
            <CardHeader title={tr("Mentors for your track")} />
            <ul className="mt-3 space-y-3">
              {mentors.length === 0 && <li className="text-sm text-muted">{tr("Mentors will be listed here.")}</li>}
              {mentors.map((x) => <li key={x.uid} className="flex items-center gap-3"><Avatar name={x.name} size={34} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{x.name}</p><p className="truncate text-xs text-muted">{x.company} · {x.expertise}</p></div><Pill tone="slate" dot={false}>{x.track}</Pill></li>)}
            </ul>
          </Card>
        </div>
      </div>

      <Modal open={!!book} onClose={() => setBook(null)} title={tr("Book a mentor session")} subtitle={m && `${m.name} · ${day}, ${book?.time} ${tr("(15 min)")}`} footer={<><button className="btn-secondary" onClick={() => setBook(null)}>{tr("Cancel")}</button><button disabled={busy} className="btn-primary" onClick={() => void confirmBooking()}><CalendarCheck size={16} /> {tr("Confirm booking")}</button></>}>
        <Field label={tr("What do you want help with?")} hint={tr("Helps the mentor prepare.")}><Textarea value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={tr("e.g. Review our model architecture and data pipeline")} /></Field>
        <div className="mt-4"><InfoNote icon={<Bell size={15} />}>{tr("We remind your whole team on WhatsApp 10 minutes before.")}</InfoNote></div>
      </Modal>
    </div>
  )
}
