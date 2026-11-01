import { useState } from 'react'
import { Lock, MessageSquareReply, Star } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '../components/ui/Card'
import { Field, Textarea } from '../components/ui/Form'
import { EmptyState } from '../components/ui/Misc'
import { cn } from '../lib/cn'
import { useAct, useP } from '../lib/data'
import { fmtDate } from '../lib/format'
import { tr } from '../i18n/strings'

const categories: Array<{ id: string; label: string; hint: string }> = [
  { id: 'organization', label: tr("Organization"), hint: tr("Planning, check-in, timings") },
  { id: 'mentors', label: tr("Mentors"), hint: tr("Availability and helpfulness") },
  { id: 'judging', label: tr("Judging"), hint: tr("Fairness and feedback") },
  { id: 'comms', label: tr("Communication"), hint: tr("Announcements and WhatsApp updates") },
  { id: 'infra', label: tr("Venue & internet"), hint: tr("Rooms, Wi-Fi, food") },
  { id: 'rewards', label: tr("Rewards"), hint: tr("Prize delivery") },
]

function Stars({ value, onChange, readOnly }: { value: number; onChange?: (v: number) => void; readOnly?: boolean }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={readOnly} aria-label={`${n} star${n > 1 ? 's' : ''}`} onMouseEnter={() => !readOnly && setHover(n)} onClick={() => onChange?.(n)} className="p-0.5 disabled:cursor-default">
          <Star size={26} className={cn('transition', (hover || value) >= n ? 'fill-amber-400 text-amber-400' : 'text-track')} />
        </button>
      ))}
    </div>
  )
}

/** Event rating: one per checked-in participant, 6 categories (plan S13, Rating schema). */
type RatingView = { canRate: boolean; rating: null | { scores: Record<string, number>; text?: string; response?: string; createdAt?: string; respondedAt?: string } }

export default function Rating() {
  const { data, isLoading } = useP<RatingView>('/rating')
  const { run, busy } = useAct()
  const [draft, setScores] = useState<Record<string, number>>({ organization: 0, mentors: 0, judging: 0, comms: 0, infra: 0, rewards: 0 })
  const [text, setText] = useState('')
  const done = Boolean(data?.rating)
  const state: 'form' | 'submitted' | 'locked' = done ? 'submitted' : data?.canRate ? 'form' : 'locked'
  const scores = data?.rating?.scores ?? draft
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Rate the Event")} subtitle={tr("Your rating helps organizers improve the next edition")} />
      {isLoading ? <Card><EmptyState title={tr("Loading…")} /></Card> : state === 'locked' ? (
        <Card><EmptyState icon={<Lock size={26} />} title={tr("Rating opens after you check in")} description={tr("Only participants who attended can rate the event, once it’s over.")} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card className="p-6">
            <CardHeader title={done ? tr("Your rating") : tr("How was it?")} subtitle={done ? `${tr("Submitted")}${data?.rating?.createdAt ? ` on ${fmtDate(data.rating.createdAt)}` : ''} ${tr("· one rating per participant")}` : tr("Tap the stars, 1 is poor and 5 is excellent")} />
            <ul className="mt-5 divide-y divide-line">
              {categories.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="font-semibold text-ink">{c.label}</p><p className="text-xs text-muted">{c.hint}</p></div>
                  <Stars value={scores[c.id]} readOnly={done} onChange={(v) => setScores({ ...draft, [c.id]: v })} />
                </li>
              ))}
            </ul>
            <Field label={tr("Anything else?")} className="mt-4"><Textarea disabled={done} value={done ? (data?.rating?.text ?? '') : text} onChange={(e) => setText(e.target.value)} placeholder={tr("What should they keep or change?")} /></Field>
            {!done && <div className="mt-5 flex justify-end"><button className="btn-primary" disabled={busy || Object.values(scores).some((v) => !v)} onClick={() => void run('POST', '/ratings', { scores: draft, text: text.trim() }, tr("Thanks for rating the event!"))}>{tr("Submit rating")}</button></div>}
            {!done && Object.values(scores).some((v) => !v) && <p className="mt-2 text-right text-xs text-muted">{tr("Rate all 6 categories to submit.")}</p>}
          </Card>
          {done && data?.rating?.response && (
            <Card className="p-6">
              <CardHeader title={<span className="flex items-center gap-2"><MessageSquareReply size={18} className="text-brand-500" /> {tr("Organizer response")}</span>} />
              <p className="mt-4 rounded-2xl bg-surface-2 p-4 text-sm leading-relaxed text-ink-2">{data.rating.response}</p>
              {data.rating.respondedAt && <p className="mt-2 text-xs text-muted">{tr("Organizers ·")} {fmtDate(data.rating.respondedAt)}</p>}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
