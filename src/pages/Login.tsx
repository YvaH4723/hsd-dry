import { useState } from 'react';
import { supabase } from '../supabase.ts';
import Icon from '../components/Icon.tsx';

// Lỗi của máy chủ đăng nhập (tiếng Anh) → câu tiếng Việt.
const VI: [RegExp, string][] = [
  [/invalid login credentials/i, 'Sai email hoặc mật khẩu.'],
  [/already (been )?registered|already exists/i, 'Email này đã đăng ký. Bấm Đăng nhập.'],
  [/email not confirmed/i, 'Email chưa được xác nhận. Mở hộp thư để xác nhận rồi đăng nhập.'],
  [/password should|weak password|at least 6/i, 'Mật khẩu cần ít nhất 6 ký tự, khó đoán hơn.'],
  [/invalid.*email|email.*invalid|validate email/i, 'Email không hợp lệ.'],
  [/rate limit|too many|security purposes/i, 'Thử quá nhiều lần. Đợi vài phút rồi thử lại.'],
  [/fetch|network|load failed/i, 'Không kết nối được. Kiểm tra mạng rồi thử lại.'],
];
const vi = (m: string) => VI.find(([r]) => r.test(m))?.[1] ?? 'Lỗi: ' + m;

export default function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState<'in' | 'up' | null>(null);
  const ready = !!email.trim() && pw.length >= 6 && !busy;

  async function go(signUp: boolean) {
    if (!ready) return;
    setBusy(signUp ? 'up' : 'in'); setMsg(null);
    try {
      const { data, error } = signUp
        ? await supabase.auth.signUp({ email: email.trim(), password: pw })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
      if (error) setMsg({ text: vi(error.message) });
      else if (signUp && !data.session) setMsg({ text: 'Đã đăng ký. Mở email để xác nhận rồi đăng nhập.', ok: true });
    } catch (e: any) { setMsg({ text: vi(String(e?.message ?? e)) }); }
    setBusy(null);
  }

  return (
    <main className="login page">
      <div className="mark"><Icon name="expiry" size={30} /></div>
      <h1>HSD Dry</h1>
      <p className="note">Theo dõi hạn sử dụng quầy Dry, An Nam Gourmet Tiến Bộ Plaza.</p>
      <form onSubmit={e => { e.preventDefault(); go(false); }}>
        <label className="lbl" htmlFor="email">Email</label>
        <input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={e => setEmail(e.target.value)} />
        <label className="lbl" htmlFor="pw">Mật khẩu</label>
        <input id="pw" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} />
        {msg && <p className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="alert">{msg.text}</p>}
        <button type="submit" className="pri block" disabled={!ready}>{busy === 'in' ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
        <button type="button" className="ghost block" disabled={!ready} onClick={() => go(true)}>{busy === 'up' ? 'Đang đăng ký…' : 'Chưa có tài khoản? Đăng ký'}</button>
        <p className="note">Mật khẩu ít nhất 6 ký tự. Đăng ký xong, nhờ quản trị viên thêm bạn vào cửa hàng.</p>
      </form>
    </main>
  );
}
