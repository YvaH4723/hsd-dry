// Đọc cột "Đổi trả hàng" của Contact List thành điều khoản.
// Chỉ nhận các kiểu viết rõ ràng (N, N days, N ngày, N months, Yes - N days...). Mọi câu khác vào "Cần xem"
// để người dùng chọn cách tính — không đoán.

export type TermAction = 'return' | 'discount';
export interface ParsedTerm { action: TermAction; days: number | null; pct?: number | null; review: boolean; raw: string }

const DAYS_PER_MONTH = 30;
const SIMPLE = /^\(?(\d+(?:\.\d+)?)\s*(days?|d|ngày|months?|tháng)?\)?$/i;

export const normVendor = (s: unknown) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

export function parseTerm(value: unknown): ParsedTerm {
  const raw = value == null ? '' : String(value).normalize('NFC').trim();
  const s = raw.replace(/\s+/g, ' ');
  if (/^(no|0|)$/i.test(s)) return { action: 'discount', days: null, review: false, raw };
  if (/^no\b/i.test(s)) return { action: 'return', days: null, review: true, raw };

  // "Yes - Food: 36days - NF: 216 days": quầy Dry lấy phần Food
  const food = /\n/.test(raw) ? null : /^yes\b.*?(?<![\w-])Food:\s*(\d+)\s*d/i.exec(s);
  if (food) return +food[1] ? { action: 'return', days: +food[1], review: false, raw } : { action: 'discount', days: null, review: false, raw };

  // "30% shelf life", "Yes - 65% remaining": trả khi còn N% hạn dùng (tính từ NSX). Câu có điều kiện khác vẫn vào Cần xem.
  const pct = /\n/.test(raw) ? null : /^(\d{1,2})\s*%\s*(?:of\s+)?(?:shelf\s*life|remaining|còn lại)?$/i.exec(s.replace(/^yes\b\s*[-–:]?\s*/i, ''));
  if (pct && +pct[1] > 0) return { action: 'return', days: null, pct: +pct[1], review: false, raw };

  const m = /\n/.test(raw) ? null : SIMPLE.exec(s.replace(/^yes\b\s*[-–:]?\s*/i, ''));
  if (!m) return { action: 'return', days: null, review: true, raw };

  const n = +m[1] * (/^(month|tháng)/i.test(m[2] ?? '') ? DAYS_PER_MONTH : 1);
  if (!Number.isInteger(n)) return { action: 'return', days: null, review: true, raw };
  return n === 0 ? { action: 'discount', days: null, review: false, raw } : { action: 'return', days: n, review: false, raw };
}

export interface ContactRow { code: string; name: string; category: string; term: ParsedTerm }
export interface VendorTerm { code: string; name: string; action: TermAction; days: number | null; pct: number | null; review: boolean; raw: string; rows: ContactRow[] }

const DRY = /^(sweet|salty|mix)$/i;

// Gom các dòng cùng mã NCC. Ưu tiên dòng Sweet/Salty/Mix (quầy Dry); chỉ dùng dòng DHP/Non Food khi NCC không có dòng Dry.
// Các dòng Dry khác nhau (thường theo nhãn: Twinings 90, Anlene No) -> cấp NCC vào "Cần xem", giữ đủ câu gốc để tách theo nhãn.
export function resolveVendors(input: { code: unknown; name: unknown; category: unknown; term: unknown }[]): VendorTerm[] {
  const groups = new Map<string, ContactRow[]>();
  for (const r of input) {
    const code = normVendor(r.code);
    if (!code) continue;
    const row = { code, name: String(r.name ?? '').trim(), category: String(r.category ?? '').trim(), term: parseTerm(r.term) };
    groups.set(code, [...(groups.get(code) ?? []), row]);
  }
  return [...groups.values()].map(all => {
    const dry = all.filter(r => DRY.test(r.category));
    const rows = dry.length ? dry : all;
    const keys = new Set(rows.map(r => `${r.term.action}|${r.term.days}|${r.term.pct}|${r.term.review}`));
    const t = rows[0].term;
    const agree = keys.size === 1 && !t.review;
    return {
      code: rows[0].code, name: rows[0].name, rows,
      action: agree ? t.action : 'return', days: agree ? t.days : null, pct: agree ? t.pct ?? null : null, review: !agree,
      raw: agree ? t.raw : rows.map(r => `${r.name}: ${r.term.raw || '(trống)'}`).join('\n'),
    };
  });
}
