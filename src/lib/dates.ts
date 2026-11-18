// Ngày lưu dạng 'YYYY-MM-DD' (giờ địa phương), không dùng Date UTC để khỏi lệch ngày.
const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

// Gõ kiểu ddmmyy hoặc ddmmyyyy (có hay không có dấu / . -). Trả null nếu ngày không có thật.
export function parseDmy(s: string): string | null {
  const t = s.replace(/[\s/.-]/g, '');
  const m = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3], mo = +m[2], d = +m[1];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? iso(dt) : null;
}

// HSD = NSX + N ngày hoặc N tháng (tháng theo lịch, như in trên bao bì).
export function addShelfLife(nsx: string, n: number, unit: 'day' | 'month'): string {
  const d = fromIso(nsx);
  if (unit === 'day') d.setDate(d.getDate() + n);
  else { const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
  return iso(d);
}

export const daysLeft = (exp: string, today = new Date()) =>
  Math.round((fromIso(exp).getTime() - fromIso(iso(today)).getTime()) / 86400000);

export const fmt = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };

// "Lan thêm 18/11 · Hùng sửa 19/11" (cùng người: "Lan thêm 18/11 · sửa 19/11"). Khác năm nay thì ghi cả năm.
// Người đã rời cửa hàng: "người cũ". Lô không rõ người thêm (chuyển từ ExpiryDay): bỏ phần "thêm".
export function whoLine(l: { created_by?: string | null; created_at?: string; updated_by?: string | null; updated_at?: string },
  names: Record<string, string>, now = new Date()): string {
  const who = (id?: string | null) => id ? names[id] ?? 'người cũ' : '';
  const day = (s?: string) => { if (!s) return ''; const d = new Date(s), t = fmt(iso(d)); return d.getFullYear() === now.getFullYear() ? t.slice(0, 5) : t; };
  const add = who(l.created_by), edit = who(l.updated_by);
  return [add && `${add} thêm ${day(l.created_at)}`, edit && `${edit === add ? '' : edit + ' '}sửa ${day(l.updated_at)}`].filter(Boolean).join(' · ');
}
