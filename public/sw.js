// Lưu giao diện app để mở được khi mất mạng. Dữ liệu (Supabase) không đi qua đây: app tự lưu vào IndexedDB.
// Trang app: lấy từ mạng trước, mất mạng thì dùng bản đã lưu. File khác cùng trang (js, css, icon, bộ quét mã): dùng bản đã lưu trước.
// ponytail: file không đổi tên (icon, thu-quet/lib) giữ bản cũ đến khi đổi CACHE; tăng số khi cần làm mới.
const CACHE = 'hsd-v1';
const APP = new URL('./', self.location).href;
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.add(APP)).catch(() => {})); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || !u.href.startsWith(APP)) return;
  if (r.mode === 'navigate') {
    if (u.href !== APP && u.href !== APP + 'index.html') return;   // trang thử quét: đi thẳng ra mạng
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(APP, cp)); return res; })
      .catch(() => caches.match(APP)));
    return;
  }
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
    return res;
  })));
});
