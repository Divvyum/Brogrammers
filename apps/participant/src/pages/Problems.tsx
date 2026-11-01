import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bookmark, Lock, Sparkles } from 'lucide-react'
import { Card, PageHeader } from '../components/ui/Card'
import { Pill } from '../components/ui/Badge'
import { Countdown } from '../components/ui/Preview'
import { Modal } from '../components/ui/Overlay'
import { useConfig } from '../config'
import { useEventInfo, useNow, useP } from '../lib/data'
import { countdown, fmtDT } from '../lib/format'
import { api, errorText } from '../lib/api'
import { toast } from '../lib/toast'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

/** Problem statements: locked with a countdown, revealed when released (plan S8). */
type Problem = { id: string; track: string; title: string; body: string; released: boolean; releaseAt: string; releaseIn?: string }

function download(p: Problem) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([`${p.title}\n${p.track} · released ${p.releaseAt}\n\n${p.body}\n`], { type: 'text/plain' }))
  a.download = `${p.title.replace(/\W+/g, '-')}.txt`
  a.click()
}

export default function Problems() {
  const config = useConfig()
  const qc = useQueryClient()
  const now = useNow(60_000)
  const { data: event } = useEventInfo()
  const { data: raw = [], isLoading } = useP<Array<{ id: string; track: string; title: string; body: string; releaseAt: string }>>('/problems')
  const [open, setOpen] = useState<Problem | null>(null)
  const list: Problem[] = raw.map((p) => ({ ...p, released: true, releaseAt: fmtDT(p.releaseAt) }))
  const state: 'released' | 'locked' = list.length || isLoading ? 'released' : 'locked'
  const unlockAt = event?.rounds[0]?.startAt ?? event?.startAt
  const cd = countdown(unlockAt, now)
  const tracks = Array.from(new Set(list.map((p) => p.track)))
  const choose = async (p: Problem) => {
    try {
      await api('/progress', { body: { text: `We chose the problem “${p.title}” (${p.track}).` } })
      await qc.invalidateQueries({ queryKey: ['/progress'] })
      toast(tr("Shared with your team"), { description: tr("Posted as a progress update on Event Day."), kind: 'success' })
      setOpen(null)
    } catch (e) {
      toast(errorText(e), { kind: 'error' })
    }
  }
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Problem Statements")} subtitle={tr("Each track’s problems unlock at their release time")} />
      {state === 'locked' && (
        <Card className="flex flex-col items-center gap-4 p-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600"><Lock size={26} /></span>
          <div><h2 className="text-xl font-extrabold text-ink">{cd.passed ? tr("Problems unlock soon") : `${tr("Problems unlock on")} ${fmtDT(unlockAt)}`}</h2><p className="text-sm text-muted">{tr("You’ll get a notification the moment your track is released.")}</p></div>
          <Countdown parts={[[cd.days, tr("Days")], [cd.hours, tr("Hours")], [cd.minutes, tr("Minutes")]]} />
        </Card>
      )}
      {tracks.map((t) => (
        <section key={t}>
          <div className="mb-3 flex items-center gap-2"><h2 className="text-lg font-bold text-ink">{t}</h2>{t === config.track && <Pill tone="violet">{tr("Your track")}</Pill>}</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {list.filter((p) => p.track === t).map((p) => p.released ? (
              <button key={p.id} onClick={() => setOpen(p)} className="card p-5 text-left transition hover:-translate-y-0.5">
                <div className="flex items-center justify-between"><Pill tone="green">{tr("Released ·")} {p.releaseAt}</Pill><Sparkles size={17} className="text-violet-500" /></div>
                <h3 className="mt-3 text-base font-bold text-ink">{p.title}</h3>
                <p className="mt-1 line-clamp-3 text-sm text-muted">{p.body}</p>
                <p className="mt-3 text-sm font-semibold text-brand-600">{tr("Read full statement →")}</p>
              </button>
            ) : (
              <div key={p.id} className={cn('card relative overflow-hidden p-5')}>
                <div className="flex items-center justify-between"><Pill tone="slate">{tr("Locked")}</Pill><Lock size={16} className="text-faint" /></div>
                <div className="mt-3 space-y-2" aria-hidden><div className="h-4 w-2/3 rounded bg-track" /><div className="h-3 w-full rounded bg-track" /><div className="h-3 w-5/6 rounded bg-track" /></div>
                <p className="mt-4 text-sm text-muted">{tr("Unlocks in")} <b className="text-ink">{p.releaseIn}</b> · {p.releaseAt}</p>
              </div>
            ))}
          </div>
        </section>
      ))}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title} subtitle={open && `${open.track} ${tr("· released")} ${open.releaseAt}`} width="max-w-2xl" footer={<><button className="btn-secondary" onClick={() => open && download(open)}>{tr("Download")}</button><button className="btn-primary" onClick={() => open && void choose(open)}><Bookmark size={16} /> {tr("Choose for my team")}</button></>}>
        <p className="text-[15px] leading-relaxed text-ink-2">{open?.body}</p>
        <h4 className="mt-5 text-sm font-bold text-ink">{tr("What judges look for")}</h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted"><li>{tr("A working demo, not just slides")}</li><li>{tr("Works for real users with limited internet")}</li><li>{tr("Clear plan for data and privacy")}</li></ul>
      </Modal>
    </div>
  )
}
