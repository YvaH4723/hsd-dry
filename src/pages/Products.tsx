import { useEffect, useState } from 'react';
import { supabase, canWrite, type Member } from '../supabase.ts';
import { listVendors, searchByCode, searchProducts, useTerms, vendorProducts, type Product, type Vendor } from '../lib/db.ts';
import { unaccent } from '../lib/cadencia.ts';
import ProductInfo, { ProductRow } from '../components/ProductInfo.tsx';
import BatchList from '../components/BatchList.tsx';
import Icon from '../components/Icon.tsx';
import { LotsLoading } from '../components/Lot.tsx';

const SHOW = 200;
const vcode = (v: Vendor) => v.code.startsWith('TB-') ? 'chưa có mã NCC' : v.code;

export default function Products({ member, onAdd, rev }: { member: Member; onAdd: (p: Product) => void; rev?: number }) {
  const store = member.store_id;
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Product[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Product | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [picking, setPicking] = useState(false);
  const [all, setAll] = useState<Product[] | null>(null);       // toàn bộ sản phẩm của NCC đang chọn
  const terms = useTerms(store);

  useEffect(() => {
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', store).eq('active', true).is('deleted_at', null)
      .then(({ count }) => setTotal(count));
  }, [store]);

  // Chọn NCC: tải hết sản phẩm của NCC đó.
  useEffect(() => {
    setAll(null);
    if (!vendor) return;
    let live = true;
    vendorProducts(store, vendor.id).then(d => { if (live) { setAll(d); setErr(''); } }, (e: Error) => live && setErr(e.message));
    return () => { live = false; };
  }, [vendor?.id]);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setRows(null); if (!vendor) setErr(''); return; }
    let live = true;
    const t = setTimeout(async () => {
      const res = /^\d{6,14}$/.test(s) ? await searchByCode(store, s) : await searchProducts(store, s, 50, vendor?.id);
      if (!live) return;                       // đã gõ tiếp: bỏ kết quả cũ
      setErr(res.error?.message ?? '');
      setRows(vendor ? res.data.filter(p => p.vendor_id === vendor.id) : res.data);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, store, vendor?.id]);

  if (picking) return <VendorPicker store={store} pick={v => { setVendor(v); setPicking(false); scrollTo(0, 0); }} back={() => setPicking(false)} />;

  if (open) return (
    <>
      <button className="back" onClick={() => setOpen(null)}><Icon name="back" size={20} />Quay lại</button>
      <div className="panel">
        <ProductInfo p={open} member={member} terms={terms} onChange={p => { setOpen(p); setRows(r => r && r.map(x => x.id === p.id ? p : x)); setAll(r => r && r.map(x => x.id === p.id ? p : x)); }} />
      </div>
      {canWrite(member) && <button className="pri block" onClick={() => onAdd(open)}><Icon name="plus" size={18} />Thêm lô cho sản phẩm này</button>}
      <div className="sec"><h2>Lô đang theo dõi</h2></div>
      <BatchList member={member} productId={open.id} rev={rev} />
    </>
  );

  const list = (ps: Product[]) => (
    <>
      <div className="list">{ps.slice(0, SHOW).map(r => <ProductRow key={r.id} p={r} onClick={() => { setOpen(r); scrollTo(0, 0); }} />)}</div>
      {ps.length > SHOW && <p className="note">Còn {ps.length - SHOW} sản phẩm, gõ thêm để lọc.</p>}
    </>
  );

  return (
    <>
      <div className="search"><Icon name="search" size={18} />
        <input type="search" enterKeyHint="search" aria-label="Tìm sản phẩm" placeholder={vendor ? 'Tìm trong NCC này' : 'Tên, mã AX hoặc mã vạch'} value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {vendor ? (
        <div className="panel row" style={{ padding: '8px 6px 8px 14px' }}>
          <Icon name="truck" size={20} />
          <div className="grow"><div className="lot-name">{vendor.name}</div><div className="note">{vcode(vendor)}{all ? ` · ${all.length} sản phẩm` : ''}</div></div>
          <button className="sm ghost" onClick={() => setPicking(true)}>Đổi</button>
          <button className="icon" aria-label="Bỏ lọc NCC" onClick={() => setVendor(null)}><Icon name="x" /></button>
        </div>
      ) : (
        <button className="block" onClick={() => setPicking(true)}><Icon name="truck" size={18} />Xem theo nhà cung cấp</button>
      )}
      {err && <p className="msg bad">{err}</p>}
      {rows != null ? (rows.length ? list(rows) : !err && <p className="note">Không tìm thấy “{q.trim()}”{vendor ? ' trong NCC này' : ''}. Thử bớt chữ, hoặc gõ mã AX.</p>)
        : vendor ? (all == null ? (!err && <LotsLoading />) : all.length ? list(all) : <p className="note">NCC này chưa có sản phẩm nào trong danh mục.</p>)
        : (
        <p className="note">
          {total == null ? 'Gõ ít nhất 2 ký tự: tên tiếng Việt hoặc tên gốc (không dấu cũng được), mã AX, mã vạch.'
            : `${total.toLocaleString('vi-VN')} sản phẩm đang bán. Gõ ít nhất 2 ký tự để tìm: tên (không dấu cũng được), mã AX, mã vạch.`}
          {total === 0 && member.role === 'admin' ? ' Chưa có danh mục: vào Khác → Nhập file.' : ''}
        </p>
      )}
    </>
  );
}

// Chọn NCC: gõ tên hoặc mã NCC để lọc.
function VendorPicker({ store, pick, back }: { store: string; pick: (v: Vendor) => void; back: () => void }) {
  const [vs, setVs] = useState<Vendor[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { listVendors(store).then(setVs, (e: Error) => setErr(e.message)); }, [store]);
  const s = unaccent(q.trim());
  const shown = (vs ?? []).filter(v => !s || unaccent(`${v.name} ${v.code}`).includes(s));
  return (
    <>
      <button className="back" onClick={back}><Icon name="back" size={20} />Quay lại</button>
      <h2 className="title">Chọn nhà cung cấp</h2>
      <div className="search"><Icon name="search" size={18} />
        <input type="search" autoFocus aria-label="Tìm NCC" placeholder="Tên hoặc mã NCC" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {err && <p className="msg bad">{err}</p>}
      {vs == null ? (!err && <LotsLoading />) : !shown.length ? <p className="note">Không có NCC nào khớp.</p> : (
        <>
          <div className="list">
            {shown.slice(0, SHOW).map(v => (
              <div className="li" key={v.id}>
                <button className="li-main" onClick={() => pick(v)}>
                  <div className="grow"><div className="lot-name">{v.name}</div><div className="note num">{vcode(v)}</div></div>
                  <Icon name="chev" size={18} />
                </button>
              </div>
            ))}
          </div>
          {shown.length > SHOW && <p className="note">Còn {shown.length - SHOW} NCC, gõ thêm để lọc.</p>}
        </>
      )}
    </>
  );
}
