// Nhập tồn kho từ 2 kiểu file xuất của D365:
// - "On-hand inventory" (cột Item number, Warehouse, Physical inventory): đủ hàng của một cửa hàng, KHÔNG có nhóm hàng.
// - "Stock On Hand" (cột Product ID, Warehouse ID, Category Name Level 1-8): có nhóm hàng, hay bị cắt khi xuất nhiều kho.
// Chỉ lấy hàng quầy Dry: Dry Food (nhóm 101) và Non-Food. Bỏ Fresh, Beverage, thu ngân, lounge, POSM, đồ dùng nội bộ.
import { unaccent } from './cadencia.ts';

export const STOCK_COLS = ['Item number', 'Product ID'];
// dry: true/false khi file có nhóm hàng; null khi không có (app tự xét theo danh mục đang có).
export interface StockItem { ax: string; name: string; nameSearch: string; brand: string; vendorCode: string; group: string; category: string; dry: boolean | null; qty: number }
export interface StockFile { items: StockItem[]; warehouses: string[]; truncated: boolean; other: number; hasCat: boolean }
export interface Known { active: boolean; dept_group: string | null }

const txt = (v: unknown) => String(v ?? '').trim();
const name = (v: unknown) => txt(v).replace(/^\d+\s*-\s*/, '');                  // "10101 - SWEET GROCERY" → "SWEET GROCERY"
export const isDry = (l1: string, l2: string) =>
  /^101\b/.test(l2) || (/NON[\s-]?FOOD|HPC|HOUSEHOLD|PERSONAL CARE|HEALTH.*BEAUTY/i.test(l1) && !/CASHIER|LOUNGE/i.test(l2));
// Mã AX hàng không thực phẩm (H hóa mỹ phẩm, đồ nhà; C, E, O hàng gia dụng, pin…) thuộc quầy Dry. F/B/W/N… không đoán được.
export const NONFOOD_AX = /^[HCEO]/;

export function parseStock(rows: Record<string, unknown>[], wh: string): StockFile {
  const by = new Map<string, StockItem>(), whs = new Set<string>();
  const hasCat = rows.some(r => 'Category Name Level 2' in r);
  let truncated = false, other = 0;
  for (const r of rows) {
    const w = txt(r['Warehouse ID'] ?? r['Warehouse']), ax = txt(r['Product ID'] ?? r['Item number']).toUpperCase();
    if (/exceeded|omitted/i.test(w)) truncated = true;
    if (!ax) continue;
    whs.add(w);
    if (w !== wh) continue;
    const l1 = txt(r['Category Name Level 1']), l2 = txt(r['Category Name Level 2']), l3 = txt(r['Category Name Level 3']);
    const dry = hasCat ? isDry(l1, l2) : null;
    if (dry === false) { other++; continue; }
    const q = Number(r['Physical Inventory Quantity'] ?? r['Physical inventory']) || 0;
    const it = by.get(ax);
    if (it) { it.qty += q; continue; }
    // Product name bị cắt ở 60 ký tự; Search name có khi đầy đủ hơn, có khi lại là tên công ty: chỉ dùng khi nó nối tiếp tên.
    const pn = txt(r['Product Name'] ?? r['Product name']), sn = txt(r['Search name']), n = sn.length > pn.length && sn.startsWith(pn) ? sn : pn;
    by.set(ax, { ax, name: n, nameSearch: unaccent(n), brand: txt(r['Brand Description']), dry,
      vendorCode: txt(r['Vendor ID']).replace(/\s+/g, '').toUpperCase(),
      group: /SWEET/i.test(l3) ? 'sweet' : /SALTY/i.test(l3) ? 'salty' : '', category: name(l3) || name(l2), qty: q });
  }
  const items = [...by.values()];
  items.forEach(i => { i.qty = Math.round(i.qty * 1000) / 1000; });             // 13.000000000000002 → 13
  return { items, warehouses: [...whs].sort(), truncated, other, hasCat };
}

// Hàng của quầy mình? File có nhóm hàng thì theo nhóm. Không có thì: sản phẩm đã có trong app và thuộc file Cadencia của quầy
// (active) hoặc nhóm Sweet/Salty; sản phẩm app chưa có thì chỉ nhận hàng không thực phẩm theo mã AX.
export const mine = (i: StockItem, k?: Known) =>
  i.dry ?? (k ? k.active || k.dept_group === 'sweet' || k.dept_group === 'salty' : NONFOOD_AX.test(i.ax));
