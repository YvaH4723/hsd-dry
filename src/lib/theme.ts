// Sáng / tối: 'auto' theo cài đặt điện thoại, hoặc chọn tay. index.html đặt sẵn trước khi app chạy để khỏi nháy màu.
export type Theme = 'auto' | 'light' | 'dark';
const KEY = 'hsd.theme';
const mq = matchMedia('(prefers-color-scheme: light)');
export const getTheme = (): Theme => { try { return (localStorage.getItem(KEY) as Theme) || 'auto'; } catch { return 'auto'; } };
export function applyTheme() {
  const m = getTheme(), light = m === 'light' || (m === 'auto' && mq.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', light ? '#f3f5f9' : '#0b1220');
}
export function setTheme(m: Theme) { try { localStorage.setItem(KEY, m); } catch { /* */ } applyTheme(); }
mq.addEventListener?.('change', applyTheme);
