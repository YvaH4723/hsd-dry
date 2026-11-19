// Kiểm tra bộ đọc trên dữ liệu thật (file JSON xuất từ Excel, để NGOÀI repo):
//   node scripts/check-import.ts /đường/dẫn/cadencia.json /đường/dẫn/contact.json
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTerm, resolveVendors } from '../src/lib/terms.ts';
import { barcodesOf, diffCatalog, mapRow, unaccent } from '../src/lib/cadencia.ts';
import { addShelfLife, daysLeft, parseDmy, whoLine } from '../src/lib/dates.ts';
import { actionFor, indexTerms } from '../src/lib/action.ts';
import { applyOutbox, type Op } from '../src/lib/offline.ts';

// Quy tắc nghiệp vụ trong kế hoạch
const t = (v: unknown) => { const r = parseTerm(v); return r.review ? 'review' : `${r.action}:${r.days}`; };
assert.equal(t('60 days'), 'return:60');
assert.equal(t(60), 'return:60');
assert.equal(t('Yes - 2 months'), 'return:60');
assert.equal(t('Yes (90 days)'), 'return:90');
assert.equal(t('Yes  - 6 months'), 'return:180');
assert.equal(t('No'), 'discount:null');
assert.equal(t('0'), 'discount:null');
assert.equal(t(null), 'discount:null');
assert.equal(t('Yes - Food: 36days - NF: 216 days'), 'return:36');
assert.equal(t('No - Food: 30 days'), 'review');
assert.equal(t('Fresh food: 3 days, Dry food: 90 days'), 'review');
for (const v of ['Yes - 65% remaining', 'Yes', '3 tháng trở lên', 'Fresh milk: 30d\nPowder milk: 90d', '120 days (Monge 1 năm)', 'Yes - < 6 months'])
  assert.equal(t(v), 'review', v);
