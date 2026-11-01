import { useMemo } from 'react'
import { Award, Download, EyeOff, Medal, MessageSquareQuote, Share2, ShieldCheck, Trophy } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '../components/ui/Card'
import { Pill } from '../components/ui/Badge'
import { Countdown } from '../components/ui/Preview'
import { useEventInfo, useNow, useP } from '../lib/data'
import { useTeam } from '../lib/live'
import { countdown, fmtDate } from '../lib/format'
import { toast } from '../lib/toast'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

/** Leaderboard (when visible), my scores per criterion, judge feedback, certificates (plan S12, M17). */
type ResultsView = {
  teamId: string | null
  leaderboard: null | { teams: { teamId: string; teamName: string; rank: number; total: number; track: string | null }[] }
  rubric: { id: string; name: string; weight: number; max: number }[]
  myScores: { criteria: Record<string, number>; total: number; comment?: string }[]
}
type Cert = { id: string; type: string; rank?: number; issuedAt: string; downloadUrl: string }
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10 < 4 ? n % 10 : 0]}`

export default function Results() {
  const now = useNow(1000)
  const { data: event } = useEventInfo()
  const { data: teamView } = useTeam()
  const res = useP<ResultsView>('/results', { retry: false })
  const { data: certs = [] } = useP<Cert[]>('/certificates')
  const state: 'published' | 'hidden' = res.data ? 'published' : 'hidden'
  const rubric = useMemo(() => res.data?.rubric ?? [], [res.data])
  const judges = useMemo(() => res.data?.myScores ?? [], [res.data])
  const myScores = useMemo(() => Object.fromEntries(rubric.map((c) => {
    const vals = judges.map((j) => j.criteria[c.id]).filter((v): v is number => typeof v === 'number')
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    return [c.id, Math.round((avg / (c.max || 1)) * c.weight * 10) / 10]
  })), [rubric, judges])
  const leaderboard = (res.data?.leaderboard?.teams ?? []).map((t) => ({ rank: t.rank, team: t.teamName, track: t.track ?? '—', total: t.total, mine: t.teamId === res.data?.teamId }))
  const mine = leaderboard.find((r) => r.mine)
  const total = mine?.total ?? Object.values(myScores).reduce((a, b) => a + b, 0)
  const team = { name: teamView?.team?.name ?? 'Your team', track: teamView?.team?.track ?? '' }
  const judgeFeedback = judges.filter((j) => j.comment).map((j, i) => ({ judge: `Judge ${i + 1}`, text: j.comment! }))
  const certificates = certs.map((c) => ({ id: c.id, type: c.type === 'winner' ? `${tr("Winner")}${c.rank ? ` · ${ordinal(c.rank)} place` : ''}` : c.type === 'mentor' ? tr("Mentor") : tr("Participation"), issued: fmtDate(c.issuedAt), url: c.downloadUrl }))
  const main = certificates[0]
  const verifyUrl = (id: string) => `${location.origin}/api/public/certificates/${id}`
  const share = async () => {
    if (!main) return toast(tr("Your certificate isn’t issued yet"), { kind: 'info' })
    const data = { title: tr("My hackathon certificate"), url: verifyUrl(main.id) }
    if (navigator.share) await navigator.share(data).catch(() => undefined)
    else await navigator.clipboard.writeText(data.url).then(() => toast(tr("Link copied"), { kind: 'success' }))
  }
  const download = (url?: string) => (url ? window.open(url, '_blank', 'noopener') : toast(tr("Your certificate isn’t issued yet"), { kind: 'info' }))
  const cd = countdown(event?.endAt, now)
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Results")} subtitle={tr("Scores, feedback and certificates")} />
      {state === 'hidden' ? (
        <Card className="flex flex-col items-center gap-5 px-6 py-12 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-50 text-brand-600"><EyeOff size={28} /></span>
          <div><h2 className="text-xl font-extrabold text-ink">{tr("Results aren’t published yet")}</h2><p className="mx-auto mt-1 max-w-md text-sm text-muted">{tr("Judging is in progress. Results are announced at the closing ceremony; we’ll notify you the moment they’re live.")}</p></div>
          {!cd.passed && <Countdown parts={cd.clock.split(':').map((v, i) => [v, ['Hours', 'Minutes', 'Seconds'][i]] as [string, string])} />}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#f59e0b] via-[#f97316] to-[#ec4899] p-7 text-white shadow-card">
              <div className="pointer-events-none absolute -right-14 -top-14 h-56 w-56 rounded-full bg-white/15" />
              <Trophy size={40} className="relative" />
              <p className="relative mt-4 text-sm font-semibold text-white/85">{team.name} {tr("finished")}</p>
              <p className="relative text-5xl font-extrabold">{mine ? `${ordinal(mine.rank)} place` : '—'}</p>
              <p className="relative mt-2 text-white/90">{tr("Overall score")} <b>{total.toFixed(1)}</b> / 100{team.track ? ` · ${team.track} track` : ''}</p>
              <div className="relative mt-5 flex flex-wrap gap-3">
                <button className="keep-white inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-2.5 text-sm font-bold text-orange-600" onClick={() => download(main?.url)}><Download size={16} /> {tr("Certificate")}</button>
                <button className="inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold ring-1 ring-white/50 hover:bg-white/10" onClick={() => void share()}><Share2 size={16} /> {tr("Share")}</button>
              </div>
            </div>
            <Card className="p-6">
              <CardHeader title={tr("Your scores")} subtitle={`${tr("Average of")} ${judges.length} judge${judges.length === 1 ? '' : 's'}${tr(", weighted by the rubric")}`} />
              <ul className="mt-5 space-y-4">
                {rubric.length === 0 && <li className="text-sm text-muted">{tr("No scores for your team.")}</li>}
                {rubric.map((c) => {
                  const v = myScores[c.id]
                  return (
                    <li key={c.id}>
                      <div className="flex justify-between text-sm"><span className="font-semibold text-ink">{c.name}</span><span className="text-muted"><b className="text-ink">{v}</b> / {c.weight}</span></div>
                      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-track"><div className="h-full rounded-full bg-gradient-to-r from-[#5b5cf0] to-[#9a7bff]" style={{ width: `${(v / c.weight) * 100}%` }} /></div>
                    </li>
                  )
                })}
              </ul>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card className="overflow-hidden">
              <div className="px-6 pt-6"><CardHeader title={tr("Leaderboard")} subtitle={tr("Final ranking · all tracks")} /></div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[460px]">
                  <thead className="bg-surface-2"><tr><th className="th w-16">{tr("Rank")}</th><th className="th">{tr("Team")}</th><th className="th">{tr("Track")}</th><th className="th text-right">{tr("Score")}</th></tr></thead>
                  <tbody>
                    {leaderboard.map((r) => (
                      <tr key={r.rank} className={cn('border-t border-line', r.mine && 'bg-brand-50')}>
                        <td className="td">{r.rank <= 3 ? <Medal size={20} className={['text-amber-500', 'text-slate-400', 'text-orange-500'][r.rank - 1]} /> : <span className="pl-1 font-semibold">{r.rank}</span>}</td>
                        <td className="td font-semibold text-ink">{r.team} {r.mine && <Pill tone="indigo" className="ml-1">{tr("You")}</Pill>}</td>
                        <td className="td">{r.track}</td>
                        <td className="td text-right font-bold text-ink">{r.total.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <div className="space-y-5">
              <Card className="p-6">
                <CardHeader title={tr("Judge feedback")} />
                <ul className="mt-4 space-y-3">
                  {judgeFeedback.length === 0 && <li className="text-sm text-muted">{tr("No written feedback.")}</li>}
                  {judgeFeedback.map((f) => (
                    <li key={f.judge} className="rounded-2xl bg-surface-2 p-4"><MessageSquareQuote size={18} className="text-brand-400" /><p className="mt-2 text-sm leading-relaxed text-ink-2">{f.text}</p><p className="mt-2 text-xs font-semibold text-muted">{f.judge}</p></li>
                  ))}
                </ul>
              </Card>
              <Card className="p-6">
                <CardHeader title={tr("Certificates")} subtitle={tr("Anyone can verify them with the ID")} />
                <ul className="mt-4 space-y-2.5">
                  {certificates.length === 0 && <li className="text-sm text-muted">{tr("Certificates are issued after results.")}</li>}
                  {certificates.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 rounded-2xl border border-line p-3.5">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600"><Award size={19} /></span>
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{c.type}</p><p className="truncate font-mono text-xs text-muted">{c.id}</p></div>
                      <button aria-label={tr("Copy verification link")} className="rounded-lg p-2 text-muted hover:bg-brand-50 hover:text-brand-600" onClick={() => void navigator.clipboard.writeText(verifyUrl(c.id)).then(() => toast(tr("Verification link copied"), { kind: 'success' }))}><ShieldCheck size={16} /></button>
                      <button aria-label={tr("Download certificate")} className="rounded-lg p-2 text-muted hover:bg-brand-50 hover:text-brand-600" onClick={() => download(c.url)}><Download size={16} /></button>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
