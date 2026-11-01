import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, MailCheck, MessageCircle, RotateCw } from 'lucide-react'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { useSession } from '../../lib/session'
import { errorText } from '../../lib/api'
import { toast } from '../../lib/toast'
import { cn } from '../../lib/cn'
import { tr } from '../../i18n/strings'

/** 6-digit WhatsApp code screen with resend timer (plan S2). */
export default function Verify() {
  const navigate = useNavigate()
  const session = useSession()
  const devCode = (useLocation().state as { devCode?: string } | null)?.devCode
  const [digits, setDigits] = useState(() => (devCode ? devCode.split('') : ['', '', '', '', '', '']))
  const [error, setError] = useState<string | false>(false)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(60)
  useEffect(() => {
    if (!session.phone) navigate('/login', { replace: true })
  }, [session.phone, navigate])
  useEffect(() => {
    if (wait <= 0) return
    const t = window.setTimeout(() => setWait(wait - 1), 1000)
    return () => window.clearTimeout(t)
  }, [wait])
  const verify = async () => {
    setBusy(true)
    try {
      await session.verifyOtp(digits.join(''))
      navigate('/', { replace: true })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const resend = async () => {
    if (wait > 0) return
    try {
      const r = await session.requestOtp(session.phone)
      if (r.devCode) { setDigits(r.devCode.split('')); toast(`${tr("Dev code:")} ${r.devCode}`, { kind: 'info', duration: 15000 }) }
      else toast(tr("New code sent on WhatsApp"), { kind: 'success' })
      setWait(60)
    } catch (e) {
      toast(errorText(e), { kind: 'error' })
    }
  }
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const set = (i: number, v: string) => {
    const all = v.replace(/\D/g, '')
    if (all.length === 6) { setDigits(all.split('')); setError(false); refs.current[5]?.focus(); return }
    const d = all.slice(-1)
    const next = [...digits]; next[i] = d; setDigits(next); setError(false)
    if (d && i < 5) refs.current[i + 1]?.focus()
  }
  const full = digits.every(Boolean)
  return (
    <AuthLayout>
      <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft size={16} /> {tr("Change number")}</Link>
      <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><MessageCircle size={26} /></div>
      <h1 className="text-[30px] font-extrabold tracking-tight text-ink">{tr("Enter the code")}</h1>
      <p className="mt-1.5 text-[15px] text-muted">{tr("We sent a 6-digit code on WhatsApp to")} <b className="text-ink">+91 {session.phone}</b>{tr(". It expires in 5 minutes.")}</p>

      <form className="mt-8" onSubmit={(e) => { e.preventDefault(); if (!full) { setError(tr("Enter all 6 digits. You have 5 attempts.")); return } void verify() }}>
        <div className="flex justify-between gap-2 sm:gap-3">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el }}
              value={d}
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus() }}
              inputMode="numeric"
              aria-label={`${tr("Digit")} ${i + 1}`}
              className={cn('h-14 w-full min-w-0 rounded-2xl border bg-white text-center text-2xl font-bold text-ink outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100 sm:h-16', error ? 'border-rose-300' : 'border-line')}
            />
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary mt-7 w-full py-3">{tr("Verify and continue")}</button>
      </form>

      <div className="mt-6 flex items-center justify-between text-sm">
        <span className="text-muted">{wait > 0 ? <>{tr("Didn’t get it? Resend in")} <b className="text-ink">0:{String(wait).padStart(2, '0')}</b></> : tr("Didn’t get it?")}</span>
        <button disabled={wait > 0} onClick={() => void resend()} className="inline-flex disabled:opacity-50 items-center gap-1.5 font-semibold text-brand-600 hover:underline"><RotateCw size={14} /> {tr("Resend code")}</button>
      </div>
      <Link to="/login" className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-line px-4 py-3 text-sm font-semibold text-ink-2 hover:bg-brand-50"><MailCheck size={16} /> {tr("Use an email link instead")}</Link>
    </AuthLayout>
  )
}

export function EmailSent() {
  const session = useSession()
  const resend = () => session.sendEmailLink(session.email).then(() => toast(tr("Link sent again"), { kind: 'success' }), (e) => toast(errorText(e), { kind: 'error' }))
  return (
    <AuthLayout>
      <div className="text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-brand-50 text-brand-600"><MailCheck size={30} /></div>
        <h1 className="text-[28px] font-extrabold tracking-tight text-ink">{tr("Check your inbox")}</h1>
        <p className="mx-auto mt-2 max-w-sm text-[15px] text-muted">{tr("We emailed a sign-in link to")} <b className="text-ink">{session.email}</b>{tr(". Open it on this device to continue.")}</p>
        <div className="mt-8 flex flex-col gap-3">
          <button className="btn-secondary py-3" onClick={() => void resend()}>{tr("Resend link")}</button>
          <Link to="/login" className="text-sm font-semibold text-brand-600 hover:underline">{tr("Back to sign in")}</Link>
        </div>
      </div>
    </AuthLayout>
  )
}
