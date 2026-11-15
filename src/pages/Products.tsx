import { useEffect, useState } from 'react';
import { supabase, canWrite, type Member } from '../supabase.ts';
import { codeVariants, money, PRODUCT_COLS, searchProducts, useTerms, type Product } from '../lib/db.ts';
import ProductInfo, { showCodes, vendorText } from '../components/ProductInfo.tsx';
import BatchList from '../components/BatchList.tsx';


export default function Products({ member, onAdd }: { member: Member; onAdd: (p: Product) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Product[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Product | null>(null);
  const terms = useTerms(member.store_id);

  useEffect(() => {
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', member.store_id).eq('active', true)
      .then(({ count }) => setTotal(count));
  }, [member.store_id]);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setRows([]); return; }
    const t = setTimeout(async () => {
      const res = /^\d{6,14}$/.test(s)
        ? await supabase.from('barcodes').select(`products(${PRODUCT_COLS})`).eq('store_id', member.store_id).in('code', codeVariants(s)).is('deleted_at', null)
            .then(r => ({ data: (r.data ?? []).map((b: any) => b.products).filter(Boolean), error: r.error }))
        : await searchProducts(member.store_id, s);
      setErr(res.error?.message ?? '');
      setRows((res.data as unknown as Product[]) ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q, member.store_id]);

  if (open) return (
    <>
      <div className="row"><b style={{ flex: 1 }}>Chi tiết</b><button style={{ flex: '0 0 auto' }} onClick={() => setOpen(null)}>Quay lại</button></div>
      <div className="card">
        <ProductInfo p={open} member={member} terms={terms} onChange={p => { setOpen(p); setRows(r => r.map(x => x.id === p.id ? p : x)); }} />
        {canWrite(member) && <button className="pri" style={{ width: '100%', marginTop: 10 }} onClick={() => onAdd(open)}>+ Thêm lô cho sản phẩm này</button>}
      </div>
      <BatchList member={member} productId={open.id} />
    </>
  );

  return (
    <>
      <input placeholder="Tìm tên, mã AX hoặc mã vạch" value={q} onChange={e => setQ(e.target.value)} />
      <p className="mute">{total == null ? '' : `${total.toLocaleString('vi-VN')} sản phẩm đang bán`}{total === 0 && member.role === 'admin' ? ' — vào tab Nhập file để nhập danh mục Cadencia.' : ''}</p>
      {err && <p className="bad">{err}</p>}
      <div className="card" hidden={!rows.length}>
        {rows.map(r => (
          <div className="item click" key={r.id} onClick={() => setOpen(r)}>
            <div>{r.name} {!r.active && <span className="warn">(không có trong Cadencia)</span>}</div>
            <div className="mute">{[r.ax_code, r.brand, money(r.price)].filter(Boolean).join(' · ')}</div>
            <div className="mute">{showCodes(r)}</div>
            <div className="mute">NCC: {vendorText(r)}</div>
          </div>
        ))}
      </div>
      {q.trim().length >= 2 && !rows.length && !err && <p className="mute">Không tìm thấy.</p>}
    </>
  );
}
