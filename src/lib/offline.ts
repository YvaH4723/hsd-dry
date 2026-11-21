// Chạy khi mất mạng:
//  - Bản sao trên máy (IndexedDB): sản phẩm + mã vạch + NCC, điều khoản, kệ, cài đặt cửa hàng, các lô đang theo dõi.
//  - Hàng đợi thay đổi (outbox): thêm/sửa lô và nhật ký. Gửi ngay nếu có mạng, không thì gửi khi có mạng lại.
//  - Lô thêm khi ngoại tuyến có id tạo sẵn trên máy, nên gửi lại nhiều lần cũng không bị trùng.
// Nhập file, sửa điều khoản, sửa sản phẩm, gắn mã vạch vẫn cần mạng.
import { useEffect, useState } from 'react';
import { supabase } from '../supabase.ts';
import { unaccent } from './cadencia.ts';
import type { Product, Shelf } from './db.ts';
import type { Term } from './action.ts';

// ---------- IndexedDB key-value ----------
let dbp: Promise<IDBDatabase> | null = null;
const idb = () => dbp ??= new Promise((ok, fail) => {
  const r = indexedDB.open('hsd-dry', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => { dbp = null; fail(r.error); };
});
async function get<T>(k: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((ok, fail) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
}
async function put(k: string, v: unknown): Promise<void> {
  const db = await idb();
  return new Promise((ok, fail) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => ok(); t.onerror = () => fail(t.error); });
}

// ---------- tiện ích ----------
export const isNet = (e: unknown) => !navigator.onLine || /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(String((e as any)?.message ?? e));
// Phiên đăng nhập hết hạn / chưa đọc lại được: không phải máy chủ từ chối thật, giữ thay đổi lại để gửi sau.
// Lỗi chắc chắn không gửi lại được: dữ liệu/quyền sai (mã Postgres 22/23/42/P0, PGRST1xx/2xx) hoặc lỗi do app tự báo (xung đột, lô mất).
// Còn lại (502/503/504/429, trang lỗi HTML của cổng mạng) là tạm thời.
const final = (e: any) => e?.app || /^(2[23]|42|P0)\w{3}$|^PGRST[12]\d\d$/.test(e?.code ?? '');
const isAuth = (e: any) => /jwt|PGRST30[0-3]|not authenticated|invalid claim/i.test(`${e?.code ?? ''} ${e?.message ?? ''}`) || e?.status === 401;
const NO_SNAPSHOT = 'Đang mất mạng và máy này chưa có dữ liệu. Mở app một lần khi có mạng để tải dữ liệu về máy.';
export const codeVariants = (c: string) => [...new Set([c, '0' + c, c.replace(/^0/, ''), ...(/^\d{11,12}$/.test(c) ? [c.padStart(12, '0'), c.padStart(13, '0')] : [])])].filter(x => x.length >= 6);

export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await page(i, i + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export const BATCH_COLS = 'id,qty,expiry_date,expiry_note,mfg_date,no_return,status,shelf_id,updated_at,created_at,created_by,updated_by,shelves(name),products(id,name,name_vi,ax_code,brand,vendor_id,no_return,sanh_dieu,vendors(code,name))';
const SNAP_PRODUCT_COLS = 'id,ax_code,name,name_vi,name_search,brand,price,active,category,vendor_id,no_return,sanh_dieu,vendors(code,name),barcodes(code)';
const ACTIVE = ['on_shelf', 'discounted', 'return_notified'];

// ---------- trạng thái để hiện trên giao diện ----------
export interface SyncState { online: boolean; pending: number; failed: string[]; syncedAt: number | null; busy: string }
let state: SyncState = { online: typeof navigator === 'undefined' ? true : navigator.onLine, pending: 0, failed: [], syncedAt: null, busy: '' };
const subs = new Set<(s: SyncState) => void>();
const emit = (p: Partial<SyncState>) => { state = { ...state, ...p }; subs.forEach(f => f(state)); };
export function useSync() {
  const [s, setS] = useState(state);
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS); }; }, []);
  return s;
}

