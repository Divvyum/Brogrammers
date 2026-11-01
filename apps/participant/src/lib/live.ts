import { useSession } from './session'
import { useEventInfo, useNow, useP, type EventInfo, type TeamView } from './data'
import { ago, fmtDT, fmtDay, fmtTime } from './format'
import { tr } from '../i18n/strings'

// Real data in the shapes the screens were designed with (the AURA design's mock
// data). Each hook reads one /api/p route.

export type StepState = 'done' | 'current' | 'upcoming'
export type Audience = { type: 'all' | 'track' | 'room' | 'team' | 'role'; ids: string[] }

export const audienceLabel = (a?: Audience) =>
  !a || a.type === 'all' || a.type === 'role' ? tr('Everyone') : a.type === 'track' ? `${tr('Track:')} ${a.ids.join(', ')}` : a.type === 'room' ? tr('Your room') : tr('Your team')

// ---------- registration status ----------

const ORDER = ['registered', 'eligible', 'team_locked', 'travel_booked', 'enrolled', 'checked_in', 'room_assigned', 'submitted', 'results', 'reward_received']

export function useStatusSteps() {
  const { me } = useSession()
  const { data: event } = useEventInfo()
  const { data: team } = useTeam()
  const { data: slots } = useSlots()
  const { data: room } = useRoom()
  const r = me?.registration
  const status = r?.status === 'flagged' || r?.status === 'rejected' ? 'registered' : (r?.status ?? 'registered')
  const at = Math.max(0, ORDER.indexOf(status))
  const slot = slots?.find((s) => s.id === r?.slotId)
  const detail: Record<string, string> = {
    registered: r?.registeredAt ? fmtDay(r.registeredAt) : 'Profile done',
    eligible: r?.eligibility?.result === 'eligible' ? 'Rules passed' : r?.eligibility?.result === 'flagged' ? 'Under review' : r?.eligibility?.result === 'rejected' ? 'Not eligible' : 'Checking',
    team_locked: team?.team?.name ?? 'No team yet',
    travel_booked: slot ? `${tr('Slot')} ${fmtTime(slot.startAt)}` : 'Book a slot',
    enrolled: r?.enrollment?.status === 'enrolled' ? 'This phone' : 'Not yet',
    checked_in: r?.checkedInAt ? fmtDT(r.checkedInAt) : 'At the gate',
    room_assigned: room ? `${room.name}${room.seat ? ` · ${tr('seat')} ${seatNo(room.seat)}` : ''}` : 'After check-in',
    submitted: event ? `${tr('Due')} ${fmtDT(event.deadlines.submission)}` : '',
    results: event?.resultsPublishedAt ? fmtDT(event.resultsPublishedAt) : 'After judging',
    reward_received: 'If you win',
  }
  const labels: Record<string, [string, string]> = {
    registered: ['Registered', '/event'],
    eligible: ['Eligible', '/event'],
    team_locked: ['Team locked', '/team'],
    travel_booked: ['Travel & arrival', '/journey'],
    enrolled: ['ID enrolled', '/my-id'],
    checked_in: ['Checked in', '/my-id'],
    room_assigned: ['Room assigned', '/journey'],
    submitted: ['Submitted', '/submission'],
    results: ['Results', '/results'],
    reward_received: ['Reward received', '/rewards'],
  }
  const steps = ORDER.map((id, i) => ({
    id,
    label: labels[id][0],
    to: labels[id][1],
    detail: detail[id],
    state: (i <= at ? 'done' : i === at + 1 ? 'current' : 'upcoming') as StepState,
  }))
  return { steps, done: at + 1 }
}

export const seatNo = (seat?: string | null) => (seat ? (seat.split('-').pop() ?? seat) : '—')

// ---------- team / offers ----------

export const useTeam = () => useP<TeamView>('/team')

export interface Offers {
  replacements: { id: string; status: string; teamId: string; teamName: string; track: string | null; expiresAt: string | null }[]
  waitlist: null | { position?: number; status: string; offerExpiresAt?: string }
}
export const useOffers = () => useP<Offers>('/offers')

// ---------- journey ----------

export interface SlotRow { id: string; startAt: string; endAt: string; capacity: number; booked: number }
export const useSlots = () => useP<SlotRow[]>('/slots')
export const slotView = (s: SlotRow) => ({ ...s, time: `${fmtTime(s.startAt)} – ${fmtTime(s.endAt)}`, date: fmtDay(s.startAt) })

export interface RoomRow { id: string; name: string; floor: string; track: string | null; mentorDesk: boolean; seat: string | null }
export const useRoom = () => useP<RoomRow | null>('/room')

export interface TravelRow { city: string; route: string; mode: string; departAt: string; arriveAt: string; carpool?: boolean }
export const useTravel = () => useP<TravelRow | null>('/travel')

