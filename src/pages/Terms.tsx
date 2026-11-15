import { useEffect, useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { unaccent } from '../lib/cadencia.ts';

interface T { id: string; vendor_id: string; brand: string | null; product_id: string | null; action: 'return' | 'discount'; days: number | null; raw_text: string | null; needs_review: boolean; source: string }
interface V { id: string; code: string; name: string }

const describe = (t?: T) => !t ? 'Chưa có điều khoản (tạm giảm giá)' : t.needs_review || (t.action === 'return' && !t.days) ? 'Cần chọn: ' + (t.raw_text ?? '') : t.action === 'return' ? `Báo trả trước ${t.days} ngày` : 'Không đổi trả: dán giảm giá';

// Tra điều khoản theo tên / mã NCC / nhãn; quản trị viên sửa điều khoản NCC và thêm luật theo nhãn hàng.
export default function Terms({ member }: { member: Member }) {
  const store = member.store_id, admin = member.role === 'admin';
  const [vendors, setVendors] = useState<V[]>([]);
  const [terms, setTerms] = useState<T[]>([]);
  const [q, setQ] = useState('');
  const [onlyReview, setOnlyReview] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = () => Promise.all([
    supabase.from('vendors').select('id,code,name').eq('store_id', store).is('deleted_at', null).order('code').limit(5000),
    supabase.from('terms').select('id,vendor_id,brand,product_id,action,days,raw_text,needs_review,source').eq('store_id', store).is('deleted_at', null).limit(5000),
  ]).then(([v, t]) => { setVendors((v.data as V[]) ?? []); setTerms((t.data as T[]) ?? []); setErr(v.error?.message ?? t.error?.message ?? ''); });
  useEffect(() => { load(); }, [store]);

  const main = (v: string) => terms.find(t => t.vendor_id === v && !t.brand && !t.product_id);
  const s = unaccent(q.trim());
  const shown = vendors.filter(v => {
    const m = main(v.id);
    if (onlyReview && !(m?.needs_review)) return false;
    if (!s) return true;
    const brands = terms.filter(t => t.vendor_id === v.id && t.brand).map(t => t.brand).join(' ');
    return unaccent(`${v.code} ${v.name} ${brands}`).includes(s);
  });

  return (
    <>
      <input placeholder="Tìm tên NCC, mã NCC hoặc nhãn hàng" value={q} onChange={e => setQ(e.target.value)} />
      <div className="chips">
        <button className={!onlyReview ? 'on' : ''} onClick={() => setOnlyReview(false)}>Tất cả ({vendors.length})</button>
        <button className={onlyReview ? 'on' : ''} onClick={() => setOnlyReview(true)}>Cần chọn tay ({terms.filter(t => t.needs_review && !t.brand && !t.product_id).length})</button>
      </div>
      {err && <p className="bad">{err}</p>}
      {!vendors.length && <p className="mute">Chưa có NCC. Vào Nhập file → Nhập điều khoản (Contact List).</p>}
      <div className="card" hidden={!shown.length}>
        {shown.slice(0, 100).map(v => (
          <div className="item" key={v.id}>
            <div className="click" onClick={() => setOpen(open === v.id ? null : v.id)}>
              <div>{v.name} <span className="mute">· {v.code}</span></div>
              <div className={main(v.id)?.needs_review ? 'warn' : 'mute'}>{describe(main(v.id))}</div>
              {terms.filter(t => t.vendor_id === v.id && t.brand).map(t => <div className="mute" key={t.id}>• {t.brand}: {describe(t)}</div>)}
            </div>
            {open === v.id && admin && <Editor store={store} vendor={v} main={main(v.id)} done={() => { setOpen(null); load(); }} />}
          </div>
        ))}
        {shown.length > 100 && <p className="mute">Còn {shown.length - 100} NCC, gõ thêm để lọc.</p>}
      </div>
    </>
  );
}

function Editor({ store, vendor, main, done }: { store: string; vendor: V; main?: T; done: () => void }) {
  const [brand, setBrand] = useState('');
  const [action, setAction] = useState<'return' | 'discount'>(main?.action ?? 'return');
  const [days, setDays] = useState(main?.days ? String(main.days) : '');
  const [brands, setBrands] = useState<string[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    supabase.from('products').select('brand').eq('vendor_id', vendor.id).not('brand', 'is', null).limit(2000)
      .then(({ data }) => setBrands([...new Set((data ?? []).map(p => p.brand as string))].sort()));
  }, [vendor.id]);

  async function save() {
    const n = parseInt(days);
    if (action === 'return' && !(n > 0)) return setMsg('Nhập số ngày báo trả trước HSD.');
    const b = brand.trim() || null;
    const row = { action, days: action === 'return' ? n : null, needs_review: false, source: 'manual' };
    const { data: ex } = await supabase.from('terms').select('id').eq('store_id', store).eq('vendor_id', vendor.id)
      .is('product_id', null).is('deleted_at', null).filter('brand', b ? 'eq' : 'is', b ?? null).maybeSingle();
    const { error } = ex
      ? await supabase.from('terms').update(row).eq('id', ex.id)
      : await supabase.from('terms').insert({ ...row, store_id: store, vendor_id: vendor.id, brand: b });
    error ? setMsg('Lỗi: ' + error.message) : done();
  }

  return (
    <div style={{ marginTop: 8 }}>
      {main?.raw_text && <p className="mute">Câu gốc: {main.raw_text}</p>}
      <label>Áp dụng cho</label>
      <select value={brand} onChange={e => setBrand(e.target.value)}>
        <option value="">Cả NCC</option>
        {brands.map(b => <option key={b} value={b}>Chỉ nhãn {b}</option>)}
      </select>
      <div className="chips">
        <button className={action === 'return' ? 'on' : ''} onClick={() => setAction('return')}>Báo trả NCC</button>
        <button className={action === 'discount' ? 'on' : ''} onClick={() => setAction('discount')}>Không đổi: giảm giá</button>
      </div>
      {action === 'return' && <input inputMode="numeric" placeholder="Số ngày trước HSD (2 tháng = 60)" value={days} onChange={e => setDays(e.target.value.replace(/\D/g, ''))} />}
      <button className="pri" style={{ width: '100%', marginTop: 8 }} onClick={save}>Lưu</button>
      {msg && <p className="bad">{msg}</p>}
    </div>
  );
}
