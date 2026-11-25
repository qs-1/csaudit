// Seat alert notifications. Loaded into the generated service worker (vite.config.ts, workbox.importScripts).
// Messages come from the seats Worker: { title, body, url, tag }.

self.addEventListener('push', (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = { title: 'Seat alert', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(m.title || 'Seat alert', {
    body: m.body || '',
    tag: m.tag || undefined, // a newer alert for the same section replaces the old one
    renotify: !!m.tag,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: m.url || '/#/seats' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/#/seats', self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) { await tab.focus(); return tab.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  })());
});
