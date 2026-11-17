import { useEffect, useState } from 'react';
import { unaccent } from '../lib/cadencia.ts';
import { localFindByCode } from '../lib/offline.ts';
import Scanner from './Scanner.tsx';
import Icon from './Icon.tsx';
import type { LotRow } from './Lot.tsx';

// Tìm lô trong danh sách đang có trên máy (chạy cả khi mất mạng): tên có/không dấu, mã AX, NCC, kệ.
// Gõ hoặc quét mã vạch: tra mã trong danh mục đã lưu trên máy ra sản phẩm, rồi lọc lô của sản phẩm đó.
export function useLotSearch() {
  const [q, setQ] = useState('');
  const [pid, setPid] = useState<string | null>(null);
  const s = unaccent(q.trim());
  useEffect(() => {
    let live = true;
    if (/^\d{6,14}$/.test(q.trim())) localFindByCode(q.trim()).then(p => live && setPid(p?.id ?? null), () => {});
    else setPid(null);
    return () => { live = false; };
  }, [q]);
  const match = (l: LotRow) => {
    if (!s) return true;
    if (pid && l.products.id === pid) return true;
    const p = l.products;
    return unaccent(`${p.name} ${p.name_vi ?? ''} ${p.ax_code ?? ''} ${p.vendors?.code ?? ''} ${p.vendors?.name ?? ''} ${l.shelves?.name ?? ''}`).includes(s);
  };
  return { q, setQ, active: !!s, match };
}

export default function LotSearchBar({ q, setQ }: { q: string; setQ: (q: string) => void }) {
  const [scan, setScan] = useState(false);
  return (
    <div className="lotsearch">
      <div className="row">
        <div className="search grow"><Icon name="search" size={18} />
          <input type="search" enterKeyHint="search" aria-label="Tìm lô theo tên, mã AX, mã vạch, NCC hoặc kệ" placeholder="Tìm tên, mã, NCC, kệ"
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLElement).blur()} />
          {q && <button className="clear" aria-label="Xóa tìm kiếm" onClick={() => setQ('')}><Icon name="x" size={16} /></button>}
        </div>
        <button className={`icon scanbtn ${scan ? 'on' : ''}`} aria-label={scan ? 'Đóng quét mã' : 'Quét mã để tìm'} aria-pressed={scan} onClick={() => setScan(!scan)}>
          <Icon name={scan ? 'x' : 'camera'} size={20} />
        </button>
      </div>
      {scan && <Scanner auto onCode={c => { setQ(c); setScan(false); }} />}
    </div>
  );
}
