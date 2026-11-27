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
assert.equal(t(null), 'review'); assert.equal(t(''), 'review'); assert.equal(t('No'), 'discount:null');
assert.equal(t('Yes - Food: 36days - NF: 216 days'), 'return:36');
assert.equal(t('No - Food: 30 days'), 'review');
assert.equal(t('Fresh food: 3 days, Dry food: 90 days'), 'review');
for (const v of ['Yes', '3 tháng trở lên', 'Fresh milk: 30d\nPowder milk: 90d', '120 days (Monge 1 năm)', 'Yes - < 6 months'])
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
  assert.equal(actionFor({ ...lot, no_return: false }, P('Twinings'), C0).kind, 'return');
  { // % hạn dùng: NSX 20/04/2026, HSD 19/04/2029 (1095 ngày), còn 30% = 329 ngày, + 5 an toàn
    const { parseTerm: pt } = await import('../src/lib/terms.ts');
    assert.equal(pt('30% shelf life').pct, 30); assert.equal(pt('Yes - 65% remaining').pct, 65);
    assert.equal(pt('Yes - 60% expiry date').review, true);                                                  // câu lạ: vẫn cần xem
    const cp = { ...C5, idx: indexTerms([{ vendor_id: 'PS', brand: null, product_id: null, action: 'return', days: null, pct: 30, raw_text: '30% shelf life', needs_review: false }]) };
    const pp = P(null, 'k1', { vendor_id: 'PS' });
    assert.equal(actionFor({ expiry_date: '2029-04-19', expiry_note: null, mfg_date: '2026-04-20' }, pp, cp).date, '2028-05-20');
    assert.equal(actionFor({ expiry_date: '2029-04-19', expiry_note: null }, pp, cp).needMfg, true);          // thiếu NSX: nhắc nhập
  }                    // tắt: về điều khoản NCC
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

// Stock On Hand: chỉ lấy Dry của đúng kho, cộng các dòng theo lô, làm tròn số lẻ.
{
  const { parseStock } = await import('../src/lib/stock.ts');
  const row = (w: string, ax: string, q: number, l1: string, l2: string, l3 = 'NA', v = 'AFF 01') => ({ 'Warehouse ID': w, 'Product ID': ax, 'Product Name': ax + ' name', 'Physical Inventory Quantity': q, 'Vendor ID': v, 'Category Name Level 1': l1, 'Category Name Level 2': l2, 'Category Name Level 3': l3 });
  const s = parseStock([
    row('RGSHN', 'F1', 13.000000000000002, '1 - FOOD', '101 - DRY FOOD', '10101 - SWEET GROCERY'),
    row('RGSHN', 'F1', 2, '1 - FOOD', '101 - DRY FOOD', '10101 - SWEET GROCERY'),
    row('RGSVLB', 'F1', 99, '1 - FOOD', '101 - DRY FOOD', '10101 - SWEET GROCERY'),
    row('RGSHN', 'F2', 5, '1 - FOOD', '102 - FRESH FOOD'),
    row('RGSHN', 'W1', 5, '2 - BEVERAGE', '201 - ALCOHOL AND SPIRITS'),
    row('RGSHN', 'N1', 5, '14 - STORES CONSUMPTION', '1403- CASHIER NG'),
    row('RGSHN', 'H1', 1, '3 - NON FOOD', '301 - HPC', '30101 - BABY CARE'),
    { 'Warehouse ID': 'Exported data exceeded the allowed volume. Some data may have been omitted.' },
  ], 'RGSHN');
  const f1 = s.items.find(i => i.ax === 'F1')!;
  assert.ok(s.items.length === 2 && f1.qty === 15 && f1.group === 'sweet' && f1.category === 'SWEET GROCERY' && f1.vendorCode === 'AFF01', 'stock: Dry + gộp lô');
  assert.ok(s.items.some(i => i.ax === 'H1'), 'stock: lấy Non-Food');
  assert.ok(s.truncated && s.other === 3 && s.warehouses.join() === 'RGSHN,RGSVLB', 'stock: cảnh báo file bị cắt, đếm hàng quầy khác');
  const { mine } = await import('../src/lib/stock.ts');
  const oh = parseStock([
    { 'Item number': 'F9', 'Product name': 'Dry snack', Warehouse: 'RGSTBP', 'Physical inventory': 4, 'Brand Description': 'X' },
    { 'Item number': 'F8', 'Product name': 'Fresh milk', Warehouse: 'RGSTBP', 'Physical inventory': 2 },
    { 'Item number': 'H7', 'Product name': 'Shampoo', Warehouse: 'RGSTBP', 'Physical inventory': 1 },
  ], 'RGSTBP');
  const [f9, f8, h7] = oh.items;
  assert.ok(!oh.hasCat && f9.dry === null && f9.brand === 'X', 'on-hand: không có nhóm hàng');
  assert.ok(mine(f9, { active: false, dept_group: 'sweet' }) && !mine(f8, { active: false, dept_group: null }) && mine(f8, { active: true, dept_group: null }), 'on-hand: theo danh mục app');
  assert.ok(!mine(f8) && mine(h7), 'on-hand: SP mới chỉ nhận hàng không thực phẩm');
  console.log('stock ok');
}

