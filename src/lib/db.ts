import { useEffect, useState } from 'react';
import { supabase } from '../supabase.ts';
import { unaccent } from './cadencia.ts';

export interface Product {
  id: string; ax_code: string | null; name: string; name_vi?: string | null; brand: string | null; price: number | null; active: boolean;
  category: string | null; vendor_id: string | null; no_return: boolean; sanh_dieu: boolean;
  vendors?: { code: string; name: string } | null; barcodes?: { code: string }[];
}
export interface Shelf { id: string; name: string; qr_code: string; sort_order: number }
export const PRODUCT_COLS = 'id,ax_code,name,name_vi,brand,price,active,category,vendor_id,no_return,sanh_dieu,vendors(code,name),barcodes(code)';

// Mã đọc từ camera có thể là 12 số (UPC) trong khi file lưu 13 số, hoặc ngược lại.
export const codeVariants = (c: string) => [...new Set([c, '0' + c, c.replace(/^0/, '')])].filter(x => x.length >= 6);

export async function findByCode(store: string, raw: string): Promise<Product | null> {
  const c = raw.trim();
  if (/^\d{6,14}$/.test(c)) {
    const { data } = await supabase.from('barcodes').select(`products(${PRODUCT_COLS})`).eq('store_id', store).in('code', codeVariants(c)).is('deleted_at', null).limit(1);
    if (data?.[0]) return (data[0] as any).products;
  }
  const { data } = await supabase.from('products').select(PRODUCT_COLS).eq('store_id', store).ilike('ax_code', c.replace(/[%_*,()]/g, '')).is('deleted_at', null).limit(1);
  if (data?.[0]) return data[0] as unknown as Product;
  if (!/^\d+$/.test(c)) {
    const { data: b } = await supabase.from('barcodes').select(`products(${PRODUCT_COLS})`).eq('store_id', store).eq('code', c).is('deleted_at', null).limit(1);
    if (b?.[0]) return (b[0] as any).products;
  }
  return null;
}

export async function searchProducts(store: string, q: string, limit = 50) {
  const s = q.trim().replace(/[,()*%]/g, '');
  const words = unaccent(s).split(/\s+/).join('*');
  return supabase.from('products').select(PRODUCT_COLS).eq('store_id', store).is('deleted_at', null)
    .or(`name_search.ilike.*${words}*,ax_code.ilike.${s}*`).order('active', { ascending: false }).limit(limit);
}

export const audit = (store: string, batch_id: string, action: string, before: unknown, after: unknown) =>
  supabase.from('audit_log').insert({ store_id: store, batch_id, action, before, after }).then(() => {});

export function useShelves(store: string) {
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const reload = () => supabase.from('shelves').select('id,name,qr_code,sort_order').eq('store_id', store).is('deleted_at', null)
    .order('sort_order').order('name').then(({ data }) => setShelves((data as Shelf[]) ?? []));
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
      supabase.from('stores').select('*').eq('id', store).single(),
    ]).then(([t, s]) => setState({ idx: indexTerms(t), ...settingsOf(s.data) }));
  }, [store, n]);
  return state && { ...state, reload: () => setN(x => x + 1) };
}
export const BATCH_COLS = 'id,qty,expiry_date,expiry_note,status,shelf_id,shelves(name),products(id,name,name_vi,ax_code,brand,vendor_id,no_return,sanh_dieu,vendors(code,name))';

// Supabase trả tối đa 1000 dòng mỗi lần: lấy theo trang đến hết. Truy vấn phải có order ổn định.
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await page(i, i + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// Tên hiển thị: tên tiếng Việt nếu có, không thì tên gốc trong file.
export const pname = (p: { name: string; name_vi?: string | null }) => p.name_vi?.trim() || p.name;
