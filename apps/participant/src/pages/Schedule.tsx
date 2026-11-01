import { useMemo, useState } from 'react'
import { CalendarPlus, Coffee, Flag, Lightbulb, MapPin, Mic, PartyPopper, UsersRound } from 'lucide-react'
import { Card, PageHeader } from '../components/ui/Card'
import { Tabs } from '../components/ui/Tabs'
import { Toggle } from '../components/ui/Form'
import { Pill } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/Misc'
import { useSchedule, type ScheduleItem } from '../lib/live'
import { useConfig } from '../config'
import { useNow } from '../lib/data'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

const kind: Record<ScheduleItem['kind'], { icon: typeof Coffee; c: string; bar: string }> = {
  ceremony: { icon: PartyPopper, c: 'bg-violet-50 text-violet-600', bar: 'bg-violet-400' },
  hack: { icon: Lightbulb, c: 'bg-brand-50 text-brand-600', bar: 'bg-brand-400' },
  food: { icon: Coffee, c: 'bg-amber-50 text-amber-600', bar: 'bg-amber-400' },
  talk: { icon: Mic, c: 'bg-teal-50 text-teal-600', bar: 'bg-teal-400' },
  deadline: { icon: Flag, c: 'bg-rose-50 text-rose-600', bar: 'bg-rose-400' },
  mentor: { icon: UsersRound, c: 'bg-blue-50 text-blue-600', bar: 'bg-blue-400' },
}

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Downloads the schedule as an .ics file for any calendar app. */
function downloadIcs(name: string, items: ScheduleItem[]) {
  const esc = (v: string) => v.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AURA//Schedule//EN', ...items.flatMap((s) => ['BEGIN:VEVENT', `UID:${s.id}@aura`, `DTSTAMP:${icsDate(new Date().toISOString())}`, `DTSTART:${icsDate(s.startAt)}`, `DTEND:${icsDate(s.endAt)}`, `SUMMARY:${esc(s.title)}`, `LOCATION:${esc(s.location)}`, 'END:VEVENT']), 'END:VCALENDAR']
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }))
  a.download = `${name.replace(/\W+/g, '-')}-schedule.ics`
  a.click()
}

/** Live schedule timeline filtered to my track (plan S8). */
export default function Schedule() {
  const config = useConfig()
  const { items: schedule, isLoading } = useSchedule()
  const now = useNow(60_000)
  const days = Array.from(new Set(schedule.map((s) => s.day)))
  const [picked, setDay] = useState<string>()
  const day = picked && days.includes(picked) ? picked : (schedule.find((s) => new Date(s.endAt).getTime() > now)?.day ?? days[0])
  const [mine, setMine] = useState(false)
  const items = useMemo(() => schedule.filter((s) => s.day === day && (!mine || s.mine)), [schedule, day, mine])
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Schedule")} subtitle={`${config.eventName} · ${config.eventDates} ${tr("· times in IST")}`} actions={<button className="btn-secondary" disabled={!schedule.length} onClick={() => downloadIcs(config.eventName, schedule)}><CalendarPlus size={16} /> {tr("Add to calendar")}</button>} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={day ?? ''} onChange={setDay} tabs={days.map((d) => ({ id: d, label: d }))} />
        <div className="w-full sm:w-[290px]"><Toggle checked={mine} onChange={setMine} label={tr("Only my track")} description={`${tr('Sessions just for')} ${config.track || tr('your track')}`} /></div>
      </div>
      <Card className="p-4 sm:p-6">
        {items.length === 0 ? <EmptyState title={isLoading ? tr("Loading schedule…") : tr("Nothing scheduled")} description={isLoading ? undefined : schedule.length ? tr("Try turning off the track filter.") : tr("The organizers haven’t published the schedule yet.")} /> : (
          <ol className="relative">
            {items.map((s, i) => {
              const K = kind[s.kind]
              const now = s.now
              return (
                <li key={s.id} className="relative flex gap-3 pb-5 last:pb-0 sm:gap-5">
                  <div className="w-14 shrink-0 pt-3 text-right sm:w-16"><p className="text-sm font-bold text-ink">{s.start}</p>{s.end !== s.start && <p className="text-xs text-faint">{s.end}</p>}</div>
                  <div className="relative flex flex-col items-center">
                    <span className={cn('z-10 mt-3 h-3.5 w-3.5 rounded-full ring-4 ring-white dark:ring-[#161a38]', now ? 'bg-brand-500 pulse-ring' : K.bar)} />
                    {i < items.length - 1 && <span className="absolute top-6 h-full w-0.5 bg-track" />}
                  </div>
                  <div className={cn('min-w-0 flex-1 rounded-2xl border p-4 transition', now ? 'border-brand-300 bg-brand-50' : 'border-line bg-white/60 dark:bg-transparent')}>
                    <div className="flex flex-wrap items-start gap-3">
                      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', K.c)}><K.icon size={17} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-ink">{s.title}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[13px] text-muted"><MapPin size={13} /> {s.location}</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {now && <Pill tone="indigo">{tr("Happening now")}</Pill>}
                        {s.mine && <Pill tone="violet">{tr("Your track")}</Pill>}
                        {!s.mine && !now && <Pill tone="slate" dot={false}>{tr("Everyone")}</Pill>}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </Card>
    </div>
  )
}
