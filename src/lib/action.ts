import { normVendor } from './terms.ts';
// Tính việc phải làm cho một lô:
//   báo trả NCC: HSD − (N ngày của NCC + số ngày an toàn, mặc định 5)
//   dán giảm giá: HSD − mốc giảm giá (mặc định 45) cho hàng không đổi trả / chưa có điều khoản.
//   chỉ nhắc (watch): không đổi trả, không giảm giá; nhắc khi HSD còn N ngày (ví dụ sữa bột VitaDairy, 10 ngày).
// Điều khoản 3 cấp, cấp dưới đè cấp trên: sản phẩm → nhãn hàng của NCC → NCC.
import { addShelfLife } from './dates.ts';

export interface Term { vendor_id: string; brand: string | null; product_id: string | null; action: 'return' | 'discount' | 'watch'; days: number | null; pct?: number | null; raw_text: string | null; needs_review: boolean }
export interface LotProduct { id: string; brand: string | null; vendor_id: string | null; no_return: boolean; sanh_dieu: boolean; category?: string | null; vendors?: { code: string; name?: string } | null }
export interface Cfg { idx: Map<string, Term>; discountDays: number; returnBuffer: number }
// problem: thiếu thông tin, app tạm tính giảm giá (hiện màu vàng). why: lý do bình thường (không đổi trả, hàng Ân Nam…).
// pct: NCC nhận trả khi lô còn pct% hạn dùng (tính từ NSX đến HSD), thay cho số ngày cố định.
export interface TermInfo { kind: 'return' | 'discount' | 'watch'; days: number | null; pct?: number | null; problem?: string; why?: string; raw?: string | null; level?: 'product' | 'brand' | 'vendor' }
export interface Action { kind: 'return' | 'discount' | 'reminder' | 'watch'; date: string; label?: string; raw?: string | null; why?: string; needMfg?: boolean }

export const OWN_BRAND = new Set(['AFF01', 'SG99']);   // Ân Nam, Annam Gourmet: luôn dán giảm giá
// Sữa bột (mọi NCC): không đổi trả, không giảm giá, nhắc khi HSD còn 10 ngày. Điều khoản riêng của sản phẩm vẫn đè được.
export const WATCH_CATEGORY = /^POWDER MILK$/i, WATCH_DAYS = 10;
// Điều khoản cấp sản phẩm khớp theo sản phẩm, bỏ qua nhãn và NCC (NCC đổi sau khi nhập file vẫn giữ được).
const key = (v: string, brand: string | null, product: string | null) => product ? `p|${product}` : `${v}|${(brand ?? '').trim().toLowerCase()}|`;

export const indexTerms = (terms: Term[]) => new Map(terms.map(t => [key(t.vendor_id, t.brand, t.product_id), t]));
export const termAt = (idx: Map<string, Term>, vendor: string, brand: string | null = null, product: string | null = null) => idx.get(key(vendor, brand, product));

// Thứ tự: cờ của sản phẩm (không đổi trả, Sành Điệu) → điều khoản riêng sản phẩm → sữa bột (chỉ nhắc; điều khoản
// "Chỉ nhắc" của NCC / nhãn đè số ngày) → hàng Ân Nam → điều khoản nhãn → điều khoản NCC.
export function termFor(p: LotProduct, idx: Map<string, Term>): TermInfo {
  if (p.no_return) return { kind: 'discount', days: null, why: 'Sản phẩm đánh dấu không đổi trả' };
  if (p.sanh_dieu) return { kind: 'discount', days: null, why: 'Hàng Sành Điệu' };
  const byProduct = idx.get(key('', null, p.id));
  if (byProduct) return fromTerm(byProduct, 'product');
  const v = p.vendor_id;
  const byBrand = v && p.brand ? idx.get(key(v, p.brand, null)) : undefined, t = byBrand ?? (v ? idx.get(key(v, null, null)) : undefined);
  if (p.category && WATCH_CATEGORY.test(p.category.trim()))
    return t?.action === 'watch' && t.days ? fromTerm(t, byBrand ? 'brand' : 'vendor') : { kind: 'watch', days: WATCH_DAYS, why: 'Sữa bột' };
  if (OWN_BRAND.has(normVendor(p.vendors?.code))) return { kind: 'discount', days: null, why: 'Hàng Ân Nam / Annam Gourmet' };
  if (!v) return { kind: 'discount', days: null, problem: 'Chưa có NCC' };
  if (!t) return { kind: 'discount', days: null, problem: 'Chưa có điều khoản' };
  return fromTerm(t, byBrand ? 'brand' : 'vendor');
}
function fromTerm(t: Term, level: TermInfo['level']): TermInfo {
  if (t.needs_review || (t.action === 'return' && !t.days && !t.pct)) return { kind: 'discount', days: null, problem: 'Cần chọn điều khoản', raw: t.raw_text, level };
  if (t.action === 'watch') return { kind: 'watch', days: t.days ?? WATCH_DAYS, raw: t.raw_text, level };
  return t.action === 'return'
    ? { kind: 'return', days: t.days, pct: t.pct ?? null, raw: t.raw_text, level }
    : { kind: 'discount', days: null, why: 'NCC không đổi trả', raw: t.raw_text, level };
}

