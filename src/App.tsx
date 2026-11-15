import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, canWrite, type Member } from './supabase.ts';
import type { Product } from './lib/db.ts';
import Login from './pages/Login.tsx';
import Products from './pages/Products.tsx';
import Import from './pages/Import.tsx';
import Shelves from './pages/Shelves.tsx';
import AddBatch from './pages/AddBatch.tsx';
import BatchList from './components/BatchList.tsx';
import Today from './pages/Today.tsx';
import Terms from './pages/Terms.tsx';
import Settings from './pages/Settings.tsx';

type Tab = 'today' | 'expiry' | 'products' | 'shelves' | 'more';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('today');
  const [adding, setAdding] = useState<{ product?: Product } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMember(undefined); return; }
    supabase.from('members').select('store_id,role,name,can_write,can_delete').eq('user_id', session.user.id).maybeSingle()
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

  const tabs: [Tab, string][] = [['today', 'Hôm nay'], ['expiry', 'Hết hạn'], ['products', 'Sản phẩm'], ['shelves', 'Kệ'], ['more', 'Khác']];

  return (
    <>
      <header><h1>HSD Dry</h1><span className="mute">{member.name}</span>{logout}</header>
      <main>
        {adding ? <AddBatch member={member} initial={adding.product} onClose={() => { setAdding(null); setReloadKey(k => k + 1); }} />
          : tab === 'expiry' ? <BatchList member={member} reloadKey={reloadKey} />
          : tab === 'products' ? <Products member={member} onAdd={p => setAdding({ product: p })} />
          : tab === 'shelves' ? <Shelves member={member} />
          : tab === 'today' ? <Today member={member} />
          : <More member={member} />}
      </main>
      {!adding && canWrite(member) && tab !== 'more' && <button className="pri fab" onClick={() => setAdding({})}>+ Thêm lô</button>}
      <nav>{tabs.map(([k, t]) => <button key={k} className={tab === k && !adding ? 'on' : ''} onClick={() => { setAdding(null); setTab(k); }}>{t}</button>)}</nav>
    </>
  );
}

function More({ member }: { member: Member }) {
  const [sub, setSub] = useState<'terms' | 'import' | 'settings'>('terms');
  return (
    <>
      <div className="chips">
        <button className={sub === 'terms' ? 'on' : ''} onClick={() => setSub('terms')}>Điều khoản đổi trả</button>
        {member.role === 'admin' && <button className={sub === 'import' ? 'on' : ''} onClick={() => setSub('import')}>Nhập file</button>}
        {member.role === 'admin' && <button className={sub === 'settings' ? 'on' : ''} onClick={() => setSub('settings')}>Cài đặt</button>}
      </div>
      {sub === 'terms' ? <Terms member={member} /> : sub === 'import' ? <Import member={member} /> : <Settings member={member} />}
    </>
  );
}
