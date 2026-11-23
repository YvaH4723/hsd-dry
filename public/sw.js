// Lưu giao diện app để mở được khi mất mạng. Dữ liệu (Supabase) không đi qua đây: app tự lưu vào IndexedDB.
// Trang app: lấy từ mạng trước, mất mạng thì dùng bản đã lưu. File khác cùng trang (js, css, icon, bộ quét mã): dùng bản đã lưu trước.
// ponytail: file không đổi tên (icon, thu-quet/lib) giữ bản cũ đến khi đổi CACHE; tăng số khi cần làm mới.
const CACHE = 'hsd-v2';
const APP = new URL('./', self.location).href;
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled([APP, APP + 'thu-quet/lib/barcode-detector.js', APP + 'thu-quet/lib/zxing_reader.wasm'].map(u => c.add(u))))); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || !u.href.startsWith(APP)) return;
  const page = u.origin + u.pathname === APP || u.origin + u.pathname === APP + 'index.html';
  // Trang app (mở app, hoặc app tự hỏi "có bản mới không"): luôn hỏi mạng trước, mất mạng mới dùng bản đã lưu.
  if (r.mode === 'navigate' || page) {
    if (!page) return;                                                  // trang thử quét: đi thẳng ra mạng
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(APP, cp)); } return res; })
      .catch(() => caches.match(APP)));
    return;
  }
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
    return res;
  })));
});

// Thông báo hằng ngày (gửi từ GitHub Actions). Bấm vào: mở app (tab Hôm nay).
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'HSD Dry', {
    body: d.body || 'Mở app để xem việc hôm nay', icon: APP + 'icon-192.png', badge: APP + 'icon-192.png',
    tag: 'hsd-digest', renotify: true, data: { url: d.url || APP },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(c => c.url.startsWith(APP));
    return w ? w.focus().catch(() => self.clients.openWindow(APP)) : self.clients.openWindow(e.notification.data?.url || APP);
  }));
});