// lot.no_return: riêng lô này không đổi trả (ít hàng, NCC không nhận lại): chỉ dán giảm giá, bất kể điều khoản của NCC.
export function actionFor(lot: { expiry_date: string; expiry_note: string | null; no_return?: boolean; mfg_date?: string | null }, p: LotProduct, cfg: Cfg): Action {
  // Lô chuyển từ ExpiryDay chưa có HSD thật: ngày lưu chính là ngày nhắc.
  if (lot.expiry_note === 'action_date') return { kind: 'reminder', date: lot.expiry_date, label: 'Ngày nhắc từ ExpiryDay, chưa có HSD' };
  const before = (n: number) => addShelfLife(lot.expiry_date, -n, 'day');
  if (lot.no_return) return { kind: 'discount', date: before(cfg.discountDays), why: 'Lô này không đổi trả' };
  const t = termFor(p, cfg.idx);
  if (t.kind === 'return' && t.pct) {
    // Còn pct% hạn dùng: HSD − pct% × (HSD − NSX), làm tròn lên (báo sớm hơn), rồi trừ thêm số ngày an toàn.
    const life = lot.mfg_date ? Math.round((Date.parse(lot.expiry_date) - Date.parse(lot.mfg_date)) / 864e5) : 0;
    if (life <= 0) return { kind: 'discount', date: before(cfg.discountDays), label: `Thiếu NSX: NCC nhận trả khi còn ${t.pct}% hạn dùng, nhập NSX để tính ngày báo trả`, needMfg: true };
    return { kind: 'return', date: before(Math.ceil(life * t.pct / 100) + cfg.returnBuffer), raw: t.raw };
  }
  if (t.kind === 'watch') return { kind: 'watch', date: before(t.days!), why: 'Không đổi trả, không giảm giá' };
  return t.kind === 'return'
    ? { kind: 'return', date: before(t.days! + cfg.returnBuffer), raw: t.raw }
    : { kind: 'discount', date: before(cfg.discountDays), label: t.problem, raw: t.problem ? t.raw : undefined };
}

export function describeTerm(t: TermInfo, cfg: Pick<Cfg, 'discountDays' | 'returnBuffer'>): string {
  const lvl = t.level === 'brand' ? ' (theo nhãn hàng)' : t.level === 'product' ? ' (riêng sản phẩm)' : '';
  if (t.kind === 'return' && t.pct) return `Báo trả NCC khi còn ${t.pct}% hạn dùng (tính từ NSX) + ${cfg.returnBuffer} ngày an toàn${lvl}`;
  if (t.kind === 'return') return `Báo trả NCC trước HSD ${t.days} ngày + ${cfg.returnBuffer} ngày an toàn${lvl}`;
  if (t.kind === 'watch') return `Không đổi trả, không giảm giá: nhắc khi HSD còn ${t.days} ngày${lvl}`;
  if (t.problem) return `${t.problem}: tạm dán giảm giá trước HSD ${cfg.discountDays} ngày`;
  return `${t.why}: dán giảm giá trước HSD ${cfg.discountDays} ngày${lvl}`;
}
