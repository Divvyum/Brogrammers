import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Camera, Check, ImagePlus, Plus, ZoomIn } from 'lucide-react'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Chip, Field, Input, Select } from '../../components/ui/Form'
import { GithubIcon } from '../../components/ui/Misc'
import { InfoNote } from '../../components/ui/Preview'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../lib/session'
import { api, errorText, uploadFile } from '../../lib/api'
import { toast } from '../../lib/toast'
import { initialsOf } from '../../lib/format'
import { cn } from '../../lib/cn'
import { tr } from '../../i18n/strings'

const allSkills = ['React', 'TypeScript', 'Python', 'ML', 'UI design', 'Figma', 'Firebase', 'Node', 'Go', 'Flutter', 'Android', 'DevOps', 'Data', 'Hardware', 'Pitching']
const steps = [tr("About you"), tr("Skills & track"), tr("Photo & GitHub")]

/** Centre-crops the picked photo (with the zoom) to 200x200 JPEG, ~18 KB. */
async function cropPhoto(file: Blob, zoom: number): Promise<Blob> {
  const img = await createImageBitmap(file)
  const side = Math.min(img.width, img.height) / (1 + zoom / 100)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 200
  canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 200, 200)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(tr("Could not read the photo")))), 'image/jpeg', 0.8))
}