export interface CircleRow { id: string; route: string; city?: string; mode?: string; members: string[]; memberDetails: { uid: string; name?: string }[]; meetupPoint?: string; carpool?: boolean; arriveFrom?: string }
export const useCircles = () => useP<CircleRow[]>('/circles')
export const circleName = (c: CircleRow) => [c.city, c.mode && c.mode[0].toUpperCase() + c.mode.slice(1), c.arriveFrom && fmtDay(c.arriveFrom)].filter(Boolean).join(' · ') || c.route

// ---------- schedule / feed / problems ----------

export type Kind = 'ceremony' | 'hack' | 'food' | 'talk' | 'deadline' | 'mentor'
export interface ScheduleRow { id: string; title: string; startAt: string; endAt: string; location?: string; audience: Audience }
export function kindOf(title: string): Kind {
  const t = title.toLowerCase()
  if (/lunch|dinner|breakfast|snack|food|meal|tea|coffee/.test(t)) return 'food'
  if (/deadline|due|release|checkpoint|submission/.test(t)) return 'deadline'
  if (/mentor/.test(t)) return 'mentor'
  if (/workshop|talk|session|keynote|panel/.test(t)) return 'talk'
  if (/ceremony|opening|closing|check-in|arrival|results/.test(t)) return 'ceremony'
  return 'hack'
}
export function useSchedule() {
  const q = useP<ScheduleRow[]>('/schedule')
  const { data: event } = useEventInfo()
  const day0 = event ? new Date(event.startAt) : null
  const now = useNow(60_000)
  const items = (q.data ?? []).map((s) => {
    const d = new Date(s.startAt)
    const n = day0 ? Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(day0.getFullYear(), day0.getMonth(), day0.getDate())) / 86_400_000) + 1 : 1
    return {
      id: s.id,
      day: `${tr('Day')} ${Math.max(1, n)} · ${fmtDay(s.startAt)}`,
      start: fmtTime(s.startAt),
      end: fmtTime(s.endAt),
      title: s.title,
      location: s.location ?? '',
      audience: audienceLabel(s.audience),
      kind: kindOf(s.title),
      mine: s.audience?.type !== 'all',
      now: new Date(s.startAt).getTime() <= now && now < new Date(s.endAt).getTime(),
      startAt: s.startAt,
      endAt: s.endAt,
    }
  })
  return { ...q, items }
}
export type ScheduleItem = ReturnType<typeof useSchedule>['items'][number]

export interface FeedRow { id: string; title: string; body: string; emergency: boolean; audience: Audience; createdAt: string; seen: boolean }
export function useFeed() {
  const q = useP<FeedRow[]>('/feed', { refetchInterval: 60_000 })
  const items = (q.data ?? []).map((a) => ({ ...a, time: ago(a.createdAt), audience: audienceLabel(a.audience), pinned: false }))
  return { ...q, items }
}
export type Announcement = ReturnType<typeof useFeed>['items'][number]

// ---------- mentors / submission ----------

export interface MentorsView {
  mentors: { uid: string; name: string; tracks: string[]; openSlots: { id: string; startAt: string; endAt: string }[] }[]
  bookings: { id: string; mentorUid: string; mentorName?: string; startAt: string; endAt: string; topic: string | null; bookedBy: string | null }[]
}
export const useMentors = () => useP<MentorsView>('/mentors')

export interface SubmissionView {
  deadline: string
  locked: boolean
  teamId: string | null
  current: null | { pptUrl?: string; videoUrl?: string; repoUrl?: string; description?: string | null; version: number; receiptId: string; submittedAt: string }
  versions: { version: number; receiptId: string; submittedAt: string }[]
}
export const useSubmission = () => useP<SubmissionView>('/submission')

/** Event dates shown on the Event page timeline. */
export function timelineOf(e?: EventInfo) {
  if (!e) return []
  const firstProblem = e.rounds[0]?.startAt ?? e.startAt
  return [
    { label: tr("Team lock"), date: fmtDT(e.deadlines.teamLock), at: e.deadlines.teamLock },
    { label: tr("Arrival & check-in"), date: fmtDay(e.startAt), at: e.startAt },
    { label: tr("Hacking starts"), date: fmtDT(firstProblem), at: firstProblem },
    ...e.rounds.slice(1).map((r) => ({ label: r.name, date: fmtDT(r.startAt), at: r.startAt })),
    { label: tr("Submissions due"), date: fmtDT(e.deadlines.submission), at: e.deadlines.submission },
    { label: tr("Results"), date: e.resultsPublishedAt ? fmtDT(e.resultsPublishedAt) : fmtDay(e.endAt), at: e.resultsPublishedAt ?? e.endAt },
  ]
}
