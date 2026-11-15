import { useEffect, useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { settingsOf } from '../lib/db.ts';

// Hai mốc tính ngày: dán giảm giá trước HSD N ngày; báo trả sớm hơn điều khoản NCC M ngày cho an toàn.
export default function Settings({ member }: { member: Member }) {
  const [d, setD] = useState('');
  const [b, setB] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    supabase.from('stores').select('*').eq('id', member.store_id).single().then(({ data }) => {
      const s = settingsOf(data); setD(String(s.discountDays)); setB(String(s.returnBuffer));
      if (data && !('return_buffer_days' in data)) setMsg('Chưa có cột số ngày an toàn: chạy đoạn SQL bổ sung mới nhất trước khi sửa.');
    });
  }, [member.store_id]);

  async function save() {
    const dd = parseInt(d), bb = parseInt(b);
    if (!(dd >= 0 && bb >= 0)) return setMsg('Nhập số ngày hợp lệ.');
    const { error } = await supabase.from('stores').update({ discount_days: dd, return_buffer_days: bb }).eq('id', member.store_id);
    setMsg(error ? 'Lỗi: ' + error.message : 'Đã lưu. Mở lại các tab để thấy ngày tính lại.');
  }

  return (
    <div className="card">
      <label style={{ marginTop: 0 }}>Hàng không đổi trả / chưa có điều khoản: dán giảm giá trước HSD (ngày)</label>
      <input inputMode="numeric" value={d} onChange={e => setD(e.target.value.replace(/\D/g, ''))} />
      <label>Báo trả NCC sớm hơn điều khoản để an toàn (ngày)</label>
      <input inputMode="numeric" value={b} onChange={e => setB(e.target.value.replace(/\D/g, ''))} />
      <p className="mute">Ví dụ NCC đổi trả 60 ngày, an toàn {b || 0} ngày: HSD 31/03 thì báo trả trước HSD {60 + (parseInt(b) || 0)} ngày.</p>
      <button className="pri" style={{ width: '100%' }} onClick={save}>Lưu</button>
      {msg && <p className={msg.startsWith('Lỗi') || msg.startsWith('Chưa') ? 'bad' : 'mute'}>{msg}</p>}
    </div>
  );
}
