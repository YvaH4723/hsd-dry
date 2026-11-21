// File Stock On Hand (D365, xuất từ hệ thống cửa hàng): mỗi sản phẩm nhiều dòng (theo kho, theo Batch ID).
// Chỉ lấy hàng của quầy Dry: Dry Food (nhóm 101) và Non-Food. Bỏ Fresh, Beverage, thu ngân, lounge, POSM, đồ dùng nội bộ.
import { unaccent } from './cadencia.ts';

export const STOCK_COL = 'Product ID';
export interface StockItem { ax: string; name: string; nameSearch: string; vendorCode: string; group: string; category: string; qty: number }
export interface StockFile { items: StockItem[]; warehouses: string[]; truncated: boolean; other: number }

const txt = (v: unknown) => String(v ?? '').trim();
const name = (v: unknown) => txt(v).replace(/^\d+\s*-\s*/, '');                  // "10101 - SWEET GROCERY" → "SWEET GROCERY"
export const isDry = (l1: string, l2: string) =>
  /^101\b/.test(l2) || (/NON[\s-]?FOOD|HPC|HOUSEHOLD|PERSONAL CARE|HEALTH.*BEAUTY/i.test(l1) && !/CASHIER|LOUNGE/i.test(l2));

export function parseStock(rows: Record<string, unknown>[], wh: string): StockFile {
  const by = new Map<string, StockItem>(), whs = new Set<string>();
  let truncated = false, other = 0;
  for (const r of rows) {
    const w = txt(r['Warehouse ID']), ax = txt(r[STOCK_COL]).toUpperCase();
    if (/exceeded|omitted/i.test(w)) truncated = true;
    if (!ax) continue;
    whs.add(w);
    if (w !== wh) continue;
    const l1 = txt(r['Category Name Level 1']), l2 = txt(r['Category Name Level 2']), l3 = txt(r['Category Name Level 3']);
    if (!isDry(l1, l2)) { other++; continue; }
    const q = Number(r['Physical Inventory Quantity']) || 0;
    const it = by.get(ax);
    if (it) { it.qty += q; continue; }
    const n = txt(r['Product Name']);
    by.set(ax, { ax, name: n, nameSearch: unaccent(n), vendorCode: txt(r['Vendor ID']).replace(/\s+/g, '').toUpperCase(),
      group: /SWEET/i.test(l3) ? 'sweet' : /SALTY/i.test(l3) ? 'salty' : '', category: name(l3) || name(l2), qty: q });
  }
  const items = [...by.values()];
  items.forEach(i => { i.qty = Math.round(i.qty * 1000) / 1000; });             // 13.000000000000002 → 13
  return { items, warehouses: [...whs].sort(), truncated, other };
}