assert.deepEqual(barcodesOf('Undefined'), []);
assert.deepEqual(barcodesOf('39978009524'), ['39978009524', '039978009524', '0039978009524']);
assert.deepEqual(barcodesOf('680275043935'), ['680275043935', '0680275043935']);
assert.deepEqual(barcodesOf('8934637514673'), ['8934637514673']);
assert.equal(unaccent('Bột mì Đà Lạt'), 'bot mi da lat');
const hs = resolveVendors([
  { code: 'LS0103', name: 'Hương Thủy (Twinings)', category: 'Sweet', term: '90 days' },
  { code: 'LS0103', name: 'Hương Thủy (Anlene)', category: 'Sweet', term: 'No' },
  { code: 'LS0103', name: 'Hương Thủy (Reckitt)', category: 'DHP', term: '30 days' },
]);
assert.equal(hs.length, 1); assert.equal(hs[0].review, true); assert.equal(hs[0].rows.length, 2);
const ff = resolveVendors([{ code: 'X 1', name: 'A', category: 'DHP', term: 'Yes - 60 days' }, { code: 'X1', name: 'A', category: 'Salty', term: 60 }]);
assert.equal(ff[0].review, false); assert.equal(ff[0].days, 60);
assert.equal(parseDmy('300628'), '2028-06-30');
assert.equal(parseDmy('30/06/2028'), '2028-06-30');
assert.equal(parseDmy('310228'), null);
assert.equal(addShelfLife('2026-01-31', 1, 'month'), '2026-02-28');
assert.equal(addShelfLife('2026-03-31', 12, 'month'), '2027-03-31');
assert.equal(addShelfLife('2026-11-15', 45, 'day'), '2026-12-30');
assert.equal(daysLeft('2026-11-20', new Date(2026, 10, 15, 23, 59)), 5);
{
  const T = (brand: string | null, action: 'return' | 'discount', days: number | null, review = false, product: string | null = null) =>
    ({ vendor_id: 'HT', brand, product_id: product, action, days, raw_text: null, needs_review: review });
  const idx = indexTerms([T(null, 'return', 30), T('Twinings', 'return', 90), T('Anlene', 'discount', null), T(null, 'return', 7, false, 'p9')]);
  const P = (brand: string | null, id = 'p1', extra = {}) => ({ id, brand, vendor_id: 'HT', no_return: false, sanh_dieu: false, vendors: { code: 'LS0103' }, ...extra });
  const lot = { expiry_date: '2027-03-31', expiry_note: null };
  const C0 = { idx, discountDays: 45, returnBuffer: 0 }, C5 = { idx, discountDays: 45, returnBuffer: 5 };
  assert.deepEqual(actionFor(lot, P('Twinings'), C0), { kind: 'return', date: '2026-12-31', raw: null });   // nhãn đè NCC
  assert.equal(actionFor(lot, P('Twinings'), C5).date, '2026-12-26');                                       // + 5 ngày an toàn
  assert.equal(actionFor(lot, P('Kewpie'), C0).date, '2027-03-01');                                         // NCC 30 ngày
  assert.equal(actionFor(lot, P('anlene '), C5).kind, 'discount');                                          // không phân biệt hoa thường
  assert.equal(actionFor(lot, P('anlene '), C5).date, '2027-02-14');                                        // giảm giá: không cộng 5
  assert.equal(actionFor(lot, P('Twinings', 'p9'), C0).date, '2027-03-24');                                 // sản phẩm đè nhãn
  assert.equal(actionFor(lot, P(null, 'p1', { vendors: { code: 'AFF01' } }), C5).date, '2027-02-14');       // Ân Nam: giảm giá 45
  assert.equal(actionFor(lot, P(null, 'p1', { vendor_id: 'X' }), C5).label, 'Chưa có điều khoản');
  assert.equal(actionFor(lot, P(null, 'p1', { vendor_id: null }), C5).label, 'Chưa có NCC');
  assert.equal(actionFor(lot, P('Twinings', 'p1', { no_return: true }), C5).kind, 'discount');               // cờ không đổi trả
  assert.equal(actionFor({ expiry_date: '2027-01-01', expiry_note: 'action_date' }, P('Twinings'), C5).date, '2027-01-01');
  assert.equal(actionFor({ ...lot, no_return: true }, P('Twinings'), C5).kind, 'discount');                  // lô không đổi trả: chỉ giảm giá
  assert.equal(actionFor({ ...lot, no_return: true }, P('Twinings'), C5).date, '2027-02-14');                 // HSD − 45, không cộng 5
  assert.equal(actionFor({ ...lot, no_return: false }, P('Twinings'), C0).kind, 'return');                    // tắt: về điều khoản NCC
}
{ // ghép dữ liệu máy chủ với thay đổi đang chờ gửi
  const rows = [{ id: 'a', expiry_date: '2027-02-01', status: 'on_shelf', shelf_id: 'k1', products: { id: 'p1' } },
                { id: 'b', expiry_date: '2027-01-01', status: 'on_shelf', shelf_id: 'k2', products: { id: 'p2' } }];
  const box: Op[] = [
    { opId: '1', kind: 'insert', table: 'batches', row: {}, view: { id: 'n', expiry_date: '2026-12-01', status: 'on_shelf', shelf_id: 'k1', products: { id: 'p1' } } },
    { opId: '2', kind: 'update', table: 'batches', id: 'b', patch: { status: 'sold_out' } },
    { opId: '3', kind: 'update', table: 'batches', id: 'a', patch: { qty: 9, shelf_id: 'k2' }, view: { shelves: { name: 'K2' } } },
    { opId: '4', kind: 'audit', row: {} },
  ];
  const all = applyOutbox(rows, box, {});
  assert.deepEqual(all.map(r => r.id), ['n', 'a']);                     // thêm mới hiện, bán hết biến mất, sắp theo HSD
  assert.equal(all[1].qty, 9); assert.equal(all[1].shelves.name, 'K2');
  assert.deepEqual(applyOutbox(rows, box, { shelfId: 'k1' }).map(r => r.id), ['n']);
  assert.equal(applyOutbox([...rows, { ...box[0].kind === 'insert' ? (box[0] as any).view : {} }], box, {}).length, 2); // đã lên máy chủ: không trùng
}
// Dòng lỗi (trùng mã vạch) vẫn có AX trong file: không được ẩn sản phẩm đó.
{
  const row = (ax: string, bc: string) => ({ 'AX Code': ax, 'Description': 'SP ' + ax, 'Bar Code': bc, 'Category': '101 - X' });
  const ex = ['F1', 'F2'].map(ax => ({ ax, name: 'SP ' + ax, price: null, vendorCode: '', active: true, category: mapRow(row(ax, '')).category }));
  const p = diffCatalog([row('f1', '8930000000011'), row('F2', '8930000000011')], ex);
  assert.deepEqual(p.hidden.map(h => h.ax), []);
  assert.equal(p.errors.length, 1);
}
// Điều khoản cấp sản phẩm thắng dù dòng đó có điền nhãn, và dù NCC của sản phẩm đã đổi.
{
  const cfg = { idx: indexTerms([
    { vendor_id: 'v', brand: null, product_id: null, action: 'return', days: 30, raw_text: null, needs_review: false },
    { vendor_id: 'old', brand: 'Tw', product_id: 'p1', action: 'return', days: 7, raw_text: null, needs_review: false },
  ]), discountDays: 45, returnBuffer: 5 };
  const a = actionFor({ expiry_date: '2027-03-31', expiry_note: null }, { id: 'p1', brand: 'Tw', vendor_id: 'v', no_return: false, sanh_dieu: false, vendors: { code: 'V' } }, cfg);
  assert.equal(a.date, '2027-03-19');
}
// Cộng dồn khi mất mạng hiện ngay trên màn.
assert.equal(applyOutbox([{ id: 'x', qty: 5, status: 'on_shelf', expiry_date: '2027-01-01' }], [{ opId: 'o', kind: 'incr', table: 'batches', id: 'x', n: 2 } as Op], {})[0].qty, 7);
{ // ai thêm, ai sửa
  const N = { a: 'Lan', b: 'Hùng' }, now = new Date(2026, 10, 18);
  assert.equal(whoLine({ created_by: 'a', created_at: '2026-11-18T01:00:00Z' }, N, now), 'Lan thêm 18/11');
  assert.equal(whoLine({ created_by: 'a', created_at: '2026-11-18T01:00:00Z', updated_by: 'b', updated_at: '2026-11-19T01:00:00Z' }, N, now), 'Lan thêm 18/11 · Hùng sửa 19/11');
  assert.equal(whoLine({ created_by: 'a', created_at: '2025-12-30T01:00:00Z', updated_by: 'a', updated_at: '2026-11-19T01:00:00Z' }, N, now), 'Lan thêm 30/12/2025 · sửa 19/11');
  assert.equal(whoLine({ created_by: 'x', created_at: '2026-11-18T01:00:00Z' }, N, now), 'người cũ thêm 18/11');
  assert.equal(whoLine({ created_by: null }, N, now), '');
}
{ // Đánh giá lần 2: "Non-Food" không bị đọc thành "Food"; năm ngoài 2000–2100 bị từ chối.
  const { parseTerm: pt } = await import('../src/lib/terms.ts');
  const { parseDmy: pd } = await import('../src/lib/dates.ts');
  assert.equal(pt('Yes - Non-Food: 216 days - Food: 36 days').days, 36);
  assert.equal(pt('Yes - Food: 36days - NF: 216 days').days, 36);
  assert.equal(pd('30/06/0228'), null);
  assert.equal(pd('300628'), '2028-06-30');
  console.log('Đánh giá 2: OK');
}
console.log('Quy tắc: OK');

