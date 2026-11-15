import { useState } from 'react';
import { supabase } from '../supabase.ts';

export default function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function go(signUp: boolean) {
    setBusy(true); setMsg('');
    const { data, error } = signUp
      ? await supabase.auth.signUp({ email, password: pw })
      : await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) setMsg(error.message);
    else if (signUp && !data.session) setMsg('Đã đăng ký. Mở email để xác nhận rồi đăng nhập.');
  }

  return (
    <main><div className="card">
      <h2 style={{ marginTop: 0 }}>HSD Dry</h2>
      <label>Email</label>
      <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
      <label>Mật khẩu (ít nhất 6 ký tự)</label>
      <input type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="pri" disabled={busy || !email || pw.length < 6} onClick={() => go(false)}>Đăng nhập</button>
        <button disabled={busy || !email || pw.length < 6} onClick={() => go(true)}>Đăng ký</button>
      </div>
      {msg && <p className="bad">{msg}</p>}
    </div></main>
  );
}
