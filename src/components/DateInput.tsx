import { useState } from 'react';
import { addShelfLife, daysLeft, fmt, parseDmy } from '../lib/dates.ts';

export interface DateVal { exp: string | null; mfg: string | null; empty: boolean }
const MODE = 'hsd.dateMode';
// Gõ số liền, app tự chèn dấu /: 300628 → 30/06/28.
const typing = (s: string) => {
  const d = s.replace(/\D/g, '').slice(0, 8);
  return d.length <= 2 ? d : d.length <= 4 ? `${d.slice(0, 2)}/${d.slice(2)}` : `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

// Nhập HSD (ddmmyy) hoặc NSX + hạn N tháng/ngày. Nhớ cách nhập lần trước.
export default function DateInput({ onChange, initial }: { onChange: (v: DateVal) => void; initial?: string }) {
  const [mode, setMode] = useState<'hsd' | 'nsx'>(() => { try { return !initial && localStorage.getItem(MODE) === 'nsx' ? 'nsx' : 'hsd'; } catch { return 'hsd'; } });
  const [hsd, setHsd] = useState(initial ? typing(fmt(initial)) : '');
  const [nsx, setNsx] = useState('');
  const [n, setN] = useState('');
  const [unit, setUnit] = useState<'month' | 'day'>('month');

  const calc = (m = mode, h = hsd, x = nsx, nn = n, u = unit): DateVal => {
    if (m === 'hsd') return { exp: parseDmy(h), mfg: null, empty: !h };
    const mfg = parseDmy(x);
    return { exp: mfg && +nn > 0 ? addShelfLife(mfg, +nn, u) : null, mfg, empty: !x && !nn };
  };
  const upd = (p: Partial<{ m: typeof mode; h: string; x: string; nn: string; u: typeof unit }>) => {
    const v = { m: mode, h: hsd, x: nsx, nn: n, u: unit, ...p };
    if (p.m) try { localStorage.setItem(MODE, p.m); } catch { /* không lưu được thì thôi */ }
    setMode(v.m); setHsd(v.h); setNsx(v.x); setN(v.nn); setUnit(v.u);
    onChange(calc(v.m, v.h, v.x, v.nn, v.u));
  };
  const cur = calc(), d = cur.exp ? daysLeft(cur.exp) : 0;

  return (
    <div>
      <div className="seg" role="group" aria-label="Cách nhập hạn">
        <button type="button" aria-pressed={mode === 'hsd'} onClick={() => upd({ m: 'hsd' })}>Có HSD</button>
        <button type="button" aria-pressed={mode === 'nsx'} onClick={() => upd({ m: 'nsx' })}>NSX + hạn dùng</button>
      </div>
      {mode === 'hsd' ? (
        <input inputMode="numeric" aria-label="Hạn sử dụng" placeholder="dd/mm/yy" value={hsd} onChange={e => upd({ h: typing(e.target.value) })} />
      ) : (
        <>
          <input inputMode="numeric" aria-label="Ngày sản xuất" placeholder="NSX dd/mm/yy" value={nsx} onChange={e => upd({ x: typing(e.target.value) })} />
          <div className="row" style={{ marginTop: 8 }}>
            <input className="grow" inputMode="numeric" aria-label="Hạn dùng" placeholder="Hạn dùng" value={n} onChange={e => upd({ nn: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            <select style={{ width: 110 }} aria-label="Đơn vị" value={unit} onChange={e => upd({ u: e.target.value as 'month' | 'day' })}><option value="month">tháng</option><option value="day">ngày</option></select>
          </div>
        </>
      )}
      <p className={`note ${cur.exp ? (d < 0 ? 'bad' : 'ok') : ''}`} style={{ marginTop: 6 }}>
        {cur.exp ? <>HSD <b className="num">{fmt(cur.exp)}</b> · {d < 0 ? `đã quá ${-d} ngày` : d === 0 ? 'hết hạn hôm nay' : `còn ${d} ngày`}</>
          : cur.empty ? (mode === 'hsd' ? 'Gõ 6 số ngày, tháng, năm. Ví dụ 300628 là 30/06/2028.' : 'Gõ NSX, rồi số tháng hoặc ngày in trên bao bì.')
          : 'Ngày chưa đúng, kiểm tra lại.'}
      </p>
    </div>
  );
}