// ---------- bản sao dữ liệu ----------
let mem: { products: Product[]; byCode: Map<string, Product>; byAx: Map<string, Product> } | null = null;
async function local() {
  if (mem) return mem;
  const products = (await get<Product[]>('products')) ?? [];
  const byCode = new Map<string, Product>(), byAx = new Map<string, Product>();
  for (const p of products) {
    if (p.ax_code) byAx.set(p.ax_code.toUpperCase(), p);
    for (const b of p.barcodes ?? []) byCode.set(b.code, p);
  }
  return mem = { products, byCode, byAx };
}

export async function refreshSnapshot(store: string) {
  emit({ busy: 'Đang tải dữ liệu về máy…' });
  try {
    const [products, terms, shelves, st] = await Promise.all([
      fetchAll<Product>((a, b) => supabase.from('products').select(SNAP_PRODUCT_COLS).eq('store_id', store).is('deleted_at', null).order('id').range(a, b) as any),
      fetchAll<Term>((a, b) => supabase.from('terms').select('vendor_id,brand,product_id,action,days,pct,raw_text,needs_review').eq('store_id', store).is('deleted_at', null).order('id').range(a, b) as any),
      fetchAll<Shelf>((a, b) => supabase.from('shelves').select('*').eq('store_id', store).is('deleted_at', null).order('sort_order').order('name').range(a, b) as any),
      supabase.from('stores').select('*').eq('id', store).single(),
    ]);
    await Promise.all([put('products', products), put('terms', terms), put('shelves', shelves), put('store', st.data)]);
    await loadBatches(store, {});            // cũng lưu các lô về máy
    mem = null;
    const t = Date.now(); await put('syncedAt', t);
    emit({ syncedAt: t, busy: '' });
  } catch (e: any) {
    emit({ busy: isNet(e) ? '' : 'Lỗi tải dữ liệu: ' + e.message });
  }
}

export async function localFindByCode(raw: string): Promise<Product | null> {
  const { products, byCode, byAx } = await local();
  if (!products.length) throw new Error(NO_SNAPSHOT);
  const c = raw.trim();
  for (const v of codeVariants(c)) { const p = byCode.get(v); if (p) return p; }
  return byAx.get(c.toUpperCase()) ?? byCode.get(c) ?? null;
}
export async function localSearch(q: string, limit = 50): Promise<Product[]> {
  const { products } = await local();
  if (!products.length) throw new Error(NO_SNAPSHOT);
  const words = unaccent(q.trim()).split(/\s+/).filter(Boolean), ax = q.trim().toUpperCase();
  return products.filter(p => (p.ax_code ?? '').toUpperCase().startsWith(ax) || words.every(w => ((p as any).name_search ?? unaccent(p.name)).includes(w)))
    .sort((a, b) => Number(b.active) - Number(a.active)).slice(0, limit);
}
// Danh sách NCC và sản phẩm theo NCC lấy từ bản sao trên máy (khi mất mạng).
export async function localVendors(): Promise<{ id: string; code: string; name: string }[]> {
  const { products } = await local();
  if (!products.length) throw new Error(NO_SNAPSHOT);
  const m = new Map<string, { id: string; code: string; name: string }>();
  for (const p of products) if (p.vendor_id && p.vendors) m.set(p.vendor_id, { id: p.vendor_id, ...p.vendors });
  return [...m.values()];
}
export async function localByVendor(vendorId: string): Promise<Product[]> {
  const { products } = await local();
  if (!products.length) throw new Error(NO_SNAPSHOT);
  return products.filter(p => p.vendor_id === vendorId);
}
// Sản phẩm chưa có mã vạch (từ bản lưu trên máy): đang bán, và hàng khu Dry chỉ có trong file tổng TB.
export async function localNoCode(): Promise<Product[]> {
  const { products } = await local();
  if (!products.length) throw new Error(NO_SNAPSHOT);
  return products.filter(p => !p.barcodes?.length && (p.active || /^TB\b/.test(p.category ?? '')));
}
// Vừa gắn mã có mạng: ghi luôn vào bản lưu trên máy để quét lúc mất mạng / Chưa có mã vạch thấy ngay, khỏi chờ tải lại.
export async function localAddCodes(id: string, codes: string[]) {
  const products = (await get<Product[]>('products')) ?? [];
  const p = products.find(x => x.id === id);
  if (!p) return;
  p.barcodes = [...(p.barcodes ?? []), ...codes.map(code => ({ code }))];
  await put('products', products); mem = null;
}
export const saveTerms = (terms: Term[], store: unknown) => Promise.all([put('terms', terms), put('store', store)]);
export const localTerms = async () => ({ terms: (await get<Term[]>('terms')) ?? [], store: await get<any>('store') });
export const localShelves = async () => (await get<Shelf[]>('shelves')) ?? [];

