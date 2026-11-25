self.addEventListener('push', (event) => {
  let message = { title: 'Parlay reminder', body: 'Your weekly pick is still missing.', url: '/parlay', urgent: false };
  if (event.data) {
    try { message = { ...message, ...event.data.json() }; } catch (_) { /* keep a safe fallback */ }
  }
  // Per-event tags keep different live hits visible individually. Reminders deliberately
  // retain the original reminder tag and live retries reuse the same event tag.
  const tag = typeof message.tag === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(message.tag)
    ? message.tag : (message.urgent ? 'parlay-urgent' : 'parlay-reminder');
  const url = typeof message.url === 'string' && message.url.startsWith('/') && !message.url.startsWith('//')
    ? message.url : '/parlay';
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    renotify: true,
    requireInteraction: Boolean(message.urgent),
    data: { url }
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && typeof event.notification.data.url === 'string'
    && event.notification.data.url.startsWith('/') && !event.notification.data.url.startsWith('//')
      ? event.notification.data.url : '/parlay';
  event.waitUntil(clients.openWindow(url));
});
