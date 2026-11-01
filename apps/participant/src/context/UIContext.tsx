import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { ConfirmDialog, type ConfirmOptions } from '../components/overlays/ConfirmDialog'

interface UIContextValue {
  confirm: (opts: ConfirmOptions) => void
}
const UIContext = createContext<UIContextValue | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [confirmOpts, setConfirmOpts] = useState<ConfirmOptions | null>(null)
  const value = useMemo<UIContextValue>(() => ({ confirm: (o) => setConfirmOpts(o) }), [])
  const close = useCallback(() => setConfirmOpts(null), [])
  return (
    <UIContext.Provider value={value}>
      {children}
      <ConfirmDialog options={confirmOpts} onClose={close} />
    </UIContext.Provider>
  )
}

export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used inside UIProvider')
  return ctx
}
