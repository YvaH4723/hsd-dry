import { useEffect, useState } from 'react';
import { supabase, canWrite, type Member } from '../supabase.ts';
import { searchByCode, searchProducts, useTerms, type Product } from '../lib/db.ts';
import ProductInfo, { ProductRow } from '../components/ProductInfo.tsx';
import BatchList from '../components/BatchList.tsx';
import Icon from '../components/Icon.tsx';

export default function Products({ member, onAdd, rev }: { member: Member; onAdd: (p: Product) => void; rev?: number }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Product[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Product | null>(null);
  const terms = useTerms(member.store_id);

  useEffect(() => {
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', member.store_id).eq('active', true).is('deleted_at', null)
      .then(({ count }) => setTotal(count));
  }, [member.store_id]);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setRows(null); setErr(''); return; }
    let live = true;
    const t = setTimeout(async () => {
      const res = /^\d{6,14}$/.test(s) ? await searchByCode(member.store_id, s) : await searchProducts(member.store_id, s);
      if (!live) return;                       // đã gõ tiếp: bỏ kết quả cũ
      setErr(res.error?.message ?? '');
      setRows(res.data);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, member.store_id]);

  if (open) return (
    <>
      <button className="back" onClick={() => setOpen(null)}><Icon name="back" size={20} />Quay lại</button>
      <div className="panel">
        <ProductInfo p={open} member={member} terms={terms} onChange={p => { setOpen(p); setRows(r => r && r.map(x => x.id === p.id ? p : x)); }} />
      </div>
      {canWrite(member) && <button className="pri block" onClick={() => onAdd(open)}><Icon name="plus" size={18} />Thêm lô cho sản phẩm này</button>}
      <div className="sec"><h2>Lô đang theo dõi</h2></div>
      <BatchList member={member} productId={open.id} rev={rev} />
    </>
  );

  return (
    <>
      <div className="search"><Icon name="search" size={18} />
        <input type="search" enterKeyHint="search" aria-label="Tìm sản phẩm" placeholder="Tên, mã AX hoặc mã vạch" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {err && <p className="msg bad">{err}</p>}
      {rows == null ? (
        <p className="note">
          {total == null ? 'Gõ ít nhất 2 ký tự: tên tiếng Việt hoặc tên gốc (không dấu cũng được), mã AX, mã vạch.'
            : `${total.toLocaleString('vi-VN')} sản phẩm đang bán. Gõ ít nhất 2 ký tự để tìm: tên (không dấu cũng được), mã AX, mã vạch.`}
          {total === 0 && member.role === 'admin' ? ' Chưa có danh mục: vào Khác → Nhập file.' : ''}
        </p>
      ) : !rows.length ? (!err && <p className="note">Không tìm thấy “{q.trim()}”. Thử bớt chữ, hoặc gõ mã AX.</p>)
        : <div className="list">{rows.map(r => <ProductRow key={r.id} p={r} onClick={() => setOpen(r)} />)}</div>}
    </>
  );
}
