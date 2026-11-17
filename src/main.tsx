import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './style.css';

createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL });
  // Lưu ngay các file của lần mở này (lần đầu service worker chưa kịp bắt), để lần sau mất mạng vẫn mở được.
  navigator.serviceWorker.ready.then(() => caches.open('hsd-v1')).then(c => {
    const base = location.origin + import.meta.env.BASE_URL;
    const urls = performance.getEntriesByType('resource').map(e => e.name).filter(u => u.startsWith(base) && !u.includes('/thu-quet/index'));
    // Bỏ file js/css của các bản cũ cho cache khỏi phình sau mỗi lần cập nhật.
    c.keys().then(ks => ks.forEach(k => { if (k.url.includes('/assets/') && !urls.includes(k.url)) c.delete(k); }));
    return c.addAll([...new Set([base, ...urls])]);
  }).catch(() => {});
}

// Có bản mới trên web (vừa sửa xong) mà app trên máy vẫn chạy bản cũ: hiện nút "Tải lại" thay vì phải tắt hẳn app.
const mine = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.src.match(/index-[\w-]+\.js/)?.[0];
async function checkUpdate() {
  if (!mine || !navigator.onLine || document.getElementById('upd')) return;
  try {
    const html = await (await fetch(import.meta.env.BASE_URL, { cache: 'no-store' })).text();
    const live = html.match(/index-[\w-]+\.js/)?.[0];
    if (!live || live === mine) return;
    const b = document.createElement('div');
    b.id = 'upd'; b.className = 'toast'; b.setAttribute('role', 'status');
    b.innerHTML = '<span>Có bản mới của app.</span><button>Tải lại</button>';
    b.querySelector('button')!.onclick = () => location.reload();
    document.body.append(b);
  } catch { /* mất mạng: thử lại lần sau */ }
}
checkUpdate();
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
