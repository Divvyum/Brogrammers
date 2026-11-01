import { useRef, useState } from 'react'
import { AlertTriangle, Check, CircleDollarSign, Gift, Paperclip, PackageCheck } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '../components/ui/Card'
import { Tabs } from '../components/ui/Tabs'
import { Pill } from '../components/ui/Badge'
import { IconTile } from '../components/ui/IconTile'
import { Field, Select, Textarea } from '../components/ui/Form'
import { InfoNote } from '../components/ui/Preview'
import { EmptyState } from '../components/ui/Misc'
import { useAct, useP } from '../lib/data'
import { useSession } from '../lib/session'
import { errorText, uploadFile } from '../lib/api'
import { fmtDT, fmtDate } from '../lib/format'
import { toast } from '../lib/toast'
import { useUI } from '../context/UIContext'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

const rewardSteps = ['announced', 'verified', 'processing', 'delivered'] as const
const stepLabel: Record<string, string> = { announced: 'Announced', verified: 'Verified', processing: 'Processing', delivered: 'Delivered', disputed: 'Disputed' }
type RewardRow = { id: string; prize: string; type: string; sponsor?: string; status: string; dueAt: string; overdue?: boolean; confirmedAt?: string; history: { at: string; by: string; status: string; note?: string }[] }
type ComplaintRow = { id: string; rewardId?: string; text: string; status: string; deadline: string; history: { at: string; by: string; note: string }[]; evidenceUrls: string[] }