const [cadPath, conPath] = process.argv.slice(2);
if (!cadPath) process.exit(0);
const cad: Record<string, unknown>[] = JSON.parse(readFileSync(cadPath, 'utf8')).filter((r: any) => r['AX Code']);
const con: Record<string, unknown>[] = JSON.parse(readFileSync(conPath, 'utf8')).filter((r: any) => r['VENDOR CODE']);

const first = diffCatalog(cad, []);
console.log(`Cadencia lần đầu: thêm ${first.added.length}, lỗi ${first.errors.length}`, first.errors.slice(0, 5));
const items = cad.map(mapRow);
const again = diffCatalog(cad, items.map(i => ({ ax: i.ax, name: i.name, price: i.price, vendorCode: i.vendorCode, active: true })));
assert.equal(again.added.length + again.updated.length + again.hidden.length, 0, 'nhập lại cùng file phải không đổi');
console.log(`Nhập lại cùng file: không đổi ${again.unchanged}`);
console.log(`Không có mã vạch: ${items.filter(i => !i.barcodes.length).length}, có bản thêm số 0 (UPC): ${items.filter(i => i.barcodes.length > 1).length}`);

const vendors = resolveVendors(con.map(r => ({ code: r['VENDOR CODE'], name: r['VENDOR NAME'], category: r['CATEGORY'], term: r['Đổi trả hàng'] })));
const known = new Set(vendors.map(v => v.code));
const missing = new Set(items.map(i => i.vendorCode).filter(c => !known.has(c)));
const review = vendors.filter(v => v.review);
console.log(`NCC trong Contact List: ${vendors.length} — báo trả ${vendors.filter(v => !v.review && v.action === 'return').length}, giảm giá ${vendors.filter(v => !v.review && v.action === 'discount').length}, cần xem ${review.length}`);
console.log(`NCC của Cadencia không có điều khoản: ${missing.size} (${items.filter(i => missing.has(i.vendorCode)).length} SP)`);
console.log('\nCẦN XEM:\n' + review.map(v => `- ${v.code} | ${v.raw.replace(/\n/g, ' / ')}`).join('\n'));
