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
  r.onerror = () => fail(r.error);
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
const isAuth = (e: any) => /jwt|PGRST30[0-3]|not authenticated|invalid claim/i.test(`${e?.code ?? ''} ${e?.message ?? ''}`) || e?.status === 401;
const NO_SNAPSHOT = 'Đang mất mạng và máy này chưa có dữ liệu. Mở app một lần khi có mạng để tải dữ liệu về máy.';
export const codeVariants = (c: string) => [...new Set([c, '0' + c, c.replace(/^0/, '')])].filter(x => x.length >= 6);

export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await page(i, i + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export const BATCH_COLS = 'id,qty,expiry_date,expiry_note,status,shelf_id,shelves(name),products(id,name,name_vi,ax_code,brand,vendor_id,no_return,sanh_dieu,vendors(code,name))';
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
      fetchAll<Term>((a, b) => supabase.from('terms').select('vendor_id,brand,product_id,action,days,raw_text,needs_review').eq('store_id', store).is('deleted_at', null).order('id').range(a, b) as any),
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
export const localTerms = async () => ({ terms: (await get<Term[]>('terms')) ?? [], store: await get<any>('store') });
export const localShelves = async () => (await get<Shelf[]>('shelves')) ?? [];

// ---------- hàng đợi thay đổi ----------
export type Op =
  | { opId: string; kind: 'insert'; table: 'batches'; row: Record<string, unknown>; view: any }
  | { opId: string; kind: 'update'; table: 'batches'; id: string; patch: Record<string, unknown>; view?: Record<string, unknown> }
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
        : op.kind === 'update' ? await supabase.from('batches').update(op.patch).eq('id', op.id)
        : await supabase.from('audit_log').insert(op.row);
      if (error && (isNet(error) || isAuth(error))) break;              // mất mạng / phiên hết hạn: giữ lại, thử sau
      if (error) {                                                      // máy chủ từ chối: bỏ thao tác, báo cho người dùng
        const f = [...state.failed, `${op.kind === 'insert' ? 'Thêm lô' : op.kind === 'update' ? 'Sửa lô' : 'Nhật ký'}: ${error.message}`];
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
  const id = uid(), full = { ...row, id, store_id: store };
  return enqueue({ opId: uid(), kind: 'insert', table: 'batches', row: full, view: { ...view, id } }, auditOp(store, id, 'add', null, full));
}
export function updateBatchOffline(store: string, id: string, patch: Record<string, unknown>, action: string, before: unknown, view?: Record<string, unknown>) {
  return enqueue({ opId: uid(), kind: 'update', table: 'batches', id, patch, view }, auditOp(store, id, action, before, patch));
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
