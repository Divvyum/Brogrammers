import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Link2Off, LogOut, Moon, RefreshCw, Smartphone, Sun } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '../components/ui/Card'
import { Avatar, GithubIcon } from '../components/ui/Misc'
import { Pill } from '../components/ui/Badge'
import { Chip, Field, Input, Segmented, Select } from '../components/ui/Form'
import { useConfig } from '../config'
import { useSession } from '../lib/session'
import { useAct, useEventInfo } from '../lib/data'
import { errorText, uploadFile } from '../lib/api'
import { toast } from '../lib/toast'
import { fmtDT } from '../lib/format'
import { useQuery } from '@tanstack/react-query'
import { loadId } from '../device-id'
import { useTheme } from '../lib/theme'
import { useLang } from '../i18n/strings'
import { useUI } from '../context/UIContext'
import { cn } from '../lib/cn'
import { tr } from '../i18n/strings'

const prefs = [
  { id: 'urgent', label: tr("Emergency alerts"), hint: tr("Always on, for your safety"), locked: true },
  { id: 'team', label: tr("Team & replacement invites"), hint: tr("Join requests, withdrawals, invitations") },
  { id: 'schedule', label: tr("Schedule changes & reminders"), hint: tr("Room changes, mentor sessions") },
  { id: 'announcements', label: tr("Announcements"), hint: tr("General updates from organizers") },
  { id: 'results', label: tr("Results & rewards"), hint: tr("Scores, certificates, prize status") },
]
const channels = ['WhatsApp', 'Push', 'Email'] as const

/** Edit profile, notification preferences, GitHub, theme/language, reissue ID, sign out (plan S14). */
// Everything is on until the person turns it off (the server sends when a preference is missing).
const allOn = ['WhatsApp', 'Push', 'Email']