// Chỉ nhắc: không đổi trả, không giảm giá, nhắc khi HSD còn N ngày (không cộng ngày an toàn).
{
  const { actionFor, indexTerms } = await import('../src/lib/action.ts');
  const cfg = { idx: indexTerms([{ vendor_id: 'VD', brand: null, product_id: null, action: 'watch', days: 10, raw_text: null, needs_review: false }]), discountDays: 45, returnBuffer: 5 };
  const p = { id: 'x', brand: null, vendor_id: 'VD', no_return: false, sanh_dieu: false, vendors: { code: 'LS3029' } };
  const a = actionFor({ expiry_date: '2027-01-14', expiry_note: null }, p, cfg);
  assert.ok(a.kind === 'watch' && a.date === '2027-01-04', 'watch: nhắc trước HSD 10 ngày');
  assert.equal(actionFor({ expiry_date: '2027-01-14', expiry_note: null, no_return: true }, p, cfg).kind, 'discount');
  const milk = { ...p, id: 'm', vendor_id: 'OTHER', category: 'POWDER MILK' };
  const b = actionFor({ expiry_date: '2026-12-30', expiry_note: null }, milk, cfg);
  assert.ok(b.kind === 'watch' && b.date === '2026-12-20', 'sữa bột mọi NCC: chỉ nhắc 10 ngày');
  console.log('watch ok');
}
// Bộ đọc EAN dự phòng: mã thật in sát mép nhãn (không có vạch kết thúc, vạch mảnh), đọc từ ảnh chụp camera.
{
  const { decodeRuns } = await import('../src/lib/ean.ts');
  const r = [9, 11, 10, 31, 8, 13, 17, 14, 7, 43, 9, 12, 6, 16, 34, 15, 7, 25, 25, 24, 7, 15, 25, 25, 17, 23, 9, 11, 9, 12, 7, 14, 16, 15, 16, 25, 25, 25, 8, 13, 16, 24, 17, 16, 24, 15, 8, 24, 26, 24, 9, 11, 9, 23, 9, 31, 11, 102];
  assert.equal(decodeRuns(r), '8936091201908');
  assert.equal(decodeRuns([...r].reverse()), null);                       // đọc ngược: không ra mã sai
  assert.equal(decodeRuns(r.map((w, i) => i === 20 ? w + 30 : w)), null); // hỏng một vạch: sai số kiểm tra, bỏ
  // Vạch in mảnh / loang (0.5 – 1.3 module): bù theo vạch mở đầu, không đọc ra mã khác.
  const L = [[3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2], [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2]];
  const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const enc = (code: string, bar: number) => {
    const d = [...code].map(Number), w = [1, 1, 1];
    d.slice(1, 7).forEach((x, i) => w.push(...(PAR[d[0]][i] === 'L' ? L[x] : [...L[x]].reverse())));
    w.push(1, 1, 1, 1, 1); d.slice(7).forEach(x => w.push(...L[x])); w.push(1, 1, 1);
    return w.map((x, k) => Math.round((x + (k % 2 ? 1 - bar : bar - 1)) * 10));
  };
  for (const code of ['8734600100007', '8936091201908', '0012044046272']) for (const bar of [0.5, 0.57, 0.8, 1, 1.3]) assert.equal(decodeRuns(enc(code, bar)), code, `ean ${code} vạch ${bar}`);
  // In loang mực (Tai Tai 190g: khe 1 module gần như bị lấp): một dòng điểm ảnh thật, đếm độ rộng không đọc được, chia 95 ô thì ra.
  const { gridRow, rowRuns } = await import('../src/lib/ean.ts');
  const smear = [210,210,210,210,211,212,212,211,210,210,209,210,211,211,210,210,211,211,210,211,211,210,211,211,211,210,209,209,209,208,208,208,209,209,210,208,193,156,103,67,68,95,133,143,129,116,86,70,92,145,190,213,215,208,205,206,208,207,175,124,71,52,70,121,165,157,122,83,58,59,61,68,86,99,124,140,128,98,70,62,90,142,193,218,222,220,219,215,212,213,213,211,203,181,135,90,63,64,85,115,134,144,130,93,54,51,56,59,80,121,171,212,226,225,218,215,218,218,191,138,78,72,87,102,125,141,142,124,73,53,60,68,64,80,122,182,220,231,229,224,178,112,56,44,53,67,74,81,117,181,226,229,215,189,156,130,90,60,56,62,61,62,67,69,72,90,127,157,170,140,83,53,76,130,180,212,226,227,225,222,214,201,187,159,107,62,63,101,160,193,174,112,68,53,58,62,73,96,124,134,140,131,96,69,77,115,144,142,129,107,71,58,90,147,179,157,107,64,69,100,153,206,228,228,205,165,119,76,57,61,60,62,65,66,69,66,80,124,180,197,161,96,72,71,102,166,219,235,226,207,162,117,82,58,57,59,60,66,71,68,66,82,129,169,177,155,102,63,57,62,58,65,98,143,194,230,232,213,179,138,105,72,58,56,57,65,81,116,159,182,160,103,52,49,60,67,68,69,69,69,74,111,167,216,224,216,185,150,126,99,73,70,108,163,188,165,110,64,47,54,61,61,63,66,69,77,108,163,215,232,222,199,165,140,101,58,65,108,141,147,150,117,74,55,56,54,61,95,144,172,166,133,82,56,57,69,67,68,95,157,207,227,219,198,173,147,105,61,65,119,179,189,166,125,88,70,101,153,201,211,218,221,218,214,212,213,214,214,213,214,216,217,217,217,218,218,218,216,215,215,215,214,213,213,213,213,215,214,214,216];
  assert.equal(decodeRuns(rowRuns(smear)), null);
  assert.equal(gridRow(smear), '8935149551002');
  assert.equal(gridRow([...smear].reverse()), null);   // chiều ngược: không đoán
  console.log('ean ok');
}
const [cadPath, conPath] = process.argv.slice(2);
{ const { byAccent } = await import('../src/lib/cadencia.ts');
  if (byAccent) {
    const L = [{ name: 'Acecook Oyster&Cheese', name_vi: 'Mì vị hàu & phô mai' }, { name: 'Pu-Erh Tea', name_vi: 'Trà Phổ Nhĩ' }, { name: 'Aji Quick Pho Seasoning', name_vi: 'Gia vị phở' }];
    const r = byAccent(L, 'Phở'); if (r.length !== 1 || !r[0].name.startsWith('Aji')) throw new Error('accent ' + JSON.stringify(r));
    if (byAccent(L, 'pho').length !== 3) throw new Error('no accent');
    const M = [{ name: 'Pho Bo Noodle' }, { name: 'X', name_vi: 'Trà hòa an' }, { name: 'Y', name_vi: 'Sữa khoẻ' }, { name: 'Z', name_vi: 'phô mai' }];
    const k = (q: string) => byAccent(M, q).map(p => p.name).join();
    if (k('phở') !== 'Pho Bo Noodle' || k('hoà') !== 'X' || k('hò') !== 'X' || k('khỏe') !== 'Y' || k('thúy') !== k('pho')) throw new Error('accent2 ' + [k('phở'), k('hoà'), k('hò'), k('khỏe')]);
    const N = [{ name: 'Pu-Erh', name_vi: 'Trà Phổ Nhĩ' }, { name: 'Cheese', name_vi: 'Phô mai' }, { name: 'Tomato Sauce' }, { name: 'Tôm khô' }, { name: 'Fresh Milk' }, { name: 'Mì gói' }];
    const g = (q: string) => byAccent(N, q).map(p => p.name).join();
    if (g('phô') !== 'Cheese' || g('tôm') !== 'Tôm khô' || g('mì') !== 'Mì gói') throw new Error('accent3 ' + [g('phô'), g('tôm'), g('mì')]);
    console.log('accent ok');
  } }

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


