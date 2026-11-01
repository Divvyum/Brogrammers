import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging'
import { app } from '../firebase'
import { api } from './api'
import { toast } from './toast'

// Web push through FCM (plan M13). The token is registered with the server,
// which subscribes it to the topics for my event, track, room and team.

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined

export const pushState = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

export async function enablePush(topics: string[]) {
  if (!(await isSupported())) throw new Error('This browser can’t show notifications')
  if (!vapidKey) throw new Error('Push isn’t configured (VITE_FIREBASE_VAPID_KEY)')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked in your browser settings')
  const cfg = app.options
  const params = new URLSearchParams({ apiKey: cfg.apiKey ?? '', projectId: cfg.projectId ?? '', messagingSenderId: cfg.messagingSenderId ?? '', appId: cfg.appId ?? '' })
  const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${params}`, { scope: '/firebase-cloud-messaging-push-scope' })
  const messaging = getMessaging(app)
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })
  await api('/fcm-token', { method: 'PUT', body: { token, topics } })
  onMessage(messaging, (m) => toast(m.notification?.title ?? 'New announcement', { description: m.notification?.body, kind: 'info', duration: 8000 }))
}

/** Topic names the server accepts: letters, digits, -_.~% only. */
export const topicsFor = (r?: { track?: string; roomId?: string; teamId?: string } | null) =>
  [r?.track && `track_${r.track}`, r?.roomId && `room_${r.roomId}`, r?.teamId && `team_${r.teamId}`].filter(Boolean).map((t) => String(t).replace(/[^A-Za-z0-9\-_.~%]/g, '_'))