export default function Profile() {
  const navigate = useNavigate()
  const { confirm } = useUI()
  const { theme, setTheme } = useTheme()
  const { lang, setLang } = useLang()
  const config = useConfig()
  const { me, signOut } = useSession()
  const { data: event } = useEventInfo()
  const { run, busy } = useAct()
  const p = me?.profile ?? {}
  const reg = me?.registration
  const device = useQuery({ queryKey: ['device-id'], queryFn: async () => (await loadId()) ?? null, networkMode: 'always' })
  const saved = device.data && device.data.credential.payload.participantId === me?.uid ? device.data : null
  const [form, setForm] = useState({ name: config.studentName, college: config.college, year: String(config.year), city: config.city, email: config.studentEmail, track: config.track, githubUsername: config.githubUsername })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const [skills, setSkills] = useState<string[]>(p.skills ?? [])
  const baseSkills = ['React', 'TypeScript', 'Python', 'ML', 'UI design', 'Figma', 'Firebase', 'Node', 'Go', 'Flutter']
  const skillChips = [...baseSkills, ...skills.filter((s) => !baseSkills.includes(s))]
  const stored = p.notifications ?? {}
  const [matrix, setMatrix] = useState<Record<string, string[]>>(() => Object.fromEntries(prefs.map((x) => [x.id, Object.keys(stored).some((k) => k.startsWith(`${x.id}_`)) ? channels.filter((c) => stored[`${x.id}_${c}`]) : allOn])))
  const flip = (id: string, c: string) => setMatrix({ ...matrix, [id]: matrix[id].includes(c) ? matrix[id].filter((x) => x !== c) : [...matrix[id], c] })
  const photoRef = useRef<HTMLInputElement>(null)
  const changePhoto = async (f?: File) => {
    if (!f) return
    try {
      const url = await uploadFile('photos', f)
      await run('PUT', '/profile', { photoUrl: url }, tr("Photo updated"))
    } catch (e) {
      toast(errorText(e), { kind: 'error' })
    }
  }
  const save = () => {
    const notifications = Object.fromEntries(prefs.flatMap((x) => channels.map((c) => [`${x.id}_${c}`, matrix[x.id].includes(c)])))
    const body: Record<string, unknown> = { name: form.name.trim(), college: form.college.trim(), year: Number(form.year), city: form.city.trim(), skills, githubUsername: form.githubUsername.trim(), notifications }
    if (form.email.trim() && form.email.trim() !== config.studentEmail) body.email = form.email.trim()
    if (form.track && form.track !== config.track && !reg?.teamId) body.track = form.track
    void run('PUT', '/profile', body, tr("Profile saved"))
  }
  const eligibility = reg?.eligibility?.result
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Profile & Settings")} subtitle={tr("Your details, notifications and devices")} actions={<button disabled={busy} className="btn-primary" onClick={save}>{tr("Save changes")}</button>} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card className="p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="relative w-fit"><Avatar name={config.studentName} src={p.photoUrl} size={84} /><button aria-label={tr("Change photo")} className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-brand-500 text-white shadow-btn" onClick={() => photoRef.current?.click()}><Camera size={15} /></button><input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => void changePhoto(e.target.files?.[0])} /></div>
              <div><p className="text-xl font-extrabold text-ink">{config.studentName}</p><p className="text-sm text-muted">{config.college} {tr("· Year")} {config.year} · {config.city}</p><div className="mt-2 flex flex-wrap gap-2">{eligibility && <Pill tone={eligibility === 'eligible' ? 'green' : eligibility === 'flagged' ? 'amber' : 'rose'}>{eligibility === 'eligible' ? tr("Eligible") : eligibility === 'flagged' ? tr("Under review") : tr("Not eligible")}</Pill>}{config.track && <Pill tone="indigo">{config.track}</Pill>}</div></div>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={tr("Full name")}><Input value={form.name} onChange={set('name')} /></Field>
              <Field label={tr("College")}><Input value={form.college} onChange={set('college')} /></Field>
              <Field label={tr("Year")}><Select value={form.year} onChange={set('year')}>{[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y === 5 ? tr("Postgraduate") : `${tr("Year")} ${y}`}</option>)}</Select></Field>
              <Field label={tr("City")}><Input value={form.city} onChange={set('city')} /></Field>
              <Field label={tr("WhatsApp number")} hint={tr("Changing it needs a new code on WhatsApp.")}><Input value={config.studentPhone} disabled /></Field>
              <Field label={tr("Email")}><Input type="email" value={form.email} onChange={set('email')} /></Field>
              <Field label={tr("Preferred track")} className="sm:col-span-2" hint={reg?.teamId ? tr("Your track follows your team.") : undefined}><Select value={form.track} disabled={Boolean(reg?.teamId)} onChange={set('track')}>{(event?.tracks ?? []).map((t) => <option key={t}>{t}</option>)}</Select></Field>
            </div>
            <p className="label mt-5">{tr("Skills")}</p>
            <div className="flex flex-wrap gap-2">{skillChips.map((s) => <Chip key={s} active={skills.includes(s)} onClick={() => setSkills(skills.includes(s) ? skills.filter((x) => x !== s) : [...skills, s])}>{s}</Chip>)}</div>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-6 pt-6"><CardHeader title={tr("Notification preferences")} subtitle={tr("Choose where each kind of message reaches you")} /></div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead className="bg-surface-2"><tr><th className="th">{tr("Message")}</th>{channels.map((c) => <th key={c} className="th text-center">{c}</th>)}</tr></thead>
                <tbody>
                  {prefs.map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="td"><p className="font-semibold text-ink">{p.label}</p><p className="text-xs text-muted">{p.hint}</p></td>
                      {channels.map((c) => (
                        <td key={c} className="td text-center">
                          <input type="checkbox" aria-label={`${p.label} by ${c}`} disabled={p.locked} checked={matrix[p.id].includes(c)} onChange={() => flip(p.id, c)} className="h-4.5 w-4.5 accent-brand-500 disabled:opacity-60" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-6">
            <CardHeader title={tr("Appearance & language")} />
            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-ink">{tr("Theme")}</span><Segmented value={theme} onChange={setTheme} options={[{ id: 'light', label: <span className="flex items-center gap-1.5"><Sun size={14} /> {tr("Light")}</span> }, { id: 'dark', label: <span className="flex items-center gap-1.5"><Moon size={14} /> {tr("Dark")}</span> }]} /></div>
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-ink">{tr("Language")}</span><Segmented value={lang} onChange={setLang} options={[{ id: 'en', label: 'English' }, { id: 'hi', label: 'हिन्दी' }]} /></div>
            </div>
          </Card>
          <Card className="p-6">
            <CardHeader title={tr("Linked GitHub")} subtitle={tr("Judges match your commits to this account")} />
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-surface-2 p-3.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#141a46] text-white"><GithubIcon size={20} /></span>
              <div className="min-w-0 flex-1">{form.githubUsername ? <p className="font-semibold text-ink">@{form.githubUsername}</p> : <p className="font-semibold text-muted">{tr("Not linked")}</p>}<p className="text-xs text-muted">{tr("Commits from this account count for your team")}</p></div>
              <button className="btn-ghost px-2 text-xs text-rose-600" onClick={() => { const v = window.prompt('GitHub username', form.githubUsername)?.trim(); if (v !== undefined) { setForm({ ...form, githubUsername: v }); void run('PUT', '/profile', { githubUsername: v }, tr("GitHub updated")) } }}><Link2Off size={14} /> {tr("Change")}</button>
            </div>
          </Card>
          <Card className="p-6">
            <CardHeader title={tr("My ID device")} />
            <div className="mt-4 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600"><Smartphone size={19} /></span><div className="flex-1"><p className="font-semibold text-ink">{saved ? tr("This phone") : reg?.enrollment?.status === 'enrolled' ? tr("Another phone") : tr("No device yet")}</p><p className="text-xs text-muted">{saved ? `${tr("Enrolled")} ${fmtDT(saved.credential.payload.issuedAt)}` : tr("Enroll on the My ID page")}</p></div>{reg?.enrollment?.status === 'enrolled' ? <Pill tone="green">{tr("Active")}</Pill> : reg?.enrollment?.status === 'revoked' ? <Pill tone="rose">{tr("Revoked")}</Pill> : <Pill tone="slate">{tr("Not enrolled")}</Pill>}</div>
            <button className="btn-secondary mt-4 w-full" onClick={() => confirm({ title: tr("Reissue your ID?"), message: tr("Use this if your phone was lost or changed. We send a new enrollment link on WhatsApp and this phone stops working as your ID."), confirmLabel: tr("Reissue ID"), danger: true, reason: true, reasonRequired: true, reasonLabel: tr("Why do you need a new ID?"), onConfirm: (reason) => void run('POST', '/id/reissue', { reason }, tr("A new enrollment link is on its way on WhatsApp")) })}><RefreshCw size={15} /> {tr("Reissue ID (phone changed)")}</button>
          </Card>
          <Card className="p-6">
            <CardHeader title={tr("Account")} />
            <button className={cn('btn-secondary mt-4 w-full text-rose-600')} onClick={() => void signOut().then(() => navigate('/login'))}><LogOut size={16} /> {tr("Sign out")}</button>
          </Card>
        </div>
      </div>
    </div>
  )
}