function Pipeline({ status }: { status: string }) {
  const idx = rewardSteps.indexOf(status as (typeof rewardSteps)[number])
  return (
    <ol className="flex">
      {rewardSteps.map((s, i) => (
        <li key={s} className="relative flex flex-1 flex-col items-center text-center">
          {i > 0 && <span className={cn('absolute right-1/2 top-[13px] h-[3px] w-full', i <= idx ? 'bg-emerald-500' : 'bg-track')} />}
          <span className={cn('relative z-10 grid h-7 w-7 place-items-center rounded-full text-xs font-bold', i < idx || (i === idx && s === 'delivered') ? 'bg-emerald-500 text-white' : i === idx ? 'bg-brand-500 text-white ring-4 ring-brand-100' : 'bg-track text-faint')}>{i < idx || s === 'delivered' && i === idx ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
          <span className={cn('mt-2 text-xs font-semibold', i <= idx ? 'text-ink' : 'text-faint')}>{stepLabel[s]}</span>
        </li>
      ))}
    </ol>
  )
}

/** RewardLink tracker + confirm receipt, complaints with evidence (plan S13, M18). */
export default function Rewards() {
  const { confirm } = useUI()
  const { me } = useSession()
  const { run, busy } = useAct()
  const [tab, setTab] = useState<'rewards' | 'complaints'>('rewards')
  const { data: rawRewards = [], isLoading } = useP<RewardRow[]>('/rewards')
  const { data: rawComplaints = [] } = useP<ComplaintRow[]>('/complaints')
  const rewards = rawRewards.map((r) => ({ ...r, sponsor: r.sponsor ?? 'Organizers', dueAt: fmtDate(r.dueAt), history: r.history.map((h) => ({ ...h, at: fmtDT(h.at) })) }))
  const complaints = rawComplaints.map((c) => ({ ...c, reward: rawRewards.find((r) => r.id === c.rewardId)?.prize ?? 'General', deadline: fmtDate(c.deadline), history: c.history.map((h) => ({ at: fmtDT(h.at), by: h.by === me?.uid ? 'You' : 'Organizer', note: h.note })) }))
  const [about, setAbout] = useState('')
  const [text, setText] = useState('')
  const [evidence, setEvidence] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const attach = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      const urls = await Promise.all([...files].slice(0, 10 - evidence.length).map((f) => uploadFile('complaint-evidence', f)))
      setEvidence([...evidence, ...urls])
    } catch (e) {
      toast(errorText(e), { kind: 'error' })
    } finally {
      setUploading(false)
    }
  }
  const fileComplaint = async () => {
    if (text.trim().length < 3) return toast(tr("Describe what went wrong"), { kind: 'error' })
    if (await run('POST', '/complaints', { rewardId: about || undefined, text: text.trim(), evidenceUrls: evidence }, tr("Complaint filed. Organizers have 3 days to respond."))) { setText(''); setEvidence([]) }
  }
  const reply = (id: string) => {
    const note = window.prompt('Your reply to the organizers')?.trim()
    if (note) void run('POST', `/complaints/${id}/reply`, { note }, tr("Reply sent"))
  }
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Rewards")} subtitle={tr("Track your prizes until they reach you")} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'rewards', label: tr("My rewards"), count: rewards.length }, { id: 'complaints', label: tr("Complaints"), count: complaints.length }]} />
      {tab === 'rewards' && rewards.length === 0 ? (
        <Card><EmptyState icon={<Gift size={28} />} title={isLoading ? tr("Loading…") : tr("No rewards yet")} description={tr("If your team wins a prize, you can track it here until it reaches you.")} /></Card>
      ) : tab === 'rewards' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {rewards.map((r) => (
            <Card key={r.id} className="p-6">
              <div className="flex items-start gap-4">
                <IconTile icon={r.type.startsWith('Cash') ? CircleDollarSign : Gift} tone={r.status === 'delivered' ? 'green' : 'amber'} />
                <div className="min-w-0 flex-1"><p className="text-lg font-bold text-ink">{r.prize}</p><p className="text-sm text-muted">{r.type} · {r.sponsor}</p></div>
                <Pill tone={r.status === 'delivered' ? 'green' : r.status === 'disputed' || r.overdue ? 'rose' : 'indigo'}>{r.overdue && r.status !== 'delivered' ? tr("Overdue") : stepLabel[r.status]}</Pill>
              </div>
              <div className="mt-6"><Pipeline status={r.status} /></div>
              <ol className="mt-6 space-y-3 border-l-2 border-track pl-4">
                {[...r.history].reverse().map((h, i) => (
                  <li key={i} className="relative"><span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-400" /><p className="text-sm font-semibold text-ink">{stepLabel[h.status]} <span className="font-normal text-muted">· {h.at}</span></p>{h.note && <p className="text-xs text-muted">{h.note}</p>}</li>
                ))}
              </ol>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <span className="text-xs text-muted">{tr("Due by")} {r.dueAt}</span>
                {r.status === 'delivered' && r.confirmedAt
                  ? <Pill tone="green"><Check size={11} /> {tr("Receipt confirmed")}</Pill>
                  : r.status === 'delivered'
                  ? <button className="btn-primary" onClick={() => confirm({ title: tr("Confirm you received it?"), message: tr("This closes the reward. Only confirm once it has actually reached you."), confirmLabel: tr("Yes, I received it"), onConfirm: () => void run('POST', `/rewards/${r.id}/confirm`, {}, tr("Thanks for confirming!")) })}><PackageCheck size={16} /> {tr("I received it")}</button>
                  : <button className="btn-secondary" onClick={() => { setAbout(r.id); setTab('complaints') }}><AlertTriangle size={15} /> {tr("Report a problem")}</button>}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card className="p-6">
            <CardHeader title={tr("File a complaint")} subtitle={tr("Organizers must respond by the deadline or it’s escalated")} />
            <div className="mt-4 space-y-4">
              <Field label={tr("About")}><Select value={about} onChange={(e) => setAbout(e.target.value)}>{rewards.map((r) => <option key={r.id} value={r.id}>{r.prize}</option>)}<option value="">{tr("Something else")}</option></Select></Field>
              <Field label={tr("What went wrong?")}><Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={tr("Describe the problem and when it started")} /></Field>
              <div>
                <p className="label">{tr("Evidence")}</p>
                <button className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line px-4 py-5 text-sm font-semibold text-muted hover:border-brand-300 hover:text-brand-600" disabled={uploading} onClick={() => fileRef.current?.click()}><Paperclip size={16} /> {uploading ? tr("Uploading…") : evidence.length ? `${evidence.length} file${evidence.length > 1 ? 's' : ''} ${tr("attached · add more")}` : tr("Attach screenshots or documents")}</button>
                <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" hidden onChange={(e) => { void attach(e.target.files); e.target.value = '' }} />
              </div>
              <button disabled={busy || uploading} className="btn-primary w-full" onClick={() => void fileComplaint()}>{tr("Submit complaint")}</button>
            </div>
          </Card>
          <Card className="p-6">
            <CardHeader title={tr("My complaints")} />
            {complaints.length === 0 && <p className="mt-4 text-sm text-muted">{tr("No complaints filed.")}</p>}
            {complaints.map((c) => (
              <div key={c.id} className="mt-4 rounded-2xl border border-line p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-ink">{c.reward}</p><p className="font-mono text-xs text-muted">{c.id}</p></div><Pill tone={c.status === 'resolved' ? 'green' : c.status === 'escalated' ? 'rose' : c.status === 'responded' ? 'indigo' : 'amber'}>{c.status[0].toUpperCase() + c.status.slice(1)}</Pill></div>
                <p className="mt-2 text-sm text-ink-2">{c.text}</p>
                <ol className="mt-4 space-y-3 border-l-2 border-track pl-4">
                  {c.history.map((h, i) => <li key={i} className="relative"><span className={cn('absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full', h.by === 'Organizer' ? 'bg-emerald-500' : 'bg-brand-400')} /><p className="text-xs font-semibold text-ink">{h.by} · <span className="font-normal text-muted">{h.at}</span></p><p className="text-sm text-ink-2">{h.note}</p></li>)}
                </ol>
                {c.status !== 'resolved' && <>
                <div className="mt-4"><InfoNote tone="amber">{tr("Response deadline")} {c.deadline}{tr(". If it isn’t resolved by then, it’s escalated automatically.")}</InfoNote></div>
                <div className="mt-3 flex justify-end gap-2"><button className="btn-ghost text-xs" onClick={() => reply(c.id)}>{tr("Reply")}</button><button className="btn-secondary px-4 py-2 text-xs" onClick={() => void run('POST', `/complaints/${c.id}/resolve`, {}, tr("Marked resolved"))}>{tr("Mark resolved")}</button></div></>}
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  )
}
