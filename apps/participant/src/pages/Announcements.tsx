import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BellRing, CheckCheck, Megaphone, Pin, Siren, X } from 'lucide-react'
import { Card, PageHeader } from '../components/ui/Card'
import { Tabs } from '../components/ui/Tabs'
import { EmptyState } from '../components/ui/Misc'
import { Pill } from '../components/ui/Badge'
import { useFeed } from '../lib/live'
import { api, errorText } from '../lib/api'
import { enablePush, pushState, topicsFor } from '../lib/push'
import { useSession } from '../lib/session'
import { toast } from '../lib/toast'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

/** Feed with pinned + emergency styles; opening an item marks it seen (plan S8, M13). */
export default function Announcements() {
  const qc = useQueryClient()
  const { me } = useSession()
  const { items, isLoading } = useFeed()
  const [filter, setFilter] = useState<'all' | 'unread' | 'emergency'>('all')
  const [push, setPush] = useState(() => pushState() === 'default')
  const list = items.filter((a) => filter === 'all' || (filter === 'unread' ? !a.seen : a.emergency))
  const unread = items.filter((a) => !a.seen).length
  const markSeen = async (ids: string[]) => {
    await Promise.all(ids.map((id) => api(`/announcements/${id}/seen`, { body: {} }).catch(() => undefined)))
    await qc.invalidateQueries({ queryKey: ['/feed'] })
  }
  const seen = (id: string) => { if (items.find((a) => a.id === id && !a.seen)) void markSeen([id]) }
  const allow = () => enablePush(topicsFor(me?.registration)).then(() => { setPush(false); toast(tr("Notifications are on"), { kind: 'success' }) }, (e) => toast(errorText(e), { kind: 'error' }))
  const sorted = [...list].sort((a, b) => Number(!!b.emergency) - Number(!!a.emergency) || Number(!!b.pinned) - Number(!!a.pinned))
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Announcements")} subtitle={tr("Updates from the organizers. Urgent ones also arrive on WhatsApp.")} actions={<button className="btn-secondary" disabled={!unread} onClick={() => void markSeen(items.filter((a) => !a.seen).map((a) => a.id))}><CheckCheck size={16} /> {tr("Mark all as seen")}</button>} />

      {push && (
        <div className="anim-fade flex flex-col gap-4 rounded-[22px] border border-brand-200 bg-gradient-to-r from-brand-50 to-violet-50 p-5 sm:flex-row sm:items-center">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-500 text-white"><BellRing size={22} /></span>
          <div className="flex-1"><p className="font-bold text-ink">{tr("Turn on notifications")}</p><p className="text-sm text-muted">{tr("Get room changes and emergency alerts even when the app is closed.")}</p></div>
          <div className="flex gap-2"><button className="btn-primary" onClick={() => void allow()}>{tr("Allow notifications")}</button><button aria-label={tr("Dismiss")} className="btn-ghost px-2" onClick={() => setPush(false)}><X size={17} /></button></div>
        </div>
      )}

      <Tabs value={filter} onChange={setFilter} tabs={[{ id: 'all', label: tr("All"), count: items.length }, { id: 'unread', label: tr("Unread"), count: unread }, { id: 'emergency', label: tr("Emergency"), count: items.filter((a) => a.emergency).length }]} />

      {sorted.length === 0 ? (
        <Card><EmptyState icon={<CheckCheck size={28} />} title={isLoading ? tr("Loading…") : tr("You’re all caught up")} description={tr("New announcements will show up here.")} /></Card>
      ) : (
        <div className="space-y-3">
          {sorted.map((a) => (
            <button key={a.id} onClick={() => seen(a.id)} className={cn('card block w-full p-5 text-left transition hover:-translate-y-0.5', a.emergency && 'border-rose-200! bg-rose-50 ring-2 ring-rose-300', a.pinned && !a.emergency && 'ring-1 ring-brand-200')}>
              <div className="flex items-start gap-4">
                <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', a.emergency ? 'bg-rose-500 text-white' : 'bg-brand-50 text-brand-600')}>{a.emergency ? <Siren size={20} /> : <Megaphone size={20} />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.emergency && <Pill tone="rose">{tr("Emergency")}</Pill>}
                    {a.pinned && <Pill tone="indigo"><Pin size={11} /> {tr("Pinned")}</Pill>}
                    <h3 className={cn('text-base font-bold', a.emergency ? 'text-rose-700' : 'text-ink')}>{a.title}</h3>
                    {!a.seen && <span className="h-2 w-2 rounded-full bg-brand-500" aria-label={tr("Unread")} />}
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{a.body}</p>
                  <p className="mt-2 text-xs text-faint">{a.time} · {a.audience} {a.seen && tr("· Seen")}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
