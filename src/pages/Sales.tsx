// Hàng bán chạy: ước lượng từ các file tồn kho đã nhập (tồn giảm giữa 2 lần nhập ≈ đã bán; tồn tăng = nhập hàng, bỏ qua).
import { useEffect, useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { fetchAll, isNet } from '../lib/offline.ts';
import { saveXlsx } from '../lib/xlsxSave.ts';
import Icon from '../components/Icon.tsx';

interface Row { product_id: string; ax_code: string | null; name: string; name_vi: string | null; vendor: string | null; stock: number | null; sold: number; span: number }
type Tab = 'top' | 'low' | 'slow';
const COVER = 7;
const SHOW = 200;                    // iPhone: hiện tối đa 200 dòng, còn lại xuất Excel                     // tồn đủ dưới 7 ngày bán = cần đặt
const fmt = (n: number) => n >= 10 ? Math.round(n).toLocaleString('vi-VN') : n.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const rate = (r: Row) => r.span > 0 ? r.sold / r.span : 0;
const cover = (r: Row) => rate(r) > 0 ? Math.max(0, r.stock ?? 0) / rate(r) : Infinity;
const nm = (r: Row) => r.name_vi || r.name;

export default function Sales({ member }: { member: Member }) {
  const store = member.store_id;
  const [days, setDays] = useState(() => Number(localStorage.getItem('hsd.sales-days')) || 14);
  const [tab, setTab] = useState<Tab>('top');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    setRows(null); setErr('');
    fetchAll<Row>((a, b) => supabase.rpc('sales_report', { p_store: store, p_days: days }).range(a, b))
      .then(r => live && setRows(r.map(x => ({ ...x, sold: Number(x.sold), stock: x.stock == null ? null : Number(x.stock) }))))
      .catch(e => live && setErr(isNet(e) ? 'Đang mất mạng: báo cáo cần có mạng.' : 'Lỗi: ' + e.message));
    return () => { live = false; };
  }, [days]);

  const all = rows ?? [], span = Math.max(0, ...all.map(r => r.span));
  const list = tab === 'top' ? all.filter(r => r.sold > 0).sort((a, b) => rate(b) - rate(a)).slice(0, 100)
    : tab === 'low' ? all.filter(r => r.sold > 0 && cover(r) < COVER).sort((a, b) => cover(a) - cover(b) || rate(b) - rate(a))
    : all.filter(r => r.sold === 0 && (r.stock ?? 0) > 0 && r.span >= COVER).sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0));

  async function exportXlsx() {
    const XLSX = await import('xlsx');
    const data = list.map(r => ({ 'Mã sản phẩm': r.ax_code ?? '', 'Tên sản phẩm': nm(r), 'NCC': r.vendor ?? '', 'Tồn': r.stock ?? 0,
      'Đã bán (ước)': r.sold, 'Số ngày': r.span, 'Bán/ngày': Math.round(rate(r) * 10) / 10, 'Đủ bán (ngày)': isFinite(cover(r)) ? Math.round(cover(r)) : '' }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Bao cao');
    const name = { top: 'ban-chay', low: 'sap-het', slow: 'ban-cham' }[tab];
    await saveXlsx(wb, `${name}-${days}ngay-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <>
      <h2 className="title">Hàng bán chạy</h2>
      <p className="note">Ước lượng từ các file tồn kho bạn nhập: tồn giảm giữa 2 lần nhập là đã bán. Ngày vừa nhập hàng vừa bán thì số bán bị tính thiếu.</p>
      <div className="seg" role="group" aria-label="Khoảng thời gian">
        {[7, 14, 30].map(d => <button key={d} aria-pressed={days === d} onClick={() => { setDays(d); localStorage.setItem('hsd.sales-days', String(d)); }}>{d} ngày</button>)}
      </div>
      <div className="seg" role="group" aria-label="Loại báo cáo">
        {([['top', 'Bán chạy'], ['low', 'Sắp hết'], ['slow', 'Bán chậm']] as [Tab, string][]).map(([k, t]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{t}</button>)}
      </div>
      {err && <p className="note bad">{err}</p>}
      {!rows && !err && <p className="note">Đang tính…</p>}
      {rows && span < COVER && <p className="note warn">Mới có số liệu {span} ngày, cần nhập file tồn kho đều đặn khoảng 1–2 tuần thì báo cáo mới chính xác.</p>}
      {rows && <p className="note">{tab === 'top' ? 'Xếp theo số bán mỗi ngày.' : tab === 'low' ? `Bán được mà tồn chỉ đủ dưới ${COVER} ngày (gồm cả hàng đã hết).` : `Còn tồn nhưng không bán được cái nào trong ${span} ngày qua.`} {list.length} sản phẩm{list.length > SHOW ? `, hiện ${SHOW} đầu, xem hết bằng Xuất Excel` : ''}.</p>}
      {list.length > 0 && <>
        <div className="list">
          {list.slice(0, SHOW).map(r => (
            <div className="li label-row keep" key={r.product_id}>
              <div className="grow">
                <div>{nm(r)}</div>
                <div className="note num">{r.ax_code ?? '—'}{r.vendor ? ' · ' + r.vendor : ''}</div>
                <div className="note">{r.sold > 0 ? `Bán ~${fmt(rate(r))}/ngày (${fmt(r.sold)} trong ${r.span} ngày)` : `Không bán trong ${r.span} ngày`}
                  {r.sold > 0 && <> · {(r.stock ?? 0) <= 0 ? <b className="bad">đã hết hàng</b> : isFinite(cover(r)) && <>đủ ~{Math.round(cover(r))} ngày</>}</>}</div>
              </div>
              <div className={'stock ' + ((r.stock ?? 0) > 0 ? 'in' : 'out')}><b className="num">{fmt(r.stock ?? 0)}</b><span>tồn</span></div>
            </div>
          ))}
        </div>
        <button className="pri block" onClick={exportXlsx}><Icon name="download" size={18} />Xuất Excel</button>
      </>}
    </>
  );
}
