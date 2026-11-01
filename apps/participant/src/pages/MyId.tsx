import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import QrScanner from 'qr-scanner'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Camera, Check, CheckCircle2, Eye, EyeOff, KeyRound, Lock, Plane, QrCode, RefreshCw, ScanLine, ShieldAlert, ShieldCheck, Smartphone, Sun, UtensilsCrossed, WifiOff, X } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '../components/ui/Card'
import { Avatar, EmptyState, KV, QR } from '../components/ui/Misc'
import { Pill } from '../components/ui/Badge'
import { IconTile } from '../components/ui/IconTile'
import { InfoNote } from '../components/ui/Preview'
import { useConfig } from '../config'
import { useSession } from '../lib/session'
import { useAct } from '../lib/data'
import { seatNo, slotView, useRoom, useSlots, useTeam } from '../lib/live'
import { fmtDT } from '../lib/format'
import { errorText } from '../lib/api'
import { toast } from '../lib/toast'
import { enrollId, loadId, respondToChallenge } from '../device-id'
import { useUI } from '../context/UIContext'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

type State = 'enrolled' | 'not_enrolled' | 'revoked'

/** Full-screen two-QR check-in (plan S7): scan challenge → sign → show response QR (auto-closes after 60 s). */
function useIdCard() {
  const config = useConfig()
  const { data: teamView } = useTeam()
  const { data: room } = useRoom()
  return { config, team: { name: teamView?.team?.name ?? '—' }, room: { name: room?.name ?? '—', seat: seatNo(room?.seat) } }
}

