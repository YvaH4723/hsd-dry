import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, canWrite, type Member } from './supabase.ts';
import { useTerms, type Product } from './lib/db.ts';
import Login from './pages/Login.tsx';
import Products from './pages/Products.tsx';
import Import from './pages/Import.tsx';
import Shelves from './pages/Shelves.tsx';
import AddBatch from './pages/AddBatch.tsx';
import BatchList from './components/BatchList.tsx';
import Today from './pages/Today.tsx';
import Terms from './pages/Terms.tsx';
import Settings from './pages/Settings.tsx';
import Members from './pages/Members.tsx';
import History from './pages/History.tsx';
import SyncPanel, { SyncBadge, syncedText } from './components/SyncPanel.tsx';
import Backup from './components/Backup.tsx';
import PushToggle from './components/PushToggle.tsx';
import Icon, { type IconName } from './components/Icon.tsx';
import { isNet, startSync, useSync } from './lib/offline.ts';

const MEMBER_KEY = 'hsd.member';
const cachedMember = (uid?: string): Member | null => {
  try { const c = JSON.parse(localStorage.getItem(MEMBER_KEY) ?? 'null'); return c && (!uid || c.uid === uid) ? c.member : null; } catch { return null; }
};

type Tab = 'today' | 'expiry' | 'products' | 'shelves' | 'more';
type Sub = 'terms' | 'import' | 'settings' | 'members' | 'history' | 'data' | null;
const TITLE: Record<Tab, string> = { today: 'Hôm nay', expiry: 'Hết hạn', products: 'Sản phẩm', shelves: 'Kệ', more: 'Khác' };
const NAV: [Tab | 'add', string, IconName][] = [['today', 'Hôm nay', 'today'], ['expiry', 'Hết hạn', 'expiry'], ['add', 'Thêm lô', 'plus'], ['products', 'Sản phẩm', 'box'], ['shelves', 'Kệ', 'shelf']];

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('today');
  const [sub, setSub] = useState<Sub>(null);
  const [adding, setAdding] = useState<{ product?: Product } | null>(null);
  const [rev, setRev] = useState(0);                 // tăng khi đóng màn Thêm lô: các danh sách tải lại
  const [slow, setSlow] = useState(false);           // mạng chậm quá 5 giây

  useEffect(() => { const t = setTimeout(() => setSlow(true), 5000); return () => clearTimeout(t); }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMember(undefined); return; }
    supabase.from('members').select('*').eq('user_id', session.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (error && isNet(error)) return setMember(cachedMember(session.user.id));   // mất mạng: dùng thông tin đã lưu
        const m = (data as Member) ?? null;
        setMember(m);
        try { if (m) localStorage.setItem(MEMBER_KEY, JSON.stringify({ uid: session.user.id, member: m })); else localStorage.removeItem(MEMBER_KEY); } catch { /* bỏ qua */ }
      });
  }, [session]);

  // Mất mạng, hoặc mạng chậm (quá 5 giây chưa đọc được tài khoản): mở app ngay bằng thông tin đã lưu trên máy.
  const offlineMember = (session === null && !navigator.onLine) || (slow && member === undefined) ? cachedMember(session?.user.id) : null;
  const me = member ?? offlineMember;
  useEffect(() => { if (me) startSync(me.store_id); }, [me?.store_id]);

  if (!offlineMember && (session === undefined || (session && member === undefined)))
    return <main className="page"><p className="note">{slow ? 'Mạng đang chậm, vẫn đang chờ máy chủ… Kiểm tra wifi / 4G.' : 'Đang tải…'}</p></main>;
  if (!session && !offlineMember) return <Login />;
  if (!me) return (
    <main className="login page">
      <h1>Chưa vào cửa hàng</h1>
      <p>Tài khoản <b>{session?.user.email}</b> chưa thuộc cửa hàng nào.</p>
      <p className="note">Đã gửi yêu cầu vào cửa hàng. Quản trị viên duyệt xong (Khác → Thành viên → Chờ duyệt) thì bấm Thử lại.</p>
      <button className="pri" onClick={() => location.reload()}>Thử lại</button>
      <button onClick={() => logout(0)}>Đăng xuất</button>
    </main>
  );

  const go = (t: Tab, s: Sub = null) => { if (adding) { setAdding(null); setRev(r => r + 1); } setTab(t); setSub(s); scrollTo(0, 0); };
  const add = (product?: Product) => { setAdding({ product }); scrollTo(0, 0); };
  const page = tab === 'expiry' ? <BatchList member={me} rev={rev} />
    : tab === 'products' ? <Products member={me} onAdd={add} rev={rev} />
    : tab === 'shelves' ? <Shelves member={me} rev={rev} />
    : tab === 'today' ? <Today member={me} rev={rev} onHistory={() => go('more', 'history')} />
    : <More member={me} email={session?.user.email} uid={session?.user.id} sub={sub} setSub={setSub} />;

  return (
    <>
      <header className="top">
        <h1>{adding ? 'Thêm lô' : TITLE[tab]}</h1>
        <SyncBadge onClick={() => go('more', 'data')} />
        {adding
          ? <button className="icon" aria-label="Đóng màn thêm lô" onClick={() => go(tab, sub)}><Icon name="x" size={22} /></button>
          : <button className="icon" aria-label="Khác: điều khoản, cài đặt, sao lưu, đăng xuất" aria-current={tab === 'more' ? 'page' : undefined} onClick={() => go('more')}><Icon name="menu" size={22} /></button>}
      </header>
      <main>
        {/* Trang đang xem vẫn giữ nguyên (ẩn) khi mở Thêm lô, đóng lại là về đúng chỗ cũ. */}
        <div className="page" hidden={!!adding}>{page}</div>
        {adding && <div className="page"><AddBatch member={me} initial={adding.product} /></div>}
      </main>
      <nav className="tabs" aria-label="Chuyển màn">
        {NAV.filter(([k]) => k !== 'add' || canWrite(me)).map(([k, label, icon]) => k === 'add' ? (
          <button key={k} className="add" aria-label="Thêm lô" aria-current={adding ? 'page' : undefined} onClick={() => !adding && add()}>
            <span className="disc"><Icon name="plus" size={26} /></span>
          </button>
        ) : (
          <button key={k} aria-current={!adding && tab === k ? 'page' : undefined} onClick={() => go(k)}>
            <Icon name={icon} size={23} />{label}
          </button>
        ))}
      </nav>
    </>
  );
}

