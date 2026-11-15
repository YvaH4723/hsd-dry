import { useEffect, useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { unaccent } from '../lib/cadencia.ts';

interface Row { id: string; ax_code: string | null; name: string; brand: string | null; price: number | null; active: boolean; barcodes: { code: string }[] }
const COLS = 'id,ax_code,name,brand,price,active,barcodes(code)';

export default function Products({ member }: { member: Member }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', member.store_id).eq('active', true)
      .then(({ count }) => setTotal(count));
  }, [member.store_id]);

  useEffect(() => {
    const s = q.trim().replace(/[,()*%]/g, '');
    if (s.length < 2) { setRows([]); return; }
    const t = setTimeout(async () => {
      let res;
      if (/^\d{6,}$/.test(s)) {
        const { data, error } = await supabase.from('barcodes').select(`products(${COLS})`).eq('store_id', member.store_id).eq('code', s).is('deleted_at', null);
        res = { data: (data ?? []).map((b: any) => b.products).filter(Boolean), error };
      } else {
        const words = unaccent(s).split(/\s+/).join('*');
        res = await supabase.from('products').select(COLS).eq('store_id', member.store_id).is('deleted_at', null)
          .or(`name_search.ilike.*${words}*,ax_code.ilike.${s}*`).order('active', { ascending: false }).limit(50);
      }
      setErr(res.error?.message ?? '');
      setRows((res.data as Row[]) ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q, member.store_id]);

  return (
    <>
      <input placeholder="Tìm tên, mã AX hoặc mã vạch" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      <p className="mute">{total == null ? '' : `${total.toLocaleString('vi-VN')} sản phẩm đang bán`}{total === 0 && member.role === 'admin' ? ' — vào tab Nhập file để nhập danh mục Cadencia.' : ''}</p>
      {err && <p className="bad">{err}</p>}
      <div className="card" hidden={!rows.length}>
        {rows.map(r => (
          <div className="item" key={r.id}>
            <div>{r.name} {!r.active && <span className="warn">(đã ẩn)</span>}</div>
            <div className="mute">{[r.ax_code, r.brand, r.price != null && Number(r.price).toLocaleString('vi-VN') + 'đ'].filter(Boolean).join(' · ')}</div>
            <div className="mute">{r.barcodes.map(b => b.code).filter((c, _, all) => !all.some(o => o !== c && c === '0' + o)).join(', ') || 'Chưa có mã vạch'}</div>
          </div>
        ))}
      </div>
      {q.trim().length >= 2 && !rows.length && !err && <p className="mute">Không tìm thấy.</p>}
    </>
  );
}