// ---------- hàng đợi thay đổi ----------
export type Op =
  | { opId: string; kind: 'insert'; table: 'batches'; row: Record<string, unknown>; view: any }
  | { opId: string; kind: 'update'; table: 'batches'; id: string; patch: Record<string, unknown>; view?: Record<string, unknown>; base?: string }
  | { opId: string; kind: 'incr'; table: 'batches'; id: string; n: number; view?: Record<string, unknown> }
  | { opId: string; kind: 'audit'; row: Record<string, unknown> };

let lock: Promise<unknown> = Promise.resolve();
function withOutbox<T>(fn: (box: Op[]) => Promise<[Op[], T]> | [Op[], T]): Promise<T> {
  const run = lock.then(async () => {
    const [box, out] = await fn((await get<Op[]>('outbox')) ?? []);
    await put('outbox', box);
    emit({ pending: box.filter(o => o.kind !== 'audit').length });
    return out;
  });
  lock = run.catch(() => {});
  return run;
}

// Chống ghi đè: mỗi lần sửa gửi kèm updated_at của lô lúc mở (base). Máy chủ chỉ ghi nếu lô chưa bị ai sửa từ đó,
// trừ những lần sửa do chính máy này (own) để một người sửa liên tiếp không tự báo xung đột.
let own: Record<string, string[]> | null = null;
async function remember(id: string, ts: string) {
  own ??= (await get<Record<string, string[]>>('own')) ?? {};
  own[id] = [...(own[id] ?? []), ts].slice(-5);
  await put('own', own);
}
const hm = (ts: string) => { const d = new Date(ts), p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`; };
async function updateOne(id: string, patch: Record<string, unknown>, base?: string) {
  own ??= (await get<Record<string, string[]>>('own')) ?? {};
  let q = supabase.from('batches').update(patch).eq('id', id);
  if (base) q = q.in('updated_at', [base, ...(own[id] ?? [])]);
  const { data, error } = await q.select('id,updated_at');
  if (error) return { error };
  if (data?.length) { await remember(id, data[0].updated_at); return { error: null }; }
  if (base) {                                                           // 0 dòng: lô bị người khác sửa trước, hay đã mất?
    const { data: cur, error: e2 } = await supabase.from('batches').select('updated_at').eq('id', id).maybeSingle();
    if (e2) return { error: e2 };                                       // rớt mạng giữa chừng: giữ trong hàng đợi, thử lại sau
    if (cur && Object.keys(patch).every(k => k !== 'updated_at') ) {
      const { data: now } = await supabase.from('batches').select(Object.keys(patch).join(',') + ',updated_at').eq('id', id).maybeSingle();
      // Lần gửi trước đã ghi nhưng mất trả lời: máy chủ đã đúng như mình muốn, coi như xong.
      if (now && Object.entries(patch).every(([k, v]) => String((now as any)[k] ?? null) === String(v ?? null))) { await remember(id, (now as any).updated_at); return { error: null }; }
    }
    if (cur) return { error: { app: true, message: `Người khác đã sửa lô này lúc ${hm(cur.updated_at)} nên thay đổi của bạn chưa ghi. Mở lô xem lại, cần thì làm lại` } };
  }
  return { error: { app: true, message: 'Lô không còn trên máy chủ hoặc không có quyền sửa' } };
}
// Cộng dồn số lượng ngay trên máy chủ (qty = qty + n): hai người cùng cộng không mất phần của nhau.
async function incrOne(id: string, n: number, op: string) {
  const { data, error } = await supabase.rpc('add_qty', { p_id: id, p_n: n, p_op: op });   // p_op: gửi lại không cộng hai lần
  if (error) return { error };
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return { error: { app: true, message: 'Lô không còn trên máy chủ hoặc không có quyền sửa' } };
  await remember(id, r.updated_at);
  return { error: null };
}

// Đăng xuất: xóa hàng đợi + bản sao trên máy để người đăng nhập sau không gửi nhầm / xem nhầm.
export async function clearLocal() {
  mem = null; own = null; started = '';
  const db = await idb();
  await new Promise<void>((ok, fail) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = () => ok(); t.onerror = () => fail(t.error); });
}

let flushing: Promise<void> | null = null;
export function flush(): Promise<void> {
  return flushing ??= (async () => {
    if (!navigator.onLine) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;                                          // chưa đăng nhập lại được: giữ nguyên hàng đợi
    for (;;) {
      const op = (await get<Op[]>('outbox'))?.[0];
      if (!op) break;
      const { error } =
        op.kind === 'insert' ? await supabase.from('batches').upsert(op.row, { onConflict: 'id', ignoreDuplicates: true })
        : op.kind === 'update' ? await updateOne(op.id, op.patch, op.base)
        : op.kind === 'incr' ? await incrOne(op.id, op.n, op.opId)
        : await supabase.from('audit_log').insert(op.row);
      if (error && (isNet(error) || isAuth(error) || !final(error))) break;   // mất mạng / phiên hết hạn / máy chủ tạm lỗi: giữ lại, thử sau
      if (error) {                                                      // máy chủ từ chối: bỏ thao tác, báo cho người dùng
        const v: any = op.kind === 'audit' ? null : op.view, nm = v?.products ? (v.products.name_vi || v.products.name) : '';
        const what = op.kind === 'insert' ? `Thêm lô ${nm} · HSD ${op.row.expiry_date} · SL ${op.row.qty}` : op.kind === 'update' ? `Sửa lô ${nm} (${Object.keys(op.patch).join(', ')})` : op.kind === 'incr' ? `Cộng ${op.n} vào lô ${nm}` : 'Nhật ký';
        const f = [...state.failed, `${what}: ${error.message}`];
        await put('failed', f); emit({ failed: f });
      }
      await withOutbox(box => [box.filter(o => o.opId !== op.opId), null]);
    }
  })().finally(() => { flushing = null; });
}

async function enqueue(...ops: Op[]) {
  await withOutbox(box => [[...box, ...ops], null]);
  const left = async () => ((await get<Op[]>('outbox')) ?? []).some(b => ops.some(o => o.opId === b.opId));
  await flush();
  if (await left()) await flush();       // lần gửi trước vừa kết thúc đúng lúc thêm vào: gửi lại một lượt
  return { offline: await left() };
}

const uid = () => crypto.randomUUID();
const auditOp = (store: string, batch_id: string, action: string, before: unknown, after: unknown): Op =>
  ({ opId: uid(), kind: 'audit', row: { store_id: store, batch_id, action, before, after, at: new Date().toISOString() } });

export function addBatchOffline(store: string, row: Record<string, unknown>, view: any) {
  const id = uid(), full = { ...row, id, store_id: store, created_at: new Date().toISOString() };   // thêm lúc mất mạng vẫn đúng ngày thêm
  return enqueue({ opId: uid(), kind: 'insert', table: 'batches', row: full, view: { ...view, id } }, auditOp(store, id, 'add', null, full));
}
export function updateBatchOffline(store: string, id: string, patch: Record<string, unknown>, action: string, before: unknown, view?: Record<string, unknown>, base?: string) {
  return enqueue({ opId: uid(), kind: 'update', table: 'batches', id, patch, view, base }, auditOp(store, id, action, before, patch));
}
export function incrBatchOffline(store: string, id: string, n: number, before: unknown, view?: Record<string, unknown>) {
  return enqueue({ opId: uid(), kind: 'incr', table: 'batches', id, n, view }, auditOp(store, id, 'add_qty', before, { add: n }));
}
export const auditOffline = (store: string, batch_id: string, action: string, before: unknown, after: unknown) => enqueue(auditOp(store, batch_id, action, before, after));

// ---------- đọc lô: máy chủ nếu có mạng, không thì bản sao; luôn phủ thêm thay đổi đang chờ gửi ----------
export async function loadBatches(store: string, f: { shelfId?: string; productId?: string }): Promise<any[]> {
  let rows: any[];
  try {
    rows = await fetchAll<any>((a, b) => {
      let q = supabase.from('batches').select(BATCH_COLS).eq('store_id', store).is('deleted_at', null).in('status', ACTIVE);
      if (f.shelfId) q = q.eq('shelf_id', f.shelfId);
      if (f.productId) q = q.eq('product_id', f.productId);
      return q.order('expiry_date').order('id').range(a, b);
    });
    if (!f.shelfId && !f.productId) await put('batches', rows);
  } catch (e) {
    if (!isNet(e)) throw e;
    const saved = await get<any[]>('batches');
    if (!saved) throw new Error(NO_SNAPSHOT);
    rows = saved;
  }
  return applyOutbox(rows, (await get<Op[]>('outbox')) ?? [], f);
}

export function applyOutbox(rows: any[], box: Op[], f: { shelfId?: string; productId?: string }): any[] {
  const byId = new Map(rows.map(r => [r.id, { ...r }]));
  for (const o of box) {
    if (o.kind === 'insert' && !byId.has(o.view.id)) byId.set(o.view.id, { ...o.view });
    if (o.kind === 'update' && byId.has(o.id)) Object.assign(byId.get(o.id), o.patch, o.view);
    if (o.kind === 'incr' && byId.has(o.id)) byId.get(o.id).qty += o.n;
  }
  return [...byId.values()]
    .filter(r => !r.deleted_at && ACTIVE.includes(r.status) && (!f.shelfId || r.shelf_id === f.shelfId) && (!f.productId || r.products?.id === f.productId))
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || String(a.id).localeCompare(String(b.id)));
}

// ---------- khởi động: gửi hàng đợi, tải bản sao nếu cũ hơn 6 giờ ----------
const STALE = 6 * 3600 * 1000;
let started = '';
export async function startSync(store: string) {
  const [box, failed, syncedAt] = await Promise.all([get<Op[]>('outbox'), get<string[]>('failed'), get<number>('syncedAt')]);
  emit({ pending: (box ?? []).filter(o => o.kind !== 'audit').length, failed: failed ?? [], syncedAt: syncedAt ?? null });
  if (started === store) return;
  // Máy vừa dùng tài khoản cửa hàng khác: bỏ dữ liệu cũ, không gửi nhầm hàng đợi của người trước.
  const owner = await get<string>('owner');
  if (owner && owner !== store) { await clearLocal(); emit({ pending: 0, failed: [], syncedAt: null }); }
  await put('owner', store);
  started = store;
  navigator.storage?.persist?.();
  const go = async () => {
    emit({ online: navigator.onLine });
    if (!navigator.onLine) return;
    await flush();
    if (!state.syncedAt || Date.now() - state.syncedAt > STALE) await refreshSnapshot(store);
  };
  addEventListener('online', go);
  addEventListener('offline', () => emit({ online: false }));
  setInterval(() => { if (state.pending) flush(); }, 60000);
  go();
}
export async function clearFailed() { await put('failed', []); emit({ failed: [] }); }
