/* No page or API caching: source freshness must never come from an offline cache. */
self.addEventListener('install', (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim()),
);
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tibo-notifications', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('seen', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function reserve(id, expiresAt) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('seen', 'readwrite'),
        store = tx.objectStore('seen'),
        request = store.get(id);
      let fresh = false;
      request.onsuccess = () => {
        fresh = !request.result;
        if (fresh) store.put({ id, expiresAt });
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (row) {
            if (row.value.expiresAt < Date.now() - 86400000) row.delete();
            row.continue();
          }
        };
      };
      tx.oncomplete = () => resolve(fresh);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function release(id) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('seen', 'readwrite');
      tx.objectStore('seen').delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let data;
      try {
        data = event.data?.json();
      } catch {
        return;
      }
      if (
        !data ||
        typeof data.id !== 'string' ||
        data.id.length > 200 ||
        typeof data.title !== 'string' ||
        typeof data.body !== 'string' ||
        !Number.isFinite(data.expiresAt) ||
        data.expiresAt <= Date.now()
      )
        return;
      let url;
      try {
        url = new URL(data.url, self.location.origin);
      } catch {
        return;
      }
      if (url.origin !== self.location.origin) return;
      const fresh = await reserve(data.id, data.expiresAt).catch(() => true);
      if (!fresh) return;
      try {
        await self.registration.showNotification(data.title.slice(0, 120), {
          body: data.body.slice(0, 300),
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: String(data.tag || data.id).slice(0, 200),
          data: { url: url.href },
          renotify: false,
        });
      } catch (error) {
        await release(data.id).catch(() => {});
        throw error;
      }
    })(),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = new URL(
        event.notification.data?.url || '/',
        self.location.origin,
      );
      if (url.origin !== self.location.origin) return;
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin === url.origin) {
          await client.navigate(url.href);
          return client.focus();
        }
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
