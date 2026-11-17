// Tính việc phải làm cho một lô:
//   báo trả NCC: HSD − (N ngày của NCC + số ngày an toàn, mặc định 5)
//   dán giảm giá: HSD − mốc giảm giá (mặc định 45) cho hàng không đổi trả / chưa có điều khoản.
// Điều khoản 3 cấp, cấp dưới đè cấp trên: sản phẩm → nhãn hàng của NCC → NCC.
import { addShelfLife } from './dates.ts';

export interface Term { vendor_id: string; brand: string | null; product_id: string | null; action: 'return' | 'discount'; days: number | null; raw_text: string | null; needs_review: boolean }
export interface LotProduct { id: string; brand: string | null; vendor_id: string | null; no_return: boolean; sanh_dieu: boolean; vendors?: { code: string; name?: string } | null }
export interface Cfg { idx: Map<string, Term>; discountDays: number; returnBuffer: number }
// problem: thiếu thông tin, app tạm tính giảm giá (hiện màu vàng). why: lý do bình thường (không đổi trả, hàng Ân Nam…).
export interface TermInfo { kind: 'return' | 'discount'; days: number | null; problem?: string; why?: string; raw?: string | null; level?: 'product' | 'brand' | 'vendor' }
export interface Action { kind: 'return' | 'discount' | 'reminder'; date: string; label?: string; raw?: string | null }

export const OWN_BRAND = new Set(['AFF01', 'SG99']);   // Ân Nam, Annam Gourmet: luôn dán giảm giá
// Điều khoản cấp sản phẩm khớp theo sản phẩm, bỏ qua nhãn và NCC (NCC đổi sau khi nhập file vẫn giữ được).
const key = (v: string, brand: string | null, product: string | null) => product ? `p|${product}` : `${v}|${(brand ?? '').trim().toLowerCase()}|`;

export const indexTerms = (terms: Term[]) => new Map(terms.map(t => [key(t.vendor_id, t.brand, t.product_id), t]));
export const termAt = (idx: Map<string, Term>, vendor: string, brand: string | null = null, product: string | null = null) => idx.get(key(vendor, brand, product));

export function termFor(p: LotProduct, idx: Map<string, Term>): TermInfo {
  if (p.no_return) return { kind: 'discount', days: null, why: 'Sản phẩm đánh dấu không đổi trả' };
  if (p.sanh_dieu) return { kind: 'discount', days: null, why: 'Hàng Sành Điệu' };
  if (OWN_BRAND.has(p.vendors?.code ?? '')) return { kind: 'discount', days: null, why: 'Hàng Ân Nam / Annam Gourmet' };
  const v = p.vendor_id;
  if (!v) return { kind: 'discount', days: null, problem: 'Chưa có NCC' };
  const byProduct = idx.get(key(v, null, p.id)), byBrand = p.brand ? idx.get(key(v, p.brand, null)) : undefined;
  const t = byProduct ?? byBrand ?? idx.get(key(v, null, null));
  const level = byProduct ? 'product' : byBrand ? 'brand' : 'vendor';
  if (!t) return { kind: 'discount', days: null, problem: 'Chưa có điều khoản' };
  if (t.needs_review || (t.action === 'return' && !t.days)) return { kind: 'discount', days: null, problem: 'Cần chọn điều khoản', raw: t.raw_text, level };
  return t.action === 'return'
    ? { kind: 'return', days: t.days, raw: t.raw_text, level }
    : { kind: 'discount', days: null, why: 'NCC không đổi trả', raw: t.raw_text, level };
}

export function actionFor(lot: { expiry_date: string; expiry_note: string | null }, p: LotProduct, cfg: Cfg): Action {
  // Lô chuyển từ ExpiryDay chưa có HSD thật: ngày lưu chính là ngày nhắc.
  if (lot.expiry_note === 'action_date') return { kind: 'reminder', date: lot.expiry_date, label: 'Ngày nhắc từ ExpiryDay, chưa có HSD' };
  const t = termFor(p, cfg.idx);
  const before = (n: number) => addShelfLife(lot.expiry_date, -n, 'day');
  return t.kind === 'return'
    ? { kind: 'return', date: before(t.days! + cfg.returnBuffer), raw: t.raw }
    : { kind: 'discount', date: before(cfg.discountDays), label: t.problem, raw: t.problem ? t.raw : undefined };
}

export function describeTerm(t: TermInfo, cfg: Pick<Cfg, 'discountDays' | 'returnBuffer'>): string {
  const lvl = t.level === 'brand' ? ' (theo nhãn hàng)' : t.level === 'product' ? ' (riêng sản phẩm)' : '';
  if (t.kind === 'return') return `Báo trả NCC trước HSD ${t.days} ngày + ${cfg.returnBuffer} ngày an toàn${lvl}`;
  if (t.problem) return `${t.problem}: tạm dán giảm giá trước HSD ${cfg.discountDays} ngày`;
  return `${t.why}: dán giảm giá trước HSD ${cfg.discountDays} ngày${lvl}`;
}
