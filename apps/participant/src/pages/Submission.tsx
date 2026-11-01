import { useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, Clock, Download, FileText, Lock, MessageCircle, Receipt, UploadCloud, Video, X } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '../components/ui/Card'
import { GithubIcon, KV, Progress } from '../components/ui/Misc'
import { Pill } from '../components/ui/Badge'
import { Field, Input, Textarea } from '../components/ui/Form'
import { Countdown, InfoNote } from '../components/ui/Preview'
import { Modal } from '../components/ui/Overlay'
import { useSubmission, useTeam } from '../lib/live'
import { useAct, useNow } from '../lib/data'
import { countdown, fmtDT } from '../lib/format'
import { errorText, uploadFile } from '../lib/api'
import { toast } from '../lib/toast'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

type Version = { version: number; submittedAt: string; receiptId: string; files: string; note: string }
const fileName = (u?: string | null) => (u ? decodeURIComponent(u.split('/').pop() ?? '') : '—')

/** PPT/PDF upload, video + repo links, versions, receipt, deadline lock (plan S11, M16). */
export default function Submission() {
  const { data: sub, isLoading } = useSubmission()
  const { data: teamView } = useTeam()
  const team = { name: teamView?.team?.name ?? 'Your team', repoUrl: teamView?.team?.repoUrl ?? '' }
  const now = useNow(30_000)
  const { run, busy } = useAct()
  const cur = sub?.current
  const [video, setVideo] = useState('')
  const [repo, setRepo] = useState('')
  const [desc, setDesc] = useState('')
  const [pptUrl, setPptUrl] = useState('')
  const [upload, setUpload] = useState<{ name: string; size: number; pct: number } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Fill the form from the latest version once it loads (adjusted during render, not in an effect).
  const source = cur ? `v${cur.version}` : team.repoUrl ? `repo:${team.repoUrl}` : ''
  const [filled, setFilled] = useState('')
  if (source && filled !== source) {
    setFilled(source)
    if (cur) { setVideo(cur.videoUrl ?? ''); setRepo(cur.repoUrl ?? ''); setDesc(cur.description ?? ''); setPptUrl(cur.pptUrl ?? '') }
    else setRepo((x) => x || team.repoUrl)
  }
  const [receipt, setReceipt] = useState<Version | null>(null)
  const locked = Boolean(sub?.locked)
  const versions: Version[] = (sub?.versions ?? []).map((v) => {
    const full = v as typeof v & { pptUrl?: string | null; description?: string | null }
    return { version: v.version, receiptId: v.receiptId, submittedAt: fmtDT(v.submittedAt), files: fileName(full.pptUrl), note: full.description || `Version ${v.version}` }
  })
  const cd = countdown(sub?.deadline, now)
  const videoOk = /^https:\/\/(www\.)?(youtube\.com|youtu\.be|drive\.google\.com)\//.test(video)
  const repoOk = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(repo)
  const pick = async (f?: File) => {
    if (!f) return
    abort.current = new AbortController()
    setUpload({ name: f.name, size: f.size, pct: 0 })
    try {
      const u = await uploadFile('submissions', f, (pct) => setUpload({ name: f.name, size: f.size, pct }), abort.current.signal)
      setPptUrl(u)
      toast(tr("Deck uploaded"), { kind: 'success' })
    } catch (e) {
      toast(errorText(e), { kind: 'error' })
    } finally {
      setUpload(null)
    }
  }
  const submit = () => {
    if (!pptUrl) return toast(tr("Upload your presentation first"), { kind: 'error' })
    if (!repoOk) return toast(tr("Enter your GitHub repository URL (https://github.com/team/project)"), { kind: 'error' })
    void run<{ receiptId: string; version: number }>('POST', '/submissions', { pptUrl, videoUrl: video.trim(), repoUrl: repo.trim().replace(/\/$/, ''), description: desc.trim() || undefined }, (x) => `Version ${x.version} received · receipt ${x.receiptId.slice(0, 8)}`)
  }
  const downloadReceipt = (v: Version) => {
    const text = `Submission receipt\n\nReceipt ID: ${v.receiptId}\nTeam: ${team.name}\nVersion: v${v.version}\nServer time: ${v.submittedAt}\nFile: ${v.files}\n`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    a.download = `receipt-v${v.version}-${v.receiptId.slice(0, 8)}.txt`
    a.click()
  }
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Submission")} subtitle={`${team.name} ${tr("· every submit saves a new version with a receipt")}`} />
      {!isLoading && !sub?.teamId && <InfoNote tone="amber">{tr("Join or create a team first. Submissions are per team.")}</InfoNote>}

      {locked ? (
        <div className="flex flex-col gap-4 rounded-[22px] border border-line bg-white/80 p-5 shadow-card sm:flex-row sm:items-center">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-600"><Lock size={22} /></span>
          <div className="flex-1"><p className="font-bold text-ink">{tr("Submissions closed on")} {fmtDT(sub?.deadline)} {tr("(server time)")}</p><p className="text-sm text-muted">{cur ? `${tr("Your last version (v")}${cur.version}, ${fmtDT(cur.submittedAt)}${tr(") is what judges see.")}` : tr("Nothing was submitted.")} {tr("Changes are no longer accepted.")}</p></div>
          {cur ? <Pill tone="green">v{cur.version} {tr("submitted on time")}</Pill> : <Pill tone="rose">{tr("Not submitted")}</Pill>}
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-[22px] bg-gradient-to-r from-[#ffe9ee] to-[#fff4e1] p-5 sm:flex-row sm:items-center dark:from-rose-50 dark:to-amber-50">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-rose-500 text-white"><Clock size={22} /></span>
          <div className="flex-1"><p className="font-bold text-ink">{tr("Deadline:")} {fmtDT(sub?.deadline)} {tr("(server time)")}</p><p className="text-sm text-muted">{tr("We use the server’s clock, not your phone’s. Late submissions are rejected.")}</p></div>
          <Countdown size="sm" tone="rose" parts={[[cd.days.padStart(2, '0'), tr("Days")], [cd.hours.padStart(2, '0'), tr("Hours")], [cd.minutes.padStart(2, '0'), tr("Mins")]]} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card className={cn('p-6', locked && 'opacity-70')}>
          <CardHeader title={locked ? tr("Final submission") : `${tr("Submit version")} ${versions.length + 1}`} subtitle={tr("All three fields are checked before saving")} />
          <fieldset disabled={locked || !sub?.teamId} className="mt-5 space-y-5">
            <div>
              <p className="label">{tr("Presentation (PPT or PDF, up to 20 MB)")}</p>
              <input ref={fileRef} type="file" accept=".ppt,.pptx,.pdf" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
              <button type="button" onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files[0]) }} className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/50 px-6 py-8 text-center transition hover:border-brand-400 disabled:cursor-not-allowed">
                <UploadCloud size={30} className="text-brand-500" />
                <p className="mt-2 text-sm font-semibold text-ink">{tr("Drop your file here or")} <span className="text-brand-600">{tr("browse")}</span></p>
                <p className="text-xs text-muted">{tr(".pptx, .ppt or .pdf")}</p>
              </button>
              {upload && (
                <div className="mt-3 flex items-center gap-3 rounded-2xl border border-line p-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600"><FileText size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between text-sm"><span className="truncate font-semibold text-ink">{upload.name}</span><span className="text-muted">{upload.pct}%</span></div>
                    <Progress value={upload.pct} className="mt-1.5" />
                    <p className="mt-1 text-xs text-muted">{((upload.size * upload.pct) / 100 / 1_048_576).toFixed(1)} {tr("of")} {(upload.size / 1_048_576).toFixed(1)} {tr("MB · uploading")}</p>
                  </div>
                  <button type="button" aria-label={tr("Cancel upload")} className="rounded-lg p-1.5 text-faint hover:bg-rose-50 hover:text-rose-600" onClick={() => abort.current?.abort()}><X size={16} /></button>
                </div>
              )}
              {!upload && pptUrl && (
                <div className="mt-3 flex items-center gap-3 rounded-2xl border border-line p-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600"><FileText size={18} /></span>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{fileName(pptUrl)}</p><p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={12} /> {tr("Uploaded")}</p></div>
                </div>
              )}
            </div>
            <Field label={tr("Demo video link")} hint={video && !videoOk ? <span className="flex items-center gap-1 text-rose-600"><CircleAlert size={13} /> {tr("Use a YouTube (unlisted is fine) or Google Drive link.")}</span> : video ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 size={13} /> {tr("Looks good: YouTube link")}</span> : tr("YouTube (unlisted) or Google Drive, max 3 minutes")}>
              <Input icon={<Video size={16} />} value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://youtu.be/…" className={video && !videoOk ? 'border-rose-300' : ''} />
            </Field>
            <Field label={tr("GitHub repository")} hint={tr("Must be public until judging ends. Judges see commit history from all team members.")}>
              <Input icon={<GithubIcon size={16} />} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/team/project" className={repo && !repoOk ? 'border-rose-300' : ''} />
            </Field>
            <Field label={tr("Short description (optional)")}><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={tr("One or two lines about what you built")} /></Field>
          </fieldset>
          {!locked && <div className="mt-6 flex flex-wrap items-center justify-end gap-3"><span className="text-xs text-muted">{tr("You can submit again until the deadline.")}</span><button className="btn-primary" disabled={!videoOk || !pptUrl || !!upload || busy || !sub?.teamId} onClick={submit}>{tr("Submit version")} {versions.length + 1}</button></div>}
        </Card>

        <div className="space-y-5">
          <Card className="p-6">
            <CardHeader title={tr("Version history")} subtitle={tr("Server time · newest first")} />
            {versions.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-line px-4 py-8 text-center"><p className="font-semibold text-ink">{tr("No versions yet")}</p><p className="mt-1 text-sm text-muted">{tr("Your first submit creates version 1 and a receipt.")}</p></div>
            ) : (
              <ol className="mt-4 space-y-2.5">
                {versions.map((v, i) => (
                  <li key={v.version} className={cn('flex items-center gap-3 rounded-2xl p-3.5', i === 0 ? 'bg-brand-50 ring-1 ring-brand-200' : 'bg-surface-2')}>
                    <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-extrabold', i === 0 ? 'bg-brand-500 text-white' : 'bg-white text-ink-2')}>v{v.version}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{v.note}</p><p className="truncate text-xs text-muted">{v.submittedAt} · {v.files}</p></div>
                    <button className="btn-ghost shrink-0 px-2 text-xs" onClick={() => setReceipt(v)}><Receipt size={14} /> {tr("Receipt")}</button>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <InfoNote icon={<MessageCircle size={15} />}>{tr("Every receipt is also sent to your team on WhatsApp.")}</InfoNote>
        </div>
      </div>

      <Modal open={!!receipt} onClose={() => setReceipt(null)} title={tr("Submission receipt")} subtitle={tr("Keep this as proof of an on-time submission")} width="max-w-md" footer={<><button className="btn-secondary" onClick={() => receipt && downloadReceipt(receipt)}><Download size={15} /> {tr("Download")}</button><button className="btn-primary" onClick={() => setReceipt(null)}>{tr("Done")}</button></>}>
        {receipt && (
          <div>
            <div className="flex flex-col items-center rounded-2xl bg-emerald-50 p-5 text-center"><CheckCircle2 size={34} className="text-emerald-600" /><p className="mt-2 font-bold text-emerald-700">{tr("Received on time")}</p></div>
            <div className="mt-4 divide-y divide-line">
              <KV k="Receipt ID" v={<span className="font-mono">{receipt.receiptId}</span>} />
              <KV k="Team" v={team.name} />
              <KV k="Version" v={`v${receipt.version}`} />
              <KV k="Server time" v={receipt.submittedAt} />
              <KV k="File" v={receipt.files} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
