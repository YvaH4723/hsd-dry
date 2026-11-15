import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Member } from './supabase.ts';
import Login from './pages/Login.tsx';
import Products from './pages/Products.tsx';
import Import from './pages/Import.tsx';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [tab, setTab] = useState<'products' | 'import'>('products');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMember(undefined); return; }
    supabase.from('members').select('store_id,role,name').eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => setMember((data as Member) ?? null));
  }, [session]);

  if (session === undefined) return <main className="mute">Đang tải…</main>;
  if (!session) return <Login />;

  const logout = <button onClick={() => supabase.auth.signOut()}>Đăng xuất</button>;
  if (member === undefined) return <main className="mute">Đang tải…</main>;
  if (!member) return (
    <><header><h1>HSD Dry</h1>{logout}</header>
      <main><div className="card">
        <p>Tài khoản <b>{session.user.email}</b> chưa thuộc cửa hàng nào.</p>
        <p className="mute">Nhờ quản trị viên thêm bạn vào cửa hàng. Nếu bạn là người đầu tiên, chạy đoạn SQL tạo cửa hàng ở cuối file supabase/schema.sql với email này, rồi tải lại trang.</p>
      </div></main></>
  );

  return (
    <>
      <header><h1>HSD Dry</h1><span className="mute">{member.name}</span>{logout}</header>
      <main>{tab === 'products' ? <Products member={member} /> : <Import member={member} />}</main>
      <nav>
        <button className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>Sản phẩm</button>
        {member.role === 'admin' && <button className={tab === 'import' ? 'on' : ''} onClick={() => setTab('import')}>Nhập file</button>}
      </nav>
    </>
  );
}