/** /onboarding: profile form after the first login (plan S2, M6). */
export default function Onboarding() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { me, event, user } = useSession()
  const p = me?.profile ?? {}
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({ name: p.name ?? '', college: p.college ?? '', year: String(p.year ?? 1), city: p.city ?? '', email: (p as { email?: string }).email ?? user?.email ?? '', githubUsername: p.githubUsername ?? '' })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const [skills, setSkills] = useState<string[]>(p.skills ?? [])
  const [track, setTrack] = useState(me?.registration?.track ?? event?.tracks[0] ?? '')
  const [zoom, setZoom] = useState(0)
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | undefined>(p.photoUrl)
  const [agree, setAgree] = useState(true)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const toggle = (s: string) => setSkills(skills.includes(s) ? skills.filter((x) => x !== s) : [...skills, s])
  const allSkillChips = [...allSkills, ...skills.filter((s) => !allSkills.includes(s))]
  const pick = (f?: File) => { if (!f) return; setPhoto(f); setPreview(URL.createObjectURL(f)) }
  const addCustom = () => { const v = window.prompt('Add a skill')?.trim(); if (v && !skills.includes(v)) setSkills([...skills, v]) }
  const valid = [form.name, form.college, form.city, form.email].every((v) => v.trim()) && /^\S+@\S+\.\S+$/.test(form.email)
  const finish = async () => {
    if (!valid) { setStep(0); return toast(tr("Fill in your name, college, city and email"), { kind: 'error' }) }
    if (!track) { setStep(1); return toast(tr("Pick a track"), { kind: 'error' }) }
    if (!agree) return toast(tr("Please accept the code of conduct"), { kind: 'error' })
    setBusy(true)
    try {
      const photoUrl = photo ? await uploadFile('photos', await cropPhoto(photo, zoom)) : p.photoUrl
      await api('/registration', { method: 'PUT', body: { name: form.name.trim(), email: form.email.trim(), college: form.college.trim(), year: form.year === 'pg' ? 5 : Number(form.year), city: form.city.trim(), skills, track, githubUsername: form.githubUsername.trim() || undefined, photoUrl } })
      await qc.invalidateQueries()
      toast(tr("You are registered!"), { description: tr("We are checking your eligibility now."), kind: 'success' })
      navigate('/', { replace: true })
    } catch (e) {
      toast(errorText(e), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthLayout wide>
      <p className="text-sm font-semibold text-brand-600">{tr("Step")} {step + 1} {tr("of 3")}</p>
      <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-ink">{tr("Set up your profile")}</h1>
      <p className="mt-1 text-[15px] text-muted">{tr("This is used for eligibility, team matching and your ID card.")}</p>

      <ol className="mt-6 grid grid-cols-3 gap-2">
        {steps.map((s, i) => (
          <li key={s}>
            <button type="button" onClick={() => setStep(i)} className="w-full text-left">
              <div className={cn('h-1.5 rounded-full', i <= step ? 'bg-gradient-to-r from-[#5b5cf0] to-[#9a7bff]' : 'bg-track')} />
              <span className={cn('mt-2 flex items-center gap-1.5 text-xs font-semibold sm:text-sm', i <= step ? 'text-ink' : 'text-faint')}>{i < step && <Check size={14} className="text-emerald-500" />}{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="card-solid mt-6 p-5 sm:p-7">
        {step === 0 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label={tr("Full name")} required className="sm:col-span-2"><Input value={form.name} onChange={set('name')} /></Field>
            <Field label={tr("College")} required><Input value={form.college} onChange={set('college')} /></Field>
            <Field label={tr("Year of study")} required>
              <Select value={form.year} onChange={set('year')}>{[1, 2, 3, 4].map((y) => <option key={y} value={y}>{tr("Year")} {y}</option>)}<option value="pg">{tr("Postgraduate")}</option></Select>
            </Field>
            <Field label={tr("City you travel from")} required hint={tr("Used to find travel circles.")}><Input value={form.city} onChange={set('city')} /></Field>
            <Field label={tr("Email")} required hint={tr("Used for your certificate and as a sign-in fallback.")}><Input type="email" value={form.email} onChange={set('email')} /></Field>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <p className="label">{tr("Your skills")} <span className="font-normal text-muted">({skills.length} {tr("selected)")}</span></p>
              <div className="flex flex-wrap gap-2">
                {allSkillChips.map((s) => <Chip key={s} active={skills.includes(s)} onClick={() => toggle(s)}>{skills.includes(s) && '✓ '}{s}</Chip>)}
                <Chip onClick={addCustom}><span className="inline-flex items-center gap-1"><Plus size={13} /> {tr("Other")}</span></Chip>
              </div>
            </div>
            <div>
              <p className="label">{tr("Preferred track")}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(event?.tracks ?? []).map((t) => (
                  <button key={t} type="button" onClick={() => setTrack(t)} className={cn('flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition', track === t ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line text-ink-2 hover:border-brand-200')}>
                    {t}
                    <span className={cn('grid h-5 w-5 place-items-center rounded-full border-2', track === t ? 'border-brand-500 bg-brand-500 text-white' : 'border-line')}>{track === t && <Check size={12} strokeWidth={3} />}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-[220px_minmax(0,1fr)]">
            <div>
              <p className="label">{tr("Photo for your ID card")}</p>
              <div className="relative mx-auto grid aspect-square w-full max-w-[220px] place-items-center overflow-hidden rounded-3xl bg-track">
                {preview
                  ? <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ transform: `scale(${1 + zoom / 100})` }} />
                  : <div className="absolute inset-0 bg-gradient-to-br from-indigo-300 to-violet-400 opacity-60" style={{ transform: `scale(${1 + zoom / 100})` }} />}
                <div className="relative grid h-[78%] w-[78%] place-items-center rounded-full border-2 border-dashed border-white text-4xl font-extrabold text-white shadow-[0_0_0_999px_rgba(20,26,70,.35)]">{!preview && initialsOf(form.name)}</div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs text-muted"><ZoomIn size={14} /> <input type="range" min={0} max={100} value={zoom} onChange={(e) => setZoom(+e.target.value)} className="flex-1 accent-brand-500" aria-label={tr("Zoom photo")} /></label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> {tr("Upload")}</button>
                <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={() => camRef.current?.click()}><Camera size={14} /> {tr("Camera")}</button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
                <input ref={camRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => pick(e.target.files?.[0])} />
              </div>
              <p className="mt-2 text-center text-[11px] text-faint">{tr("Cropped and compressed to 200×200 (~18 KB)")}</p>
            </div>
            <div className="space-y-5">
              <Field label={tr("GitHub username")} hint={tr("Used to show your commits to judges. Make sure your repo commits use this account.")}>
                <Input icon={<GithubIcon size={16} />} value={form.githubUsername} onChange={set('githubUsername')} />
              </Field>
              <InfoNote>{tr("When you finish, we check eligibility automatically. You’ll see the result on your Home and Event pages, and get a WhatsApp message.")}</InfoNote>
              <label className="flex items-start gap-2.5 text-sm text-ink-2"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-500" /> {tr("I agree to the event code of conduct and allow organizers to contact me on WhatsApp.")}</label>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button type="button" className="btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> {tr("Back")}</button>
        {step < 2
          ? <button type="button" className="btn-primary" onClick={() => setStep(step + 1)}>{tr("Continue")} <ArrowRight size={16} /></button>
          : <button type="button" disabled={busy} className="btn-primary" onClick={() => void finish()}>{tr("Finish and register")} <ArrowRight size={16} /></button>}
      </div>
    </AuthLayout>
  )
}
