import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Download, LayoutGrid, WifiOff, X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { mobileTabs, navSections, profileItem } from './nav'
import { useOffline } from '../../lib/offline'
import { useLang } from '../../i18n/strings'
import { AuraLogo } from '../ui/Misc'
import { cn } from '../../lib/cn'
import { tr } from '../../i18n/strings'

function OfflineBanner() {
  const { offline } = useOffline()
  const { t } = useLang()
  if (!offline) return null
  return (
    <div role="status" className="anim-fade mt-3 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <WifiOff size={18} className="mt-0.5 shrink-0" />
      <p className="flex-1">{t('common.offline')}</p>
    </div>
  )
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferredInstall: InstallEvent | null = null
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e as InstallEvent })

/** PWA install prompt (build plan S1). Shown once, when the browser offers installation. */
function InstallPrompt() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('aura-install-dismissed') !== '1' } catch { return true } })
  const [can, setCan] = useState(Boolean(deferredInstall))
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); deferredInstall = e as InstallEvent; setCan(true) }
    window.addEventListener('beforeinstallprompt', on)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])
  if (!open || !can) return null
  const install = async () => { if (!deferredInstall) return; await deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; setCan(false) }
  const dismiss = () => { setOpen(false); try { localStorage.setItem('aura-install-dismissed', '1') } catch { /* ignore */ } }
  return (
    <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 rounded-2xl border border-white bg-white/85 px-4 py-3 shadow-card sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50"><AuraLogo size={24} /></div>
      <div className="min-w-0">
        <p className="text-sm font-bold text-ink">{tr("Install AURA on your phone")}</p>
        <p className="text-xs text-muted">{tr("Your ID card and schedule then work in airplane mode at the venue.")}</p>
      </div>
      <button className="btn-primary col-span-3 row-start-2 px-4 py-2 sm:col-span-1 sm:col-start-3 sm:row-start-1" onClick={() => void install()}><Download size={15} /> {tr("Install")}</button>
      <button className="col-start-3 row-start-1 self-start rounded-lg p-1.5 text-faint hover:bg-brand-50 hover:text-ink sm:col-start-4 sm:self-center" onClick={dismiss} aria-label={tr("Dismiss install prompt")}><X size={16} /></button>
    </div>
  )
}

function MobileNav() {
  const { t } = useLang()
  const [more, setMore] = useState(false)
  const { pathname } = useLocation()
  const [path, setPath] = useState(pathname)
  if (path !== pathname) { setPath(pathname); setMore(false) }
  const inMore = !mobileTabs.some((m) => (m.to === '/' ? pathname === '/' : pathname.startsWith(m.to)))
  return (
    <>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-white/70 bg-white/90 backdrop-blur-md lg:hidden dark:border-white/5">
        <div className="mx-auto grid max-w-lg grid-cols-5 px-2">
          {mobileTabs.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.to === '/'} className={({ isActive }) => cn('flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold', isActive ? 'text-brand-600' : 'text-muted')}>
              {({ isActive }) => (<>
                <span className={cn('grid h-8 w-12 place-items-center rounded-full transition', isActive && 'bg-brand-50')}><m.icon size={20} strokeWidth={isActive ? 2.2 : 1.8} /></span>
                <span className="max-w-full truncate">{t(m.key)}</span>
              </>)}
            </NavLink>
          ))}
          <button onClick={() => setMore(true)} className={cn('flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold', inMore ? 'text-brand-600' : 'text-muted')}>
            <span className={cn('grid h-8 w-12 place-items-center rounded-full', inMore && 'bg-brand-50')}><LayoutGrid size={20} /></span>
            {t('nav.more')}
          </button>
        </div>
      </nav>
      {more && (
        <div className="anim-fade fixed inset-0 z-50 bg-[#1b1f4a]/30 backdrop-blur-[2px] lg:hidden" onClick={() => setMore(false)}>
          <div className="anim-sheet pb-safe absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-[28px] bg-white px-5 pb-6 pt-3 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-track" />
            {navSections.map((s) => (
              <div key={s.key} className="mb-4">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">{t(s.key)}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {s.items.map((i) => (
                    <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => cn('flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center text-xs font-semibold', isActive ? 'bg-brand-50 text-brand-600' : 'text-ink-2 hover:bg-surface-2')}>
                      <i.icon size={21} />
                      <span className="leading-tight">{t(i.key)}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
            <NavLink to={profileItem.to} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm font-semibold text-ink"><profileItem.icon size={19} /> {t(profileItem.key)}</NavLink>
          </div>
        </div>
      )}
    </>
  )
}

export function AppLayout() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 pb-28 sm:px-6 lg:px-7 lg:pb-10">
        <div className="mx-auto max-w-[1480px]">
          <TopBar />
          <OfflineBanner />
          {pathname === '/' && <InstallPrompt />}
          <div className="pt-5">
            <Outlet />
          </div>
        </div>
      </main>
      <MobileNav />
    </div>
  )
}
