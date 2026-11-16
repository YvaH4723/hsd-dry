import { useEffect, useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { unaccent } from '../lib/cadencia.ts';
import { fetchAll, reloadTerms, settingsOf } from '../lib/db.ts';
import { isNet } from '../lib/offline.ts';
import { OWN_BRAND } from '../lib/action.ts';
import Icon from '../components/Icon.tsx';
import { LotsLoading } from '../components/Lot.tsx';

interface T { id: string; vendor_id: string; brand: string | null; product_id: string | null; action: 'return' | 'discount'; days: number | null; raw_text: string | null; needs_review: boolean; source: string }
interface V { id: string; code: string; name: string }
type Mode = 'all' | 'missing' | 'review';
const same = (a: string | null, b: string | null) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
const errText = (e: { message: string }) => isNet(e) ? 'Đang mất mạng: sửa điều khoản cần có mạng.' : 'Lỗi: ' + e.message;

// Tra điều khoản theo tên / mã NCC / nhãn; quản trị viên sửa điều khoản NCC và thêm luật theo nhãn hàng.
export default function Terms({ member }: { member: Member }) {
  const store = member.store_id, admin = member.role === 'admin';
  const [vendors, setVendors] = useState<V[] | null>(null);
  const [terms, setTerms] = useState<T[]>([]);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<Mode>('all');
  const [cfg, setCfg] = useState(settingsOf(null));
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = () => Promise.all([
    fetchAll<V>((a, b) => supabase.from('vendors').select('id,code,name').eq('store_id', store).is('deleted_at', null).order('code').range(a, b)),
    fetchAll<T>((a, b) => supabase.from('terms').select('id,vendor_id,brand,product_id,action,days,raw_text,needs_review,source').eq('store_id', store).is('deleted_at', null).order('id').range(a, b)),
    supabase.from('stores').select('*').eq('id', store).single(),
  ]).then(([v, t, s]) => { setVendors(v); setTerms(t); setCfg(settingsOf(s.data)); setErr(''); }, e => setErr(errText(e)));
  useEffect(() => { load(); }, [store]);

  const main = (v: string) => terms.find(t => t.vendor_id === v && !t.brand && !t.product_id);
  const bad = (t?: T) => !t || t.needs_review || (t.action === 'return' && !t.days);
  const own = (v: V) => OWN_BRAND.has(v.code);          // Ân Nam, Annam Gourmet: luôn dán giảm giá, không cần điều khoản
  const describe = (t?: T) => !t ? `Chưa có điều khoản: tạm dán giảm giá trước HSD ${cfg.discountDays} ngày`
    : t.needs_review || (t.action === 'return' && !t.days) ? 'Cần chọn: ' + (t.raw_text ?? '').replace(/\n/g, ' / ')
    : t.action === 'return' ? `Báo trả trước HSD ${t.days} ngày + ${cfg.returnBuffer} ngày an toàn` : `Không đổi trả: dán giảm giá trước HSD ${cfg.discountDays} ngày`;
  const list = vendors ?? [];
  const missing = list.filter(v => !main(v.id) && !own(v)).length;
  const review = list.filter(v => main(v.id)?.needs_review).length;
  const s = unaccent(q.trim());
  const shown = list.filter(v => {
    const m = main(v.id);
    if (mode === 'review' && !m?.needs_review) return false;
    if (mode === 'missing' && (m || own(v))) return false;
    if (!s) return true;
    const brands = terms.filter(t => t.vendor_id === v.id && t.brand).map(t => t.brand).join(' ');
    return unaccent(`${v.code} ${v.name} ${brands}`).includes(s);
  });

  return (
    <>
      <h2 className="title">Điều khoản đổi trả</h2>
      <div className="search"><Icon name="search" size={18} />
        <input type="search" aria-label="Tìm NCC" placeholder="Tên NCC, mã NCC hoặc nhãn hàng" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="chips" role="group" aria-label="Lọc NCC">
        <button aria-pressed={mode === 'all'} onClick={() => setMode('all')}>Tất cả ({list.length})</button>
        <button aria-pressed={mode === 'missing'} onClick={() => setMode('missing')}><span className="dot warn" />Chưa có điều khoản ({missing})</button>
        <button aria-pressed={mode === 'review'} onClick={() => setMode('review')}><span className="dot warn" />Cần chọn tay ({review})</button>
      </div>
      {err && <p className="msg bad">{err}</p>}
      {vendors == null ? (!err && <LotsLoading />) : !list.length ? <p className="note">Chưa có NCC. Vào Khác → Nhập file → Contact List.</p>
        : !shown.length ? <p className="note">Không có NCC nào khớp.</p> : (
        <div className="list">
          {shown.slice(0, 100).map(v => {
            const m = main(v.id), rules = terms.filter(t => t.vendor_id === v.id && t.brand);
            const body = (
              <div className="grow">
                <div className="lot-name">{v.name}</div>
                <div className="note num">{v.code.startsWith('TB-') ? 'Chưa có mã NCC' : v.code}</div>
                <div className={`act ${bad(m) && !own(v) ? 'warn' : ''}`} style={{ marginTop: 4 }}>{own(v) ? `Hàng Ân Nam / Annam Gourmet: luôn dán giảm giá trước HSD ${cfg.discountDays} ngày` : describe(m)}</div>
                {rules.map(t => <div className="note" key={t.id}>Nhãn {t.brand}: {describe(t)}</div>)}
              </div>
            );
            return (
              <div className="li" key={v.id}>
                {admin ? <button className="li-main" aria-expanded={open === v.id} onClick={() => setOpen(open === v.id ? null : v.id)}>{body}<Icon name={open === v.id ? 'x' : 'edit'} size={18} /></button>
                  : <div className="li-body">{body}</div>}
                {open === v.id && admin && <div className="li-edit"><TermEditor store={store} vendor={v} main={m} done={() => { setOpen(null); load(); }} /></div>}
              </div>
            );
          })}
        </div>
      )}
      {shown.length > 100 && <p className="note">Còn {shown.length - 100} NCC, gõ thêm để lọc.</p>}
    </>
  );
}

// Sửa điều khoản của một NCC (cả NCC hoặc riêng một nhãn hàng). Dùng ở trang Điều khoản và ngay trên thẻ sản phẩm khi quét.
export function TermEditor({ store, vendor, main, done }: { store: string; vendor: V; main?: Pick<T, 'action' | 'days' | 'raw_text'>; done: () => void }) {
  const [rules, setRules] = useState<Pick<T, 'id' | 'brand' | 'action' | 'days'>[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [brand, setBrand] = useState('');
  const [action, setAction] = useState<'return' | 'discount'>(main?.action ?? 'return');
  const [days, setDays] = useState(main?.days ? String(main.days) : '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAll<{ brand: string }>((a, b) => supabase.from('products').select('brand').eq('vendor_id', vendor.id).not('brand', 'is', null).order('id').range(a, b))
      .then(data => setBrands([...new Set(data.map(p => p.brand))].sort()), () => {});
    supabase.from('terms').select('id,brand,action,days').eq('store_id', store).eq('vendor_id', vendor.id).is('product_id', null).is('deleted_at', null)
      .then(({ data }) => setRules((data as typeof rules) ?? []));
  }, [vendor.id]);

  const cur = rules.find(r => same(r.brand, brand || null));
  // Đổi "Áp dụng cho": điền sẵn điều khoản đang có của nhãn đó (chưa có thì lấy của cả NCC).
  function pick(b: string) {
    setBrand(b); setMsg('');
    const r = rules.find(x => same(x.brand, b || null)) ?? rules.find(x => !x.brand) ?? main;
    setAction(r?.action ?? 'return'); setDays(r?.days ? String(r.days) : '');
  }

  async function save() {
    const n = parseInt(days);
    if (action === 'return' && !(n > 0)) return setMsg('Nhập số ngày báo trả trước HSD.');
    setBusy(true);
    const row = { action, days: action === 'return' ? n : null, needs_review: false, source: 'manual' };
    const { error } = cur
      ? await supabase.from('terms').update(row).eq('id', cur.id)
      : await supabase.from('terms').insert({ ...row, store_id: store, vendor_id: vendor.id, brand: brand || null });
    setBusy(false);
    if (error) return setMsg(errText(error));
    reloadTerms(); done();
  }
  async function remove() {
    if (!cur || !confirm(`Bỏ luật riêng của nhãn ${brand}? Nhãn này sẽ theo điều khoản của cả NCC.`)) return;
    setBusy(true);
    const { error } = await supabase.from('terms').update({ deleted_at: new Date().toISOString() }).eq('id', cur.id);
    setBusy(false);
    if (error) return setMsg(errText(error));
    reloadTerms(); done();
  }

  return (
    <div className="stack">
      <label className="lbl" htmlFor={'tb' + vendor.id}>Áp dụng cho</label>
      <select id={'tb' + vendor.id} value={brand} onChange={e => pick(e.target.value)}>
        <option value="">Cả NCC {vendor.name}</option>
        {brands.map(b => <option key={b} value={b}>Chỉ nhãn {b}{rules.some(r => same(r.brand, b)) ? ' (đang có luật riêng)' : ''}</option>)}
      </select>
      <div className="seg" role="group" aria-label="Cách xử lý">
        <button type="button" aria-pressed={action === 'return'} onClick={() => setAction('return')}>Báo trả NCC</button>
        <button type="button" aria-pressed={action === 'discount'} onClick={() => setAction('discount')}>Không đổi trả</button>
      </div>
      {action === 'return'
        ? <><label className="lbl" htmlFor={'td' + vendor.id}>Báo trước HSD (ngày)</label>
            <input id={'td' + vendor.id} inputMode="numeric" placeholder="Ví dụ 60 (2 tháng)" value={days} onChange={e => setDays(e.target.value.replace(/\D/g, '').slice(0, 4))} /></>
        : <p className="note">Dán giảm giá theo mốc trong Cài đặt.</p>}
      <div className="actions">
        <button className="pri" disabled={busy} onClick={save}>Lưu</button>
        {brand && cur && <button className="danger" disabled={busy} onClick={remove}>Bỏ luật riêng của nhãn</button>}
      </div>
      {msg && <p className="msg bad">{msg}</p>}
    </div>
  );
}
