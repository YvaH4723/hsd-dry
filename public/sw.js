// ponytail: chỉ để trình duyệt cho cài app; chưa lưu offline (làm ở bước "chạy khi mất mạng").
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
