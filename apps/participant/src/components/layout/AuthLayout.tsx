import type { ReactNode } from 'react'
import { IdCard, MessageCircle, Route, UsersRound } from 'lucide-react'
import { AuraLogo } from '../ui/Misc'
import { ThemeToggle } from './TopBar'
import { useConfig } from '../../config'
import { tr } from '../../i18n/strings'

const points = [
  { icon: MessageCircle, text: tr("Sign in with a code on WhatsApp, no password") },
  { icon: UsersRound, text: tr("Find teammates with matching skills") },
  { icon: Route, text: tr("Travel together and book your arrival slot") },
  { icon: IdCard, text: tr("A digital ID that works even without internet") },
]

/** Split layout for login / code / onboarding (outside the sidebar). */
export function AuthLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const config = useConfig()
  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-[42%] max-w-[640px] overflow-hidden bg-gradient-to-br from-[#4f46e5] via-[#6656f0] to-[#9b7bff] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-32 -left-20 h-[420px] w-[420px] rounded-full bg-[#b4a6ff]/30 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="keep-white grid h-14 w-14 place-items-center rounded-2xl bg-white shadow-lg"><AuraLogo size={36} /></div>
          <span className="text-3xl font-extrabold tracking-tight">AURA</span>
        </div>
        <div className="relative mt-auto">
          <p className="mb-3 inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/25">{config.eventName} · {config.eventDates}</p>
          <h2 className="max-w-md text-[38px] font-extrabold leading-[1.1] tracking-tight">{tr("From finding your team to getting your prize.")}</h2>
          <p className="mt-4 max-w-md text-white/80">{tr("Everything you need for the hackathon, in one app that keeps working when the venue Wi-Fi doesn’t.")}</p>
          <ul className="mt-9 space-y-4">
            {points.map((p) => (
              <li key={p.text} className="flex items-center gap-3.5 text-[15px]">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25"><p.icon size={19} /></span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-sm text-white/60">{tr("© 2026 AURA · Student app")}</p>
      </div>
      <div className="relative flex flex-1 flex-col items-center px-5 py-8 sm:px-10">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2 lg:invisible"><AuraLogo size={32} /><span className="text-xl font-extrabold text-ink">AURA</span></div>
          <ThemeToggle />
        </div>
        <div className={`my-auto w-full py-8 ${wide ? 'max-w-[720px]' : 'max-w-[440px]'}`}>{children}</div>
      </div>
    </div>
  )
}
