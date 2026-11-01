import { useSyncExternalStore } from 'react'

/** Whether the browser is offline (navigator.onLine). */
const subscribe = (l: () => void) => {
  window.addEventListener('online', l)
  window.addEventListener('offline', l)
  return () => {
    window.removeEventListener('online', l)
    window.removeEventListener('offline', l)
  }
}
export function useOffline() {
  const offline = useSyncExternalStore(subscribe, () => !navigator.onLine)
  return { offline }
}

/** Opens a WhatsApp chat with the organizers (number from the admin's Participant page). */
export function openWhatsApp(number: string, text = 'HELP') {
  window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
}
