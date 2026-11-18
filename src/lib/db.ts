import { useEffect, useState } from 'react';
import { supabase } from '../supabase.ts';
import { unaccent } from './cadencia.ts';
import { auditOffline, codeVariants, fetchAll, isNet, localByVendor, localFindByCode, localSearch, localShelves, localTerms, localVendors } from './offline.ts';
export { BATCH_COLS, codeVariants, fetchAll } from './offline.ts';

export interface Product {
  id: string; ax_code: string | null; name: string; name_vi?: string | null; brand: string | null; price: number | null; active: boolean;
  category: string | null; vendor_id: string | null; no_return: boolean; sanh_dieu: boolean;
  vendors?: { code: string; name: string } | null; barcodes?: { code: string }[];
}
export interface Shelf { id: string; name: string; qr_code: string; sort_order: number; zone_id?: string | null }
export const PRODUCT_COLS = 'id,ax_code,name,name_vi,brand,price,active,category,vendor_id,no_return,sanh_dieu,vendors(code,name),barcodes(code)';

const ok = <T,>(r: { data: T | null; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; };

// Mất mạng thì tìm trong bản sao trên máy.
export async function findByCode(store: string, raw: string): Promise<Product | null> {
  const c = raw.trim();
  try {
    if (/^\d{6,14}$/.test(c)) {
      const d = ok(await supabase.from('barcodes').select(`products(${PRODUCT_COLS})`).eq('store_id', store).in('code', codeVariants(c)).is('deleted_at', null).limit(1));
      if (d?.[0]) return (d[0] as any).products;
    }
    const d = ok(await supabase.from('products').select(PRODUCT_COLS).eq('store_id', store).ilike('ax_code', c.replace(/[%_*,()]/g, '')).is('deleted_at', null).limit(1));
    if (d?.[0]) return d[0] as unknown as Product;
    if (!/^\d+$/.test(c)) {
      const b = ok(await supabase.from('barcodes').select(`products(${PRODUCT_COLS})`).eq('store_id', store).eq('code', c).is('deleted_at', null).limit(1));
      if (b?.[0]) return (b[0] as any).products;
    }
    return null;
  } catch (e) { if (isNet(e)) return localFindByCode(c); throw e; }
}

// Mọi sản phẩm có mã vạch khớp (mã 12/13 số), mỗi sản phẩm một lần.
type Res = { data: Product[]; error: { message: string } | null };
const fromLocal = async (f: () => Promise<Product[]>): Promise<Res> => {
  try { return { data: await f(), error: null }; } catch (e: any) { return { data: [], error: { message: e.message } }; }
};

export async function searchByCode(store: string, code: string): Promise<Res> {
  const r = await supabase.from('barcodes').select(`products(${PRODUCT_COLS})`).eq('store_id', store).in('code', codeVariants(code)).is('deleted_at', null);
  if (r.error && isNet(r.error)) return fromLocal(async () => { const p = await localFindByCode(code); return p ? [p] : []; });
  const list = (r.data ?? []).map((b: any) => b.products).filter((p: any, i: number, a: any[]) => p && a.findIndex(x => x?.id === p.id) === i);
  return { data: list, error: r.error };
}

// Tìm theo tên (Việt hoặc gốc, không dấu, từ nào trước cũng được) hoặc đầu mã AX.
export async function searchProducts(store: string, q: string, limit = 50, vendorId?: string): Promise<Res> {
  const s = q.trim().replace(/[,()*%"\\]/g, ' ').trim();
  const words = unaccent(s).split(/\s+/).filter(Boolean);
  if (!words.length) return { data: [], error: null };
  const byName = words.map(w => `name_search.ilike.*${w}*`).join(',');
  let qb = supabase.from('products').select(PRODUCT_COLS).eq('store_id', store).is('deleted_at', null);
  if (vendorId) qb = qb.eq('vendor_id', vendorId);
  const r = await qb.or(`and(${byName}),ax_code.ilike.${words[0]}*`).order('active', { ascending: false }).order('name').limit(limit);
  if (r.error && isNet(r.error)) return fromLocal(async () => (await localSearch(s, vendorId ? 100000 : limit)).filter(p => !vendorId || p.vendor_id === vendorId).slice(0, limit));
  return { data: (r.data as unknown as Product[]) ?? [], error: r.error };
}

// NCC và toàn bộ sản phẩm của một NCC (mất mạng thì lấy trong bản sao trên máy).
export interface Vendor { id: string; code: string; name: string }
export async function listVendors(store: string): Promise<Vendor[]> {
  try {
    return await fetchAll<Vendor>((a, b) => supabase.from('vendors').select('id,code,name').eq('store_id', store).is('deleted_at', null).order('name').range(a, b));
  } catch (e) { if (isNet(e)) return (await localVendors()).sort((a, b) => a.name.localeCompare(b.name)); throw e; }
}
export async function vendorProducts(store: string, vendorId: string): Promise<Product[]> {
  const byName = (a: Product, b: Product) => Number(b.active) - Number(a.active) || pname(a).localeCompare(pname(b), 'vi');
  try {
    return (await fetchAll<Product>((a, b) => supabase.from('products').select(PRODUCT_COLS).eq('store_id', store).eq('vendor_id', vendorId).is('deleted_at', null).order('id').range(a, b) as any)).sort(byName);
  } catch (e) { if (isNet(e)) return (await localByVendor(vendorId)).sort(byName); throw e; }
}

export const audit = (store: string, batch_id: string, action: string, before: unknown, after: unknown) => { auditOffline(store, batch_id, action, before, after); };

export function useShelves(store: string) {
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const reload = () => supabase.from('shelves').select('*').eq('store_id', store).is('deleted_at', null)
    .order('sort_order').order('name').then(async ({ data, error }) => setShelves(error && isNet(error) ? await localShelves() : (data as Shelf[]) ?? []));
  useEffect(() => { reload(); }, [store]);
  return { shelves, reload };
}

// Khu (Bánh kẹo, Mỹ phẩm…): lưu thêm trên máy để mất mạng vẫn lọc được.
export interface Zone { id: string; name: string }
const ZONES = 'hsd.zones';
export function useZones(store: string) {
  const [zones, setZones] = useState<Zone[]>(() => { try { return JSON.parse(localStorage.getItem(ZONES) ?? '[]'); } catch { return []; } });
  const reload = () => supabase.from('zones').select('id,name').eq('store_id', store).is('deleted_at', null).order('sort_order').order('name')
    .then(({ data, error }) => { if (error) return; setZones(data as Zone[]); try { localStorage.setItem(ZONES, JSON.stringify(data)); } catch { /* */ } });
  useEffect(() => { reload(); }, [store]);
  return { zones, reload };
}
// Lọc lô theo khu: 'all' | 'mine' (khu của tôi) | id một khu. Lô chưa gắn kệ / kệ chưa có khu: luôn hiện ở "Khu của tôi".
export function zoneFilter(value: string, mine: string[], shelves: Shelf[]) {
  if (value === 'all') return () => true;
  const zoneOf = new Map(shelves.map(s => [s.id, s.zone_id ?? null]));
  const set = new Set(value === 'mine' ? mine : [value]);
  return (l: { shelf_id?: string | null }) => { const z = l.shelf_id ? zoneOf.get(l.shelf_id) ?? null : null; return z ? set.has(z) : value === 'mine'; };
}

// Tên thành viên theo user_id (hiện "ai thêm, ai sửa" ở lô). Tải một lần, lưu trên máy để mất mạng vẫn hiện.
// RLS chỉ cho đọc thành viên cùng cửa hàng nên không cần lọc store.
const NAMES = 'hsd.names';
let names: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem(NAMES) ?? '{}'); } catch { return {}; } })();
let namesP: PromiseLike<unknown> | null = null;
export function useNames() {
  const [, bump] = useState(0);
  useEffect(() => {
    const p = namesP ??= supabase.from('members').select('user_id,name').then(({ data }) => {
      if (!data) { namesP = null; return; }                     // mất mạng: dùng bản đã lưu, lần sau thử lại
      names = Object.fromEntries(data.map(m => [m.user_id, m.name]));
      try { localStorage.setItem(NAMES, JSON.stringify(names)); } catch { /* */ }
    });
    let live = true;
    p.then(() => live && bump(n => n + 1));
    return () => { live = false; };
  }, []);
  return names;
}

