import { useEffect, useState } from 'react';
import { supabase } from '../supabase.ts';
import { unaccent } from './cadencia.ts';
import { auditOffline, codeVariants, fetchAll, isNet, localFindByCode, localSearch, localShelves, localTerms } from './offline.ts';
export { BATCH_COLS, codeVariants, fetchAll } from './offline.ts';

export interface Product {
  id: string; ax_code: string | null; name: string; name_vi?: string | null; brand: string | null; price: number | null; active: boolean;
  category: string | null; vendor_id: string | null; no_return: boolean; sanh_dieu: boolean;
  vendors?: { code: string; name: string } | null; barcodes?: { code: string }[];
}
export interface Shelf { id: string; name: string; qr_code: string; sort_order: number }
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
export async function searchByCode(store: string, code: string): Promise<{ data: Product[]; error: { message: string } | null }> {
  const r = await supabase.from('barcodes').select(`products(${PRODUCT_COLS})`).eq('store_id', store).in('code', codeVariants(code)).is('deleted_at', null);
  if (r.error && isNet(r.error)) { const p = await localFindByCode(code); return { data: p ? [p] : [], error: null }; }
  const list = (r.data ?? []).map((b: any) => b.products).filter((p: any, i: number, a: any[]) => p && a.findIndex(x => x?.id === p.id) === i);
  return { data: list, error: r.error };
}

export async function searchProducts(store: string, q: string, limit = 50): Promise<{ data: Product[] | null; error: { message: string } | null }> {
  const s = q.trim().replace(/[,()*%]/g, '');
  const words = unaccent(s).split(/\s+/).join('*');
  const r = await supabase.from('products').select(PRODUCT_COLS).eq('store_id', store).is('deleted_at', null)
    .or(`name_search.ilike.*${words}*,ax_code.ilike.${s}*`).order('active', { ascending: false }).limit(limit);
  if (r.error && isNet(r.error)) return { data: await localSearch(s, limit), error: null };
  return r as any;
}

export const audit = (store: string, batch_id: string, action: string, before: unknown, after: unknown) => { auditOffline(store, batch_id, action, before, after); };

export function useShelves(store: string) {
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const reload = () => supabase.from('shelves').select('id,name,qr_code,sort_order').eq('store_id', store).is('deleted_at', null)
    .order('sort_order').order('name').then(async ({ data, error }) => setShelves(error && isNet(error) ? await localShelves() : (data as Shelf[]) ?? []));
  useEffect(() => { reload(); }, [store]);
  return { shelves, reload };
}

export const money = (n: number | null) => n == null ? '' : Number(n).toLocaleString('vi-VN') + 'đ';

// Điều khoản + cài đặt của cửa hàng (mốc giảm giá, số ngày báo trả sớm cho an toàn).
import { indexTerms, type Cfg, type Term } from './action.ts';
export const settingsOf = (s: any) => ({ discountDays: s?.discount_days ?? 45, returnBuffer: s?.return_buffer_days ?? 5 });
export function useTerms(store: string): (Cfg & { reload: () => void }) | null {
  const [state, setState] = useState<Cfg | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    Promise.all([
      fetchAll<Term>((a, b) => supabase.from('terms').select('vendor_id,brand,product_id,action,days,raw_text,needs_review').eq('store_id', store).is('deleted_at', null).order('id').range(a, b)),
      supabase.from('stores').select('*').eq('id', store).single().then(ok),
    ]).then(([t, s]) => setState({ idx: indexTerms(t), ...settingsOf(s) }), async e => {
      if (!isNet(e)) return;
      const l = await localTerms();
      setState({ idx: indexTerms(l.terms), ...settingsOf(l.store) });
    });
  }, [store, n]);
  return state && { ...state, reload: () => setN(x => x + 1) };
}

// Tên hiển thị: tên tiếng Việt nếu có, không thì tên gốc trong file.
export const pname = (p: { name: string; name_vi?: string | null }) => p.name_vi?.trim() || p.name;
