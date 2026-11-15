// Tính việc phải làm cho một lô: báo trả NCC (HSD − N) hoặc dán giảm giá (HSD − mốc giảm giá).
// Điều khoản 3 cấp, cấp dưới đè cấp trên: sản phẩm → nhãn hàng của NCC → NCC.
import { addShelfLife } from './dates.ts';

export interface Term { vendor_id: string; brand: string | null; product_id: string | null; action: 'return' | 'discount'; days: number | null; raw_text: string | null; needs_review: boolean }
export interface LotProduct { id: string; brand: string | null; vendor_id: string | null; no_return: boolean; sanh_dieu: boolean; vendors?: { code: string } | null }
export interface Action { kind: 'return' | 'discount' | 'reminder'; date: string; label?: string; raw?: string | null }

const OWN_BRAND = new Set(['AFF01', 'SG99']);   // Ân Nam, Annam Gourmet: luôn dán giảm giá
const key = (v: string, brand: string | null, product: string | null) => `${v}|${(brand ?? '').trim().toLowerCase()}|${product ?? ''}`;

export const indexTerms = (terms: Term[]) => new Map(terms.map(t => [key(t.vendor_id, t.brand, t.product_id), t]));

export function actionFor(lot: { expiry_date: string; expiry_note: string | null }, p: LotProduct, idx: Map<string, Term>, discountDays: number): Action {
  // Lô chuyển từ ExpiryDay chưa có HSD thật: ngày lưu chính là ngày nhắc.
  if (lot.expiry_note === 'action_date') return { kind: 'reminder', date: lot.expiry_date, label: 'Ngày nhắc từ ExpiryDay, chưa có HSD' };
  const before = (n: number) => addShelfLife(lot.expiry_date, -n, 'day');
  const discount = (label?: string, raw?: string | null): Action => ({ kind: 'discount', date: before(discountDays), label, raw });
  if (p.no_return || p.sanh_dieu || OWN_BRAND.has(p.vendors?.code ?? '')) return discount();
  const v = p.vendor_id;
  const t = v ? idx.get(key(v, null, p.id)) ?? (p.brand ? idx.get(key(v, p.brand, null)) : undefined) ?? idx.get(key(v, null, null)) : undefined;
  if (!t) return discount('Chưa có điều khoản');
  if (t.needs_review || (t.action === 'return' && !t.days)) return discount('Cần chọn điều khoản', t.raw_text);
  return t.action === 'return' ? { kind: 'return', date: before(t.days!), raw: t.raw_text } : discount();
}
