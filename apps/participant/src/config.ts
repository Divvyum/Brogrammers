import { useSession } from './lib/session'
import { useEventInfo } from './lib/data'
import { countdown, fmtRange, initialsOf } from './lib/format'
import { useNow } from './lib/data'
import { useContent } from './content'

/**
 * Everything on screen that names the student or the event. Comes from the
 * signed-in participant (/me) and the event (/event).
 */
export function useConfig() {
  const { me, event: pub, phone, email, user } = useSession()
  const { data: event } = useEventInfo()
  const content = useContent()
  const now = useNow(60_000)
  const p = me?.profile ?? {}
  const startAt = event?.startAt ?? pub?.startAt
  const cd = countdown(startAt, now)
  const studentName = p.name ?? user?.displayName ?? 'Participant'
  return {
    studentName,
    studentEmail: (p as { email?: string }).email ?? user?.email ?? email,
    studentPhone: user?.phoneNumber ?? (phone ? `+91 ${phone}` : ''),
    college: p.college ?? '',
    year: p.year ?? 1,
    city: p.city ?? '',
    githubUsername: p.githubUsername ?? '',
    track: me?.registration?.track ?? '',
    photoUrl: p.photoUrl,
    eventName: event?.name ?? pub?.name ?? 'Hackathon',
    eventDates: fmtRange(startAt, event?.endAt ?? pub?.endAt),
    venue: content.venue || 'Venue shared before arrival',
    countdown: { days: cd.days, hours: cd.hours, minutes: cd.minutes },
    firstName: studentName.split(' ')[0],
    initials: initialsOf(studentName),
  }
}
