/* global importScripts, firebase */
// Background push for AURA (FCM). The page passes the Firebase web config in
// the query string when it registers this worker.
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js')

const config = Object.fromEntries(new URL(self.location.href).searchParams)
firebase.initializeApp(config)
const messaging = firebase.messaging()

messaging.onBackgroundMessage((m) => {
  const n = m.notification || {}
  self.registration.showNotification(n.title || 'AURA', { body: n.body, icon: '/favicon.svg', data: { url: '/announcements' } })
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(self.clients.openWindow(e.notification.data?.url || '/'))
})