// Đăng xuất chỉ trên máy này (máy khác cùng tài khoản vẫn giữ đăng nhập).
function logout(pending: number) {
  if (pending && !confirm(`Còn ${pending} thay đổi chưa gửi lên máy chủ. Nên đợi có mạng cho gửi xong rồi hãy đăng xuất. Vẫn đăng xuất?`)) return;
  try { localStorage.removeItem(MEMBER_KEY); } catch { /* */ }
  supabase.auth.signOut({ scope: 'local' });
}

const ROLE: Record<Member['role'], string> = { admin: 'Quản trị', staff: 'Nhân viên', viewer: 'Chỉ xem' };

function More({ member, email, uid, sub, setSub }: { member: Member; email?: string; uid?: string; sub: Sub; setSub: (s: Sub) => void }) {
  const s = useSync();
  const terms = useTerms(member.store_id);
  const admin = member.role === 'admin';
  const [waiting, setWaiting] = useState(0);
  useEffect(() => { if (admin && !sub) supabase.rpc('pending_users', { p_store: member.store_id }).then(({ data }) => setWaiting(data?.length ?? 0)); }, [sub]);
  if (sub) return (
    <>
      <button className="back" onClick={() => setSub(null)}><Icon name="back" size={20} />Khác</button>
      {sub === 'terms' ? <Terms member={member} /> : sub === 'import' ? <Import member={member} /> : sub === 'settings' ? <Settings member={member} /> : sub === 'members' ? <Members member={member} myId={uid} /> : sub === 'history' ? <History member={member} />
        : <><h2 className="title">Dữ liệu và sao lưu</h2><SyncPanel store={member.store_id} /><Backup store={member.store_id} /></>}
    </>
  );
  const items: [Exclude<Sub, null>, IconName, string, string][] = [
    ['history', 'checkCircle', 'Lịch sử, khôi phục', 'Lô đã xử lý, đã xóa: xem ai làm, khôi phục khi bấm nhầm'],
    ['terms', 'clipboard', 'Điều khoản đổi trả', 'Tra và sửa điều khoản của từng NCC, nhãn hàng'],
    ...(admin ? [
      ['members', 'user', 'Thành viên', waiting ? `${waiting} người chờ duyệt` : 'Duyệt đồng nghiệp, chọn quyền, khu'],
      ['import', 'upload', 'Nhập file', 'Danh mục Cadencia, Contact List'],
      ['settings', 'sliders', 'Cài đặt', terms ? `Giảm giá trước HSD ${terms.discountDays} ngày · báo trả sớm thêm ${terms.returnBuffer} ngày` : 'Mốc giảm giá, số ngày an toàn'],
    ] as [Exclude<Sub, null>, IconName, string, string][] : []),
    ['data', 'database', 'Dữ liệu và sao lưu', syncedText(s.syncedAt) ? `Dữ liệu trên máy lúc ${syncedText(s.syncedAt)}` : 'Chưa tải dữ liệu về máy'],
  ];
  return (
    <>
      <div className="list">
        {items.map(([k, icon, title, note]) => (
          <div className="li" key={k}>
            <button className="li-main" onClick={() => { setSub(k); scrollTo(0, 0); }}>
              <Icon name={icon} size={22} />
              <div className="grow"><div>{title}</div><div className="note">{note}</div></div>
              <Icon name="chev" size={18} />
            </button>
          </div>
        ))}
      </div>
      <PushToggle store={member.store_id} />
      <div className="sec"><h2>Tài khoản</h2></div>
      <div className="panel">
        <div className="row">
          <Icon name="user" size={22} />
          <div className="grow"><div>{member.name}</div><div className="note">{[email, ROLE[member.role]].filter(Boolean).join(' · ')}</div></div>
        </div>
        <button className="danger block" onClick={() => logout(s.pending)}><Icon name="logout" size={18} />Đăng xuất</button>
      </div>
    </>
  );
}