function CheckInFlow({ onClose }: { onClose: () => void }) {
  const { config, team, room } = useIdCard()
  const [step, setStep] = useState<'scan' | 'signing' | 'show'>('scan')
  const [response, setResponse] = useState('')
  const [left, setLeft] = useState(60)
  const [camError, setCamError] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (step !== 'scan' || !video.current) return
    const scanner = new QrScanner(video.current, (res) => {
      scanner.stop()
      setStep('signing')
      respondToChallenge(res.data).then((r) => { setResponse(r); setLeft(60); setStep('show') }, (e) => { toast(errorText(e), { kind: 'error' }); setStep('scan') })
    }, { preferredCamera: 'environment', highlightScanRegion: false, returnDetailedScanResult: true })
    scanner.start().catch(() => setCamError('Allow camera access in your browser settings, then try again.'))
    return () => { scanner.stop(); scanner.destroy() }
  }, [step])
  useEffect(() => {
    if (step !== 'show') return
    const t = window.setInterval(() => setLeft((x) => { if (x <= 1) { onClose(); return 0 } return x - 1 }), 1000)
    return () => window.clearInterval(t)
  }, [step, onClose])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return createPortal(
    <div className={cn('anim-fade fixed inset-0 z-[55] flex flex-col', step === 'show' ? 'keep-white bg-white text-[#141a46]' : 'bg-[#0b0e22] text-white')} role="dialog" aria-modal aria-label={tr("Check-in")}>
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm font-bold">{step === 'show' ? tr("Step 2 of 2 · Show this to the volunteer") : tr("Step 1 of 2 · Scan the volunteer’s QR")}</p>
        <button onClick={onClose} className={cn('rounded-full p-2', step === 'show' ? 'hover:bg-[#eef0fa]' : 'hover:bg-white/10')} aria-label={tr("Close check-in")}><X size={20} /></button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
        {step === 'scan' && (
          <>
            <div className="relative aspect-square w-full max-w-[340px] overflow-hidden rounded-[28px] bg-gradient-to-br from-[#1d2250] to-[#0f1230]">
              <video ref={video} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
              <div className="absolute inset-8 rounded-2xl border-2 border-white/30" />
              {[['left-6 top-6', 'border-l-4 border-t-4'], ['right-6 top-6', 'border-r-4 border-t-4'], ['left-6 bottom-6', 'border-b-4 border-l-4'], ['right-6 bottom-6', 'border-b-4 border-r-4']].map(([p, b]) => <span key={p} className={cn('absolute h-10 w-10 rounded-md border-[#8f95ff]', p, b)} />)}
              <div className="absolute inset-x-10 top-1/2 h-0.5 bg-[#8f95ff] shadow-[0_0_18px_4px_rgba(143,149,255,.6)]" />
              {camError && <Camera size={34} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/30" />}
            </div>
            <p className="mt-6 max-w-sm text-white/80">{tr("Point your camera at the")} <b className="text-white">{tr("challenge QR")}</b> {tr("on the volunteer’s phone. Works without internet.")}</p>
            {camError && <p className="mt-3 max-w-sm text-sm text-amber-300">{camError}</p>}
            <button className="mt-3 text-sm font-semibold text-white/70 underline" onClick={() => toast(tr("Camera not working?"), { description: tr("Allow camera access for this site, or tell the volunteer your backup code."), kind: 'info', duration: 8000 })}>{tr("Camera not working?")}</button>
          </>
        )}
        {step === 'signing' && (
          <>
            <div className="grid h-20 w-20 place-items-center rounded-full bg-white/10"><KeyRound size={34} className="animate-pulse" /></div>
            <p className="mt-5 text-lg font-bold">{tr("Signing with your device key…")}</p>
            <p className="mt-1 text-sm text-white/70">{tr("Your private key never leaves this phone.")}</p>
          </>
        )}
        {step === 'show' && (
          <>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-amber-600"><Sun size={14} /> {tr("Brightness turned up")}</p>
            <div className="rounded-[28px] p-4 shadow-[0_20px_60px_-20px_rgba(20,26,70,.35)] ring-1 ring-[#e7e9f6]"><QR value={response} size={270} /></div>
            <p className="mt-5 text-2xl font-extrabold">{config.studentName}</p>
            <p className="text-sm text-[#6a7096]">{team.name} {tr("· Room")} {room.name} {tr("· Seat")} {room.seat}</p>
            <p className="mt-4 rounded-full bg-[#eef0fa] px-4 py-1.5 text-sm font-semibold">{tr("Closes automatically in")} <b>0:{String(left).padStart(2, '0')}</b></p>
            <button className="mt-6 rounded-2xl bg-[#5048e5] px-6 py-3 text-sm font-bold text-white" onClick={onClose}>{tr("Done")}</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

function IdCard({ backupCode, expiresAt, uid, photoUrl }: { backupCode: string; expiresAt?: string; uid: string; photoUrl?: string }) {
  const [reveal, setReveal] = useState(false)
  const { config, team, room } = useIdCard()
  return (
    <div className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-[28px] bg-gradient-to-br from-[#4f46e5] via-[#6d5cf5] to-[#a78bfa] p-6 text-white shadow-btn">
      <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-white/10" />
      <div className="relative flex items-center justify-between">
        <p className="text-sm font-extrabold tracking-wide">AURA · {config.eventName}</p>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/25 px-2.5 py-1 text-[11px] font-bold ring-1 ring-emerald-300/50"><WifiOff size={12} /> {tr("Offline ready")}</span>
      </div>
      <div className="relative mt-6 flex items-center gap-4">
        <Avatar name={config.studentName} src={photoUrl} size={84} className="ring-4 ring-white/40" />
        <div className="min-w-0">
          <p className="truncate text-2xl font-extrabold leading-tight">{config.studentName}</p>
          <p className="truncate text-sm text-white/80">{config.college}</p>
          <p className="mt-1 font-mono text-xs text-white/70">{uid}</p>
        </div>
      </div>
      <div className="relative mt-6 grid grid-cols-3 gap-2 text-center">
        {[['Team', team.name], ['Room', room.name], ['Seat', room.seat]].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-white/15 px-2 py-2.5 ring-1 ring-white/20"><p className="text-[11px] text-white/70">{k}</p><p className="truncate text-sm font-bold">{v}</p></div>
        ))}
      </div>
      <button onClick={() => setReveal(!reveal)} className="relative mt-4 flex w-full items-center justify-between rounded-2xl bg-black/15 px-4 py-3 text-left ring-1 ring-white/15">
        <span><span className="block text-[11px] text-white/70">{tr("Backup code (if your phone dies)")}</span><span className="font-mono text-lg font-bold tracking-[0.2em]">{reveal ? backupCode : '••••-••••'}</span></span>
        <span className="flex items-center gap-1 text-xs font-semibold">{reveal ? <><EyeOff size={15} /> {tr("Hide")}</> : <><Eye size={15} /> {tr("Tap to reveal")}</>}</span>
      </button>
      <p className="relative mt-4 flex items-center gap-1.5 text-[11px] text-white/70"><ShieldCheck size={13} /> {tr("Signed by the organizer · valid until")} {fmtDT(expiresAt)}</p>
    </div>
  )
}

export default function MyId() {
  const { confirm } = useUI()
  const qc = useQueryClient()
  const { me } = useSession()
  const { run } = useAct()
  const { data: slots = [] } = useSlots()
  const [flow, setFlow] = useState(false)
  const [enrolling, setEnrolling] = useState(false)
  const local = useQuery({ queryKey: ['device-id'], queryFn: async () => (await loadId()) ?? null, networkMode: 'always' })
  const saved = local.data && local.data.credential.payload.participantId === me?.uid ? local.data : null
  const server = me?.registration?.enrollment?.status
  const state: State | 'loading' = local.isLoading ? 'loading' : server === 'revoked' ? 'revoked' : saved ? 'enrolled' : 'not_enrolled'
  const slot = slots.find((s) => s.id === me?.registration?.slotId)
  const enroll = async () => {
    setEnrolling(true)
    try {
      await enrollId()
      await qc.invalidateQueries()
      toast(tr("This phone is now your ID"), { description: tr("Save your backup code somewhere safe."), kind: 'success' })
    } catch (e) {
      toast(errorText(e), { kind: 'error' })
    } finally {
      setEnrolling(false)
    }
  }
  const reissue = (reason: string) => void run('POST', '/id/reissue', { reason }, tr("A new enrollment link is on its way on WhatsApp"))
  return (
    <div className="space-y-5">
      <PageHeader title={tr("My ID")} subtitle={tr("Your digital ID works offline, even in airplane mode")} />
      {state === 'loading' && <Card><EmptyState title={tr("Loading your ID…")} /></Card>}

      {state === 'not_enrolled' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card className="p-6 sm:p-8">
            <IconTile icon={Smartphone} tone="indigo" size="lg" />
            <h2 className="mt-5 text-2xl font-extrabold text-ink">{tr("Enroll this phone as your ID")}</h2>
            <p className="mt-1.5 text-sm text-muted">{server === 'enrolled' ? tr("Your ID is enrolled on another phone. Enrolling here turns that one off.") : tr("Create your ID on this phone. It works once per phone and the key never leaves it.")}</p>
            <ol className="mt-6 space-y-4">
              {[
                [tr("Create a secure key on this phone"), tr("The key can’t be copied off this device, so a screenshot of your ID is useless to anyone else.")],
                [tr("Link it to your registration"), tr("The organizer signs your ID with your name, team and room.")],
                [tr("Save your ID for offline use"), tr("Your ID, room and backup code are stored on this phone.")],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-600">{i + 1}</span><div><p className="font-semibold text-ink">{t}</p><p className="text-sm text-muted">{d}</p></div></li>
              ))}
            </ol>
            <button disabled={enrolling} className="btn-primary mt-7 w-full py-3 sm:w-auto" onClick={() => void enroll()}><KeyRound size={17} /> {enrolling ? tr("Enrolling…") : tr("Enroll this phone")}</button>
          </Card>
          <div className="space-y-4">
            <InfoNote tone="amber" icon={<Smartphone size={15} />}>{tr("Use the phone you’ll carry to the venue. Enrolling another phone later turns this one off.")}</InfoNote>
            <InfoNote icon={<Lock size={15} />}>{tr("Install AURA to your home screen first so your ID opens even without a browser tab.")}</InfoNote>
          </div>
        </div>
      )}

      {state === 'revoked' && (
        <Card className="p-6 ring-1 ring-rose-200 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <IconTile icon={ShieldAlert} tone="rose" size="lg" />
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-extrabold text-ink">{tr("This ID no longer works")}</h2><Pill tone="rose">{tr("Revoked")}</Pill></div>
              <p className="mt-1.5 text-sm text-muted">{tr("An organizer revoked the ID on this phone. Volunteers will reject its QR.")}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button className="btn-primary" onClick={() => confirm({ title: tr("Reissue your ID?"), message: tr("We send a new enrollment link on WhatsApp. Your old phone stops working as your ID."), confirmLabel: tr("Send new link"), reason: true, reasonRequired: true, reasonLabel: tr("Why do you need a new ID?"), reasonPlaceholder: tr("e.g. Lost my phone, using a new one"), onConfirm: reissue })}><RefreshCw size={16} /> {tr("Request a new ID")}</button>
                <Link to="/event-day" className="btn-secondary">{tr("Get help at the desk")}</Link>
              </div>
            </div>
          </div>
        </Card>
      )}

      {state === 'enrolled' && saved && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)]">
          <div className="space-y-4">
            <IdCard backupCode={saved.backupCode} expiresAt={saved.credential.payload.expiresAt} uid={me?.uid ?? ''} photoUrl={me?.profile?.photoUrl} />
            <div className="mx-auto grid max-w-[420px] grid-cols-2 gap-3">
              <button className="btn-primary py-3" onClick={() => setFlow(true)}><ScanLine size={17} /> {tr("Check in")}</button>
              <Link to="/event-day?tab=food" className="btn-secondary py-3"><UtensilsCrossed size={16} /> {tr("Food pass")}</Link>
            </div>
          </div>
          <div className="space-y-5">
            <Card className="p-6">
              <CardHeader title={tr("How check-in works")} subtitle={tr("Two QR codes, about 5 seconds, no internet needed")} />
              <ol className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  { icon: QrCode, t: tr("Volunteer shows a QR"), d: tr("A fresh challenge, valid 60 seconds") },
                  { icon: ScanLine, t: tr("You scan it"), d: tr("Tap “Check in”, your phone signs it") },
                  { icon: CheckCircle2, t: tr("Show your QR"), d: tr("Volunteer scans it and sees your room") },
                ].map((s, i) => (
                  <li key={s.t} className="rounded-2xl bg-surface-2 p-4">
                    <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-brand-500 text-xs font-bold text-white">{i + 1}</span><s.icon size={17} className="text-brand-600" /></div>
                    <p className="mt-3 text-sm font-bold text-ink">{s.t}</p>
                    <p className="text-xs text-muted">{s.d}</p>
                  </li>
                ))}
              </ol>
              <div className="mt-4"><InfoNote tone="green" icon={<Plane size={15} />}>{tr("Tested in airplane mode: your ID, room and backup code are saved on this phone.")}</InfoNote></div>
            </Card>
            <Card className="p-6">
              <CardHeader title={tr("ID details")} />
              <div className="mt-2 divide-y divide-line">
                <KV k="Status" v={<Pill tone="green"><Check size={11} /> {tr("Enrolled")}</Pill>} />
                <KV k="Device" v="This phone" />
                <KV k="Enrolled on" v={fmtDT(saved.credential.payload.issuedAt)} />
                <KV k="Check-in" v={me?.registration?.checkedInAt ? <Pill tone="green"><Check size={11} /> {fmtDT(me.registration.checkedInAt)}</Pill> : <Pill tone="slate">{tr("Not yet")}{slot ? ` ${tr("· slot")} ${slotView(slot).time.split(' ')[0]}` : ''}</Pill>} />
              </div>
            </Card>
            <Card className="p-6">
              <CardHeader title={tr("Phone lost or changed?")} subtitle={tr("Get a new enrollment link. Your old phone stops working as your ID.")} />
              <button className="btn-secondary mt-4" onClick={() => confirm({ title: tr("Reissue your ID?"), message: tr("We send a new enrollment link on WhatsApp. This phone stops working as your ID."), confirmLabel: tr("Reissue ID"), danger: true, reason: true, reasonRequired: true, reasonLabel: tr("Why do you need a new ID?"), reasonPlaceholder: tr("e.g. Switching to a new phone"), onConfirm: reissue })}><RefreshCw size={16} /> {tr("Reissue my ID")}</button>
            </Card>
          </div>
        </div>
      )}
      {flow && <CheckInFlow onClose={() => setFlow(false)} />}
    </div>
  )
}
