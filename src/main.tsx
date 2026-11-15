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
    return c.addAll([...new Set([base, ...urls])]);
  }).catch(() => {});
}
