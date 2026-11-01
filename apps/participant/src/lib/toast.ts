import { useSyncExternalStore } from 'react'

export type ToastKind = 'info' | 'success' | 'warning' | 'error' | 'design'
export interface Toast {
  id: number
  title: string
  description?: string
  kind: ToastKind
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function toast(title: string, opts: { description?: string; kind?: ToastKind; duration?: number } = {}) {
  const t: Toast = { id: nextId++, title, description: opts.description, kind: opts.kind ?? 'info' }
  toasts = [...toasts, t].slice(-4)
  emit()
  window.setTimeout(() => dismissToast(t.id), opts.duration ?? 3200)
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => toasts,
  )
}
