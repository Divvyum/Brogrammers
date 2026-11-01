import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Mail, MessageCircle, Phone, ShieldCheck } from 'lucide-react'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Field, Input, Segmented } from '../../components/ui/Form'
import { InfoNote } from '../../components/ui/Preview'
import { useSession } from '../../lib/session'
import { errorText } from '../../lib/api'
import { toast } from '../../lib/toast'
import { tr } from '../../i18n/strings'

/** /login and /signup: WhatsApp OTP first, email link as the fallback (plan S2, M5). */
export default function Login({ mode = 'login' }: { mode?: 'login' | 'signup' }) {
  const navigate = useNavigate()
  const [method, setMethod] = useState<'phone' | 'email'>('phone')
  const session = useSession()
  const [phone, setPhone] = useState(session.phone)
  const [email, setEmail] = useState(session.email)
  const [busy, setBusy] = useState(false)
  const signup = mode === 'signup'
  const sendCode = async () => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) return toast(tr("Enter your 10-digit WhatsApp number"), { kind: 'error' })
    setBusy(true)
    try {
      const r = await session.requestOtp(digits)
      if (r.devCode) toast(`${tr("Dev code:")} ${r.devCode}`, { description: tr("Local emulators only (DEV_OTP=true)"), kind: 'info', duration: 15000 })
      navigate('/verify', { state: { devCode: r.devCode } })
    } catch (e) {
      toast(errorText(e), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const sendLink = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast(tr("Enter a valid email"), { kind: 'error' })
    setBusy(true)
    try {
      await session.sendEmailLink(email.trim())
      navigate('/email-sent')
    } catch (e) {
      toast(errorText(e), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthLayout>
      <h1 className="text-[30px] font-extrabold tracking-tight text-ink">{signup ? tr("Create your account") : tr("Welcome back")}</h1>
      <p className="mt-1.5 text-[15px] text-muted">{signup ? tr("Register for the hackathon in two minutes.") : tr("Sign in to continue your hackathon journey.")}</p>

      <div className="mt-7"><Segmented value={method} onChange={setMethod} options={[{ id: 'phone', label: <span className="flex items-center gap-1.5"><MessageCircle size={15} /> WhatsApp</span> }, { id: 'email', label: <span className="flex items-center gap-1.5"><Mail size={15} /> {tr("Email link")}</span> }]} /></div>

      {method === 'phone' ? (
        <form className="mt-6 space-y-5" onSubmit={(e) => { e.preventDefault(); void sendCode() }}>
          <Field label={tr("WhatsApp number")} hint={tr("We send a 6-digit code on WhatsApp. SMS is not used.")}>
            <div className="flex gap-2">
              <select className="input w-[92px] shrink-0" defaultValue="+91" aria-label={tr("Country code")}><option>+91</option></select>
              <Input icon={<Phone size={16} />} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
            </div>
          </Field>
          <button type="submit" disabled={busy} className="btn-primary w-full py-3">{tr("Send code on WhatsApp")} <ArrowRight size={16} /></button>
        </form>
      ) : (
        <form className="mt-6 space-y-5" onSubmit={(e) => { e.preventDefault(); void sendLink() }}>
          <Field label={tr("Email")} hint={tr("We email you a one-time sign-in link. Use this if WhatsApp isn’t working.")}>
            <Input icon={<Mail size={16} />} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@college.edu" />
          </Field>
          <button type="submit" disabled={busy} className="btn-primary w-full py-3">{tr("Email me a sign-in link")} <ArrowRight size={16} /></button>
        </form>
      )}

      <div className="mt-6"><InfoNote icon={<ShieldCheck size={15} />}>{tr("One account per phone number and email. If you registered before, sign in with the same number.")}</InfoNote></div>

      <p className="mt-8 text-center text-sm text-muted">
        {signup ? <>{tr("Already registered?")} <Link to="/login" className="font-semibold text-brand-600 hover:underline">{tr("Sign in")}</Link></> : <>{tr("New here?")} <Link to="/signup" className="font-semibold text-brand-600 hover:underline">{tr("Create an account")}</Link></>}
      </p>
    </AuthLayout>
  )
}
