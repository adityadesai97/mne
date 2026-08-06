import { clientsClaim } from 'workbox-core'
import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

// Activate a newly-installed service worker immediately instead of leaving
// it stuck in "waiting" until every open tab is closed. Without this, a tab
// left open across a deploy keeps being served the previous deploy's cached
// app shell/JS chunks indefinitely (only a hard refresh — which bypasses the
// service worker — would show the new version), which reads as "the app
// randomly fails to load" since chunk hashes from the old deploy stop
// resolving once a newer deployment replaces them.
self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', e => {
  const { title, body } = e.data?.json() ?? {}
  e.waitUntil(
    self.registration.showNotification(title ?? 'mne', {
      body,
      icon: '/icon-192-v2.png',
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(clients.openWindow('/'))
})
