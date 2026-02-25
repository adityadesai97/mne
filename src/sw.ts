import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

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
