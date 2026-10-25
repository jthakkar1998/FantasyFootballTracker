self.addEventListener('push', (event) => {
  let message = { title: 'Parlay reminder', body: 'Your weekly pick is still missing.', url: '/parlay', urgent: false };
  if (event.data) {
    try { message = { ...message, ...event.data.json() }; } catch (_) { /* fallback */ }
  }
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: message.urgent ? 'parlay-urgent' : 'parlay-reminder',
    renotify: true,
    requireInteraction: Boolean(message.urgent),
    data: { url: '/parlay' }
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/parlay'));
});
