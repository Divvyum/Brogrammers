import { useSyncExternalStore } from 'react'

/** Light / dark theme, stored per browser. index.html applies it before first paint. */
export type Theme = 'light' | 'dark'
const KEY = 'aura-theme'
const listeners = new Set<() => void>()

function read(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function setTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  try { localStorage.setItem(KEY, t) } catch { /* storage blocked: theme lasts for this tab only */ }
  listeners.forEach((l) => l())
}

export function useTheme() {
  const theme = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, read)
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark'), setTheme }
}

/** Collapsed / expanded sidebar, also remembered per browser. */
const SKEY = 'aura-sidebar-collapsed'
let collapsed = (() => { try { return localStorage.getItem(SKEY) === '1' } catch { return false } })()
const sListeners = new Set<() => void>()
export function useSidebar() {
  const value = useSyncExternalStore((l) => { sListeners.add(l); return () => sListeners.delete(l) }, () => collapsed)
  return {
    collapsed: value,
    toggle: () => {
      collapsed = !collapsed
      try { localStorage.setItem(SKEY, collapsed ? '1' : '0') } catch { /* ignore */ }
      sListeners.forEach((l) => l())
    },
  }
}
