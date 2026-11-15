import { useState } from 'react';
import { addShelfLife, fmt, parseDmy } from '../lib/dates.ts';

// Nhập HSD bằng bàn phím số kiểu ddmmyy, hoặc NSX + hạn N ngày/tháng. Gọi onChange(iso | null).
export default function DateInput({ onChange, initial }: { onChange: (v: { exp: string | null; mfg: string | null }) => void; initial?: string }) {
  const [mode, setMode] = useState<'hsd' | 'nsx'>('hsd');
  const [hsd, setHsd] = useState(initial ? fmt(initial).replace(/\//g, '') : '');
  const [nsx, setNsx] = useState('');
  const [n, setN] = useState('');
  const [unit, setUnit] = useState<'month' | 'day'>('month');

  const calc = (m = mode, h = hsd, x = nsx, nn = n, u = unit) => {
    if (m === 'hsd') return { exp: parseDmy(h), mfg: null };
    const mfg = parseDmy(x);
    return { exp: mfg && +nn > 0 ? addShelfLife(mfg, +nn, u) : null, mfg };
  };
  const upd = (p: Partial<{ m: typeof mode; h: string; x: string; nn: string; u: typeof unit }>) => {
    const v = { m: mode, h: hsd, x: nsx, nn: n, u: unit, ...p };
    setMode(v.m); setHsd(v.h); setNsx(v.x); setN(v.nn); setUnit(v.u);
    onChange(calc(v.m, v.h, v.x, v.nn, v.u));
  };
  const cur = calc();

  return (
    <div>
      <div className="chips">
        <button className={mode === 'hsd' ? 'on' : ''} onClick={() => upd({ m: 'hsd' })}>Nhập HSD</button>
        <button className={mode === 'nsx' ? 'on' : ''} onClick={() => upd({ m: 'nsx' })}>NSX + hạn dùng</button>
      </div>
      {mode === 'hsd' ? (
        <input inputMode="numeric" placeholder="HSD: ddmmyy, ví dụ 300628" value={hsd} onChange={e => upd({ h: e.target.value })} />
      ) : (
        <>
          <input inputMode="numeric" placeholder="NSX: ddmmyy" value={nsx} onChange={e => upd({ x: e.target.value })} />
          <div className="row" style={{ marginTop: 8 }}>
            <input inputMode="numeric" placeholder="Hạn" value={n} onChange={e => upd({ nn: e.target.value.replace(/\D/g, '') })} />
            <select value={unit} onChange={e => upd({ u: e.target.value as 'month' | 'day' })}><option value="month">tháng</option><option value="day">ngày</option></select>
          </div>
        </>
      )}
      <p className={cur.exp ? 'ok' : 'mute'} style={{ margin: '6px 0 0' }}>{cur.exp ? 'HSD: ' + fmt(cur.exp) : 'Chưa có ngày hợp lệ'}</p>
    </div>
  );
}
