// Kiểm tra bộ đọc trên dữ liệu thật (file JSON xuất từ Excel, để NGOÀI repo):
//   node scripts/check-import.ts /đường/dẫn/cadencia.json /đường/dẫn/contact.json
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTerm, resolveVendors } from '../src/lib/terms.ts';
import { barcodesOf, diffCatalog, mapRow, unaccent } from '../src/lib/cadencia.ts';

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
