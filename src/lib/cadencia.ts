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
  const price = r['Price'] == null || r['Price'] === '' ? null : Math.round(Number(String(r['Price']).replace(/[,\s]/g, '')));
  return {
    ax: String(r['AX Code'] ?? '').trim().toUpperCase(), name, nameSearch: unaccent(name),
    brand: String(r['Brand Name'] ?? '').trim(),
    vendorCode: normVendor(r['Vendor']), vendorName: String(r['Suppliers'] ?? '').trim(),
    price: Number.isFinite(price) ? price : null,
    group: sub.startsWith('10101') ? 'sweet' : sub.startsWith('10102') ? 'salty' : null,
    category: stripCode(r['Category']), barcodes: barcodesOf(r['Bar Code']),
  };
}

export interface Existing { id?: string; ax: string; name: string; brand?: string | null; price: number | null; vendorCode: string; active: boolean; keep?: boolean; category?: string | null }
export interface Preview {
  mode?: 'gtb' | 'tb'; skipped?: number;
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
    if (seenAx.has(it.ax)) return p.errors.push({ row, reason: `AX Code ${it.ax} lặp` });
    seenAx.add(it.ax);                       // có trong file thì không bị ẩn, kể cả khi dòng đó lỗi
    if (!it.name) return p.errors.push({ row, reason: 'Thiếu tên' });
    const clash = it.barcodes.find(b => seenBc.has(b));
    if (clash) return p.errors.push({ row, reason: `Mã vạch ${clash} trùng với ${seenBc.get(clash)}` });
    it.barcodes.forEach(b => seenBc.set(b, it.ax || it.name));
    const e = old.get(it.ax);
    if (!e) return p.added.push(it);
    if (!it.brand && e.brand) it.brand = e.brand;   // file để trống nhãn thì giữ nhãn đã đặt tay (vd. Monge → điều khoản 1 năm)
    const changes = [
      e.name !== it.name && 'tên', e.price !== it.price && 'giá', e.vendorCode !== it.vendorCode && 'NCC', e.brand != null && (e.brand || '') !== (it.brand || '') && 'nhãn', !!it.category && (e.category || '') !== it.category && 'nhóm', !e.active && 'bán lại',
    ].filter(Boolean) as string[];
    changes.length ? p.updated.push({ item: it, changes }) : p.unchanged++;
  });
  // Chỉ ẩn trong các nhóm hàng (Category) mà file này có: file Dry Salt/Sweet không ẩn hàng DHP/NF và ngược lại.
  // Sản phẩm chuyển từ ExpiryDay / tạo trong app (keep) không bị ẩn dù không có trong file.
  const cats = new Set(rows.map(r => mapRow(r).category).filter(Boolean));
  p.hidden = existing.filter(e => e.active && !e.keep && !seenAx.has(e.ax) && cats.has(e.category ?? ''));
  return p;
}

// File "Cadencia tổng TB" (cả cửa hàng): Product number = mã AX, không có mã vạch, NCC chỉ có tên.
// Lấy hàng của TẤT CẢ các quầy (dùng app tra giá, quét mã mọi món). File này chỉ BỔ SUNG: thêm sản phẩm app chưa có (để ở trạng thái
// "không có trong Cadencia" như lần gộp trước), điền NCC / giá còn trống. Không sửa tên, không ẩn sản phẩm nào.
export const TB_COL = 'Product number';
export const vendorKey = (s: unknown) => unaccent(String(s ?? '')).replace(/[^a-z0-9]/g, '');
export const tbVendorCode = (name: string) => {
  let h = 0; for (const c of vendorKey(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 'TB-' + h.toString(36).toUpperCase();
};
export function diffTB(rows: Record<string, unknown>[], existing: Existing[], codeOfName: Map<string, string>): Preview {
  const old = new Map(existing.map(e => [e.ax, e]));
  const seen = new Set<string>();
  const p: Preview = { mode: 'tb', skipped: 0, added: [], updated: [], unchanged: 0, hidden: [], errors: [] };
  rows.forEach((r, i) => {
    const row = i + 2;
    const ax = String(r[TB_COL] ?? '').trim().toUpperCase(), name = String(r['Product name'] ?? '').trim();
    if (!ax) return p.errors.push({ row, reason: 'Thiếu mã AX' });
    if (!name) return p.errors.push({ row, reason: 'Thiếu tên' });
    if (seen.has(ax)) return p.errors.push({ row, reason: `Mã AX ${ax} lặp` });
    seen.add(ax);
    const vendorName = String(r['SUPPLIER'] ?? '').trim();
    const price = Math.round(Number(String(r['PRICE'] ?? '').replace(/[,\s]/g, '')));
    const sub = String(r['col6'] ?? '');
    const it: CatalogItem = {
      ax, name, nameSearch: unaccent(name), brand: '', vendorName,
      vendorCode: vendorName ? codeOfName.get(vendorKey(vendorName)) ?? tbVendorCode(vendorName) : '',
      price: Number.isFinite(price) && price > 0 ? price : null,
      group: sub.startsWith('10101') ? 'sweet' : sub.startsWith('10102') ? 'salty' : null, category: stripCode(sub), barcodes: [],
    };
    const e = old.get(ax);
    if (!e) return p.added.push(it);
    const changes = [!e.vendorCode && it.vendorCode && 'thêm NCC', e.price == null && it.price != null && 'thêm giá'].filter(Boolean) as string[];
    if (!changes.length) return p.unchanged++;
    p.updated.push({ item: { ...it, name: e.name, vendorCode: e.vendorCode || it.vendorCode, price: e.price ?? it.price }, changes });
  });
  return p;
}

// Gõ có dấu ("phở") thì chỉ giữ tên đúng dấu, bỏ "phô mai", "Phổ Nhĩ"…; không có món nào đúng dấu thì giữ nguyên.
export function byAccent<T extends { name: string; name_vi?: string | null }>(list: T[], q: string): T[] {
  const low = (x: string) => x.normalize('NFC').toLowerCase(), words = low(q).split(/\s+/).filter(Boolean);
  if (unaccent(q) === q.toLowerCase()) return list;
  const hit = list.filter(p => words.every(w => unaccent(w) === w || low(`${p.name} ${p.name_vi ?? ''}`).includes(w)));
  return hit.length ? hit : list;
}