export const money = (n: number | null) => n == null ? '' : Number(n).toLocaleString('vi-VN') + 'đ';

// Điều khoản + cài đặt của cửa hàng (mốc giảm giá, số ngày báo trả sớm cho an toàn).
// Tải một lần, mọi màn dùng chung; sửa điều khoản / cài đặt thì gọi reloadTerms().
import { indexTerms, type Cfg, type Term } from './action.ts';
export const settingsOf = (s: any) => ({ discountDays: s?.discount_days ?? 45, returnBuffer: s?.return_buffer_days ?? 5 });
let termsCache: { store: string; at: number; p: Promise<Cfg> } | null = null;
const termSubs = new Set<() => void>();
async function fetchTerms(store: string): Promise<Cfg> {
  try {
    const [t, s] = await Promise.all([
      fetchAll<Term>((a, b) => supabase.from('terms').select('vendor_id,brand,product_id,action,days,raw_text,needs_review').eq('store_id', store).is('deleted_at', null).order('id').range(a, b)),
      supabase.from('stores').select('*').eq('id', store).single().then(ok),
    ]);
    return { idx: indexTerms(t), ...settingsOf(s) };
  } catch (e) {
    if (!isNet(e)) throw e;
    const l = await localTerms();
    return { idx: indexTerms(l.terms), ...settingsOf(l.store) };
  }
}
export function reloadTerms() { termsCache = null; termSubs.forEach(f => f()); }
export function useTerms(store: string): (Cfg & { reload: () => void }) | null {
  const [state, setState] = useState<Cfg | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const bump = () => setN(x => x + 1);
    termSubs.add(bump);
    return () => { termSubs.delete(bump); };
  }, []);
  useEffect(() => {
    if (!termsCache || termsCache.store !== store || Date.now() - termsCache.at > 5 * 60000) termsCache = { store, at: Date.now(), p: fetchTerms(store) };
    let live = true;
    termsCache.p.then(c => live && setState(c), () => { termsCache = null; if (live) setState({ idx: new Map(), ...settingsOf(null) }); });
    return () => { live = false; };
  }, [store, n]);
  return state && { ...state, reload: reloadTerms };
}

// Tên hiển thị: tên tiếng Việt nếu có, không thì tên gốc trong file.
export const pname = (p: { name: string; name_vi?: string | null }) => p.name_vi?.trim() || p.name;
