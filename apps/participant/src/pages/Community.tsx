import { useMemo, useState } from 'react'
import { Check, GraduationCap, Search, UserPlus, X } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '../components/ui/Card'
import { Tabs } from '../components/ui/Tabs'
import { Avatar, EmptyState } from '../components/ui/Misc'
import { Pill } from '../components/ui/Badge'
import { Chip, Input, Toggle } from '../components/ui/Form'
import { useAct, useP } from '../lib/data'
import { useSession } from '../lib/session'
import { useContent } from '../content'
import { tr } from '../i18n/strings'

/** Community Connect: opt-in directory, connection requests, alumni (plan S13, M18). */
type Person = { uid: string; name: string; college: string | null; skills: string[]; team: string | null }
type Conn = { id: string; status: 'pending' | 'accepted' | 'declined'; incoming: boolean; other: { uid: string; name?: string; college?: string; skills?: string[] } }

export default function Community() {
  const { me } = useSession()
  const { run } = useAct()
  const [tab, setTab] = useState<'directory' | 'connections' | 'alumni'>('directory')
  const [q, setQ] = useState('')
  const [skill, setSkill] = useState('')
  const { data: all = [] } = useP<Person[]>('/community')
  const { data: conns = [] } = useP<Conn[]>('/connections')
  const listed = Boolean(me?.profile?.communityOptIn)
  const directory = all.filter((d) => d.uid !== me?.uid).map((d) => ({ ...d, college: d.college ?? '', team: d.team ?? 'No team' }))
  const status = Object.fromEntries(conns.filter((c) => c.status !== 'declined').map((c) => [c.other.uid, c.status])) as Record<string, string>
  const skills = Array.from(new Set(directory.flatMap((d) => d.skills)))
  const people = useMemo(() => directory.filter((d) => (!q || `${d.name} ${d.college}`.toLowerCase().includes(q.toLowerCase())) && (!skill || d.skills.includes(skill))), [directory, q, skill])
  const connections = conns.filter((c) => c.status === 'accepted').map((c) => ({ uid: c.other.uid, name: c.other.name ?? 'Participant', college: c.other.college ?? '' }))
  const incomingRequests = conns.filter((c) => c.incoming && c.status === 'pending').map((c) => ({ id: c.id, uid: c.other.uid, name: c.other.name ?? 'Participant', college: c.other.college ?? '', skills: c.other.skills ?? [] }))
  const { alumni } = useContent()
  const connect = (uid: string) => void run('POST', '/connections', { toUid: uid }, tr("Connection request sent"))
  return (
    <div className="space-y-5">
      <PageHeader title={tr("Community")} subtitle={tr("Stay in touch with the people you met")} />
      <Card className="p-5"><Toggle checked={listed} onChange={(v) => void run('PUT', '/community/opt-in', { enabled: v }, v ? tr("You’re in the directory") : tr("You’re hidden from the directory"))} label={tr("Show me in the participant directory")} description={tr("Others see your name, college, skills and team. Never your phone or email.")} /></Card>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'directory', label: tr("Directory"), count: directory.length }, { id: 'connections', label: tr("Connections"), count: connections.length + incomingRequests.length }, { id: 'alumni', label: tr("Alumni"), count: alumni.length }]} />

      {tab === 'directory' && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="sm:w-[320px]"><Input icon={<Search size={16} />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search name or college")} /></div>
            <div className="no-scrollbar flex gap-2 overflow-x-auto">{['', ...skills].map((s) => <Chip key={s || 'all'} active={skill === s} onClick={() => setSkill(s)}>{s || tr("All skills")}</Chip>)}</div>
          </div>
          {people.length === 0 ? <Card><EmptyState title={tr("No one matches")} description={tr("Try another name or skill.")} /></Card> : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {people.map((p) => (
                <Card key={p.uid} className="p-5">
                  <div className="flex items-center gap-3"><Avatar name={p.name} size={46} /><div className="min-w-0"><p className="truncate font-bold text-ink">{p.name}</p><p className="truncate text-xs text-muted">{p.college}</p><p className="truncate text-xs text-faint">{p.team === 'No team' ? p.team : `${tr("Team")} ${p.team}`}</p></div></div>
                  <div className="mt-3 flex flex-wrap gap-1.5">{p.skills.map((s) => <span key={s} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">{s}</span>)}</div>
                  <div className="mt-4">
                    {status[p.uid] === 'accepted' ? <Pill tone="green"><Check size={11} /> {tr("Connected")}</Pill>
                      : status[p.uid] === 'pending' ? <Pill tone="amber">{tr("Request sent")}</Pill>
                      : <button className="btn-secondary w-full py-2 text-sm" onClick={() => connect(p.uid)}><UserPlus size={15} /> {tr("Connect")}</button>}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'connections' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card className="p-6">
            <CardHeader title={tr("Requests for you")} />
            {incomingRequests.length === 0 && <p className="mt-4 text-sm text-muted">{tr("No pending requests.")}</p>}
            {incomingRequests.map((r) => (
              <div key={r.uid} className="mt-4 rounded-2xl border border-line p-4">
                <div className="flex items-center gap-3"><Avatar name={r.name} size={42} /><div className="min-w-0 flex-1"><p className="font-bold text-ink">{r.name}</p><p className="truncate text-xs text-muted">{[r.college, r.skills.join(', ')].filter(Boolean).join(' · ')}</p></div></div>
                <div className="mt-3 flex gap-2"><button className="btn-primary flex-1 py-2 text-sm" onClick={() => void run('POST', `/connections/${r.id}/respond`, { accept: true }, tr("Connected!"))}><Check size={15} /> {tr("Accept")}</button><button className="btn-secondary flex-1 py-2 text-sm" onClick={() => void run('POST', `/connections/${r.id}/respond`, { accept: false }, tr("Request declined"))}><X size={15} /> {tr("Decline")}</button></div>
              </div>
            ))}
          </Card>
          <Card className="p-6">
            <CardHeader title={tr("My connections")} />
            <ul className="mt-4 space-y-3">
              {connections.length === 0 && <li className="text-sm text-muted">{tr("No connections yet.")}</li>}
              {connections.map((c) => <li key={c.uid} className="flex items-center gap-3"><Avatar name={c.name} size={38} /><div className="min-w-0 flex-1"><p className="truncate font-semibold text-ink">{c.name}</p><p className="truncate text-xs text-muted">{c.college}</p></div><button className="btn-ghost text-xs" onClick={() => { setQ(c.name); setTab('directory') }}>{tr("View")}</button></li>)}
            </ul>
          </Card>
        </div>
      )}

      {tab === 'alumni' && alumni.length === 0 && <Card><EmptyState icon={<GraduationCap size={28} />} title={tr("No alumni listed yet")} description={tr("Winners and finalists from past editions will appear here.")} /></Card>}
      {tab === 'alumni' && alumni.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {alumni.map((a) => (
            <Card key={a.name} className="p-5">
              <div className="flex items-center gap-3"><Avatar name={a.name} size={46} /><div className="min-w-0"><p className="truncate font-bold text-ink">{a.name}</p><p className="truncate text-xs text-muted">{a.now}</p></div></div>
              <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-violet-700"><GraduationCap size={14} /> {a.year}</p>
              {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer" className="btn-secondary mt-4 w-full py-2 text-sm"><UserPlus size={15} /> {tr("Connect")}</a>}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
