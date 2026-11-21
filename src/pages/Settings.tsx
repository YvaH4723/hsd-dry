import { useEffect, useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { reloadTerms, settingsOf } from '../lib/db.ts';
import { ask } from '../components/Ask.tsx';
import { isNet } from '../lib/offline.ts';

// Hai mốc tính ngày: dán giảm giá trước HSD N ngày; báo trả sớm hơn điều khoản NCC M ngày cho an toàn.
export default function Settings({ member }: { member: Member }) {
  const [d, setD] = useState('');
  const [b, setB] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from('stores').select('*').eq('id', member.store_id).single().then(({ data, error }) => {
      if (error) return setMsg({ text: isNet(error) ? 'Đang mất mạng: cần có mạng để xem và sửa cài đặt.' : 'Lỗi: ' + error.message });
      const s = settingsOf(data); setD(String(s.discountDays)); setB(String(s.returnBuffer));
      if (data && !('return_buffer_days' in data)) setMsg({ text: 'Chưa có cột số ngày an toàn: chạy đoạn SQL bổ sung mới nhất trước khi sửa.' });
    });
  }, [member.store_id]);

  async function save() {
    const dd = parseInt(d), bb = parseInt(b);
    if (!(dd >= 0 && bb >= 0)) return setMsg({ text: 'Nhập số ngày hợp lệ.' });
    if (!await ask({ title: 'Lưu mốc ngày mới?', body: `Giảm giá trước HSD ${dd} ngày, an toàn ${bb} ngày. Ngày báo trả, giảm giá của mọi lô sẽ tính lại theo mốc này.`, ok: 'Lưu' })) return;
    setBusy(true);
    const { error } = await supabase.from('stores').update({ discount_days: dd, return_buffer_days: bb }).eq('id', member.store_id);
    setBusy(false);
    if (error) return setMsg({ text: isNet(error) ? 'Đang mất mạng: chưa lưu được.' : 'Lỗi: ' + error.message });
    reloadTerms();
    setMsg({ text: 'Đã lưu. Mọi ngày báo trả, giảm giá đã tính lại theo mốc mới.', ok: true });
  }
  const bn = parseInt(b) || 0;

  return (
    <>
      <h2 className="title">Cài đặt</h2>
      <div className="panel">
        <label className="lbl" htmlFor="st-d">Hàng không đổi trả, chưa có điều khoản: dán giảm giá trước HSD</label>
        <div className="row"><input id="st-d" style={{ width: 110 }} inputMode="numeric" value={d} onChange={e => setD(e.target.value.replace(/\D/g, '').slice(0, 3))} /><span>ngày</span></div>
        <label className="lbl" htmlFor="st-b">Báo trả NCC sớm hơn điều khoản, cho an toàn</label>
        <div className="row"><input id="st-b" style={{ width: 110 }} inputMode="numeric" value={b} onChange={e => setB(e.target.value.replace(/\D/g, '').slice(0, 3))} /><span>ngày</span></div>
        <p className="note">Ví dụ NCC cho đổi trả trước 60 ngày, an toàn {bn} ngày: app nhắc báo trả trước HSD {60 + bn} ngày.</p>
        <button className="pri block" disabled={busy} onClick={save}>Lưu</button>
        {msg && <p className={`msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</p>}
      </div>
    </>
  );
}
