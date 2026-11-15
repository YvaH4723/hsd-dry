// Chuẩn hóa một dòng file GTB Cadencia và so với danh mục hiện có để làm màn xem trước nhập file.
import { normVendor } from './terms.ts';

export interface CatalogItem {
  ax: string; name: string; nameSearch: string; brand: string; vendorCode: string; vendorName: string;
  price: number | null; group: 'sweet' | 'salty' | null; category: string; barcodes: string[];
}

export const unaccent = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

const stripCode = (s: unknown) => String(s ?? '').replace(/^\d+\s*-\s*/, '').trim();

// "Undefined" = chưa có mã. Mã 11–12 số (UPC, file hay mất số 0 đầu) lưu thêm bản 12 và 13 số
// để camera đọc ra kiểu nào cũng khớp.
export function barcodesOf(v: unknown): string[] {
  const s = String(v ?? '').trim();
  if (!s || /^undefined$/i.test(s)) return [];
  return /^\d{11,12}$/.test(s) ? [...new Set([s, s.padStart(12, '0'), s.padStart(13, '0')])] : [s];
}

export function mapRow(r: Record<string, unknown>): CatalogItem {
  const name = String(r['Description'] ?? '').trim();
  const sub = String(r['Sub.Department'] ?? '');
  const price = r['Price'] == null || r['Price'] === '' ? null : Math.round(Number(r['Price']));
  return {
    ax: String(r['AX Code'] ?? '').trim(), name, nameSearch: unaccent(name),
    brand: String(r['Brand Name'] ?? '').trim(),
    vendorCode: normVendor(r['Vendor']), vendorName: String(r['Suppliers'] ?? '').trim(),
    price: Number.isFinite(price) ? price : null,
    group: sub.startsWith('10101') ? 'sweet' : sub.startsWith('10102') ? 'salty' : null,
    category: stripCode(r['Category']), barcodes: barcodesOf(r['Bar Code']),
  };
}

export interface Existing { ax: string; name: string; price: number | null; vendorCode: string; active: boolean; keep?: boolean }
export interface Preview {
  added: CatalogItem[]; updated: { item: CatalogItem; changes: string[] }[]; unchanged: number;
  hidden: Existing[]; errors: { row: number; reason: string }[];
}

// Khớp theo AX Code. Nhập lại chỉ đổi tên/giá/NCC (không đụng lô, ảnh, kệ). Không còn trong file -> ẩn, không xóa.
export function diffCatalog(rows: Record<string, unknown>[], existing: Existing[]): Preview {
  const old = new Map(existing.map(e => [e.ax, e]));
  const seenAx = new Set<string>(), seenBc = new Map<string, string>();
  const p: Preview = { added: [], updated: [], unchanged: 0, hidden: [], errors: [] };
  rows.forEach((r, i) => {
    const it = mapRow(r), row = i + 1;
    if (!it.ax) return p.errors.push({ row, reason: 'Thiếu AX Code' });
    if (!it.name) return p.errors.push({ row, reason: 'Thiếu tên' });
    if (it.ax && seenAx.has(it.ax)) return p.errors.push({ row, reason: `AX Code ${it.ax} lặp` });
    const clash = it.barcodes.find(b => seenBc.has(b));
    if (clash) return p.errors.push({ row, reason: `Mã vạch ${clash} trùng với ${seenBc.get(clash)}` });
    seenAx.add(it.ax); it.barcodes.forEach(b => seenBc.set(b, it.ax || it.name));
    const e = old.get(it.ax);
    if (!e) return p.added.push(it);
    const changes = [
      e.name !== it.name && 'tên', e.price !== it.price && 'giá', e.vendorCode !== it.vendorCode && 'NCC', !e.active && 'bán lại',
    ].filter(Boolean) as string[];
    changes.length ? p.updated.push({ item: it, changes }) : p.unchanged++;
  });
  // Sản phẩm chuyển từ ExpiryDay (keep) không bị ẩn dù không có trong file.
  p.hidden = existing.filter(e => e.active && !e.keep && !seenAx.has(e.ax));
  return p;
}
