import { useEffect, useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { isNet } from '../lib/offline.ts';
import { useZones } from '../lib/db.ts';
import Icon from '../components/Icon.tsx';
import { LotsLoading } from '../components/Lot.tsx';
import { ask } from '../components/Ask.tsx';

interface Row { user_id: string; name: string; email: string; role: Member['role']; can_write: boolean; can_delete: boolean; zones?: string[] }
const ROLES: [Member['role'], string, string][] = [
  ['staff', 'Nhân viên', 'Thêm, sửa lô; đánh dấu báo trả, giảm giá'],
  ['viewer', 'Chỉ xem', 'Xem, tra giá; không sửa được gì'],
  ['admin', 'Quản trị', 'Toàn quyền: nhập file, điều khoản, cài đặt, thành viên'],
];
const errText = (e: { message: string }) => isNet(e) ? 'Đang mất mạng: quản lý thành viên cần có mạng.'
  : /add_member/.test(e.message) && /function|schema cache/i.test(e.message) ? 'Chưa chạy đoạn SQL 007_members.sql trên Supabase.' : 'Lỗi: ' + e.message;

// Thành viên cửa hàng: đồng nghiệp tự Đăng ký trong app, quản trị viên thêm email vào đây và chọn quyền.
export default function Members({ member, myId }: { member: Member; myId?: string }) {
  const store = member.store_id;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Member['role']>('staff');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const { zones } = useZones(store);

  const [pending, setPending] = useState<{ email: string; name: string; created_at: string }[] | null>(null);
  const [pRole, setPRole] = useState<Record<string, Member['role']>>({});
  const loadPending = () => supabase.rpc('pending_users', { p_store: store }).then(({ data, error }) => setPending(error ? null : data));
  useEffect(() => { loadPending(); }, [store]);
  async function accept(p: { email: string; name: string }) {
    const { data, error } = await supabase.rpc('add_member', { p_store: store, p_email: p.email, p_name: p.name, p_role: pRole[p.email] ?? 'staff' });
    if (error) return setMsg({ text: errText(error) });
    setMsg({ text: data === 'ok' ? `Đã cho ${p.name || p.email} vào cửa hàng. Họ bấm Thử lại là dùng được.` : 'Người này đã là thành viên.', ok: data === 'ok' });
    loadPending(); load();
  }

  const load = () => supabase.from('members').select('*').eq('store_id', store).order('created_at')
    .then(({ data, error }) => error ? setMsg({ text: errText(error) }) : setRows(data as Row[]));
  useEffect(() => { load(); }, [store]);

  async function add() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc('add_member', { p_store: store, p_email: email.trim(), p_name: name.trim(), p_role: role });
    setBusy(false);
    if (error) return setMsg({ text: errText(error) });
    if (data === 'chua_dang_ky') return setMsg({ text: `Chưa có tài khoản ${email.trim()}. Nhờ đồng nghiệp mở app, nhập email này, đặt mật khẩu rồi bấm "Chưa có tài khoản? Đăng ký", xong bạn thêm lại.` });
    if (data === 'da_co') return setMsg({ text: 'Người này đã là thành viên.' });
    if (data === 'cua_hang_khac') return setMsg({ text: 'Tài khoản này đang thuộc cửa hàng khác.' });
    setMsg({ text: `Đã thêm ${email.trim()}. Đồng nghiệp tắt mở lại app là dùng được.`, ok: true });
    setEmail(''); setName(''); setRole('staff'); load();
  }
  async function set(r: Row, patch: Partial<Row>) {
    const { error } = await supabase.from('members').update(patch).eq('store_id', store).eq('user_id', r.user_id);
    if (error) return setMsg({ text: errText(error) });
    setRows(rs => rs && rs.map(x => x.user_id === r.user_id ? { ...x, ...patch } : x));
  }
  async function remove(r: Row) {
    if (!await ask({ title: `Bỏ ${r.name} khỏi cửa hàng?`, body: `${r.email} sẽ không mở được dữ liệu nữa. Lô người này đã nhập vẫn giữ nguyên.`, ok: 'Bỏ khỏi cửa hàng', danger: true })) return;
    const { error } = await supabase.from('members').delete().eq('store_id', store).eq('user_id', r.user_id);
    if (error) return setMsg({ text: errText(error) });
    load();
  }

  return (
    <>
      <h2 className="title">Thành viên</h2>
      <p className="note">Đồng nghiệp mở app, bấm "Chưa có tài khoản? Đăng ký". Người đã đăng ký hiện ở Chờ duyệt, bạn chọn quyền rồi bấm Cho vào.</p>
      {pending && pending.length > 0 && (
        <section className="grp">
          <div className="sec"><h2><span className="dot warn" />Chờ duyệt</h2><span className="cnt">{pending.length}</span></div>
          <div className="list">
            {pending.map(p => (
              <div className="li li-body stack" key={p.email}>
                <div className="row">
                  <Icon name="user" size={22} />
                  <div className="grow"><div className="lot-name">{p.name || p.email.split('@')[0]}</div><div className="note">{p.email} · đăng ký {new Date(p.created_at).toLocaleDateString('vi-VN')}</div></div>
                </div>
                <div className="row">
                  <select className="grow" aria-label={'Quyền cho ' + p.email} value={pRole[p.email] ?? 'staff'} onChange={e => setPRole(r => ({ ...r, [p.email]: e.target.value as Member['role'] }))}>
                    {ROLES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select>
                  <button className="pri" onClick={() => accept(p)}>Cho vào</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {msg && <p className={`msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</p>}
      <details className="panel more" style={{ borderTop: 0 }}>
        <summary>Thêm bằng email</summary>
      <div className="stack">
        <p className="note">Bước 1: đồng nghiệp mở app trên máy họ, nhập email + mật khẩu, bấm "Chưa có tài khoản? Đăng ký". Bước 2: bạn nhập email đó ở đây.</p>
        <label className="lbl" htmlFor="m-email">Email đồng nghiệp</label>
        <input id="m-email" type="email" inputMode="email" autoCapitalize="none" value={email} onChange={e => setEmail(e.target.value)} placeholder="ten@gmail.com" />
        <label className="lbl" htmlFor="m-name">Tên hiển thị</label>
        <input id="m-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ Lan" />
        <label className="lbl" htmlFor="m-role">Quyền</label>
        <select id="m-role" value={role} onChange={e => setRole(e.target.value as Member['role'])}>
          {ROLES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
        <p className="note">{ROLES.find(r => r[0] === role)![2]}</p>
        <button className="pri block" disabled={busy || !/\S+@\S+\.\S+/.test(email)} onClick={add}><Icon name="plus" size={18} />{busy ? 'Đang thêm…' : 'Thêm vào cửa hàng'}</button>
      </div>
      </details>
      <div className="sec"><h2>Đang có</h2><span className="cnt">{rows?.length ?? ''}</span></div>
      {rows == null ? <LotsLoading /> : (
        <div className="list">
          {rows.map(r => {
            const me = r.user_id === myId;
            return (
              <div className="li li-body stack" key={r.user_id}>
                <div className="row">
                  <Icon name="user" size={22} />
                  <div className="grow"><div className="lot-name">{r.name}{me ? ' (bạn)' : ''}</div><div className="note">{r.email}</div></div>
                  {!me && <button className="icon" aria-label={'Bỏ ' + r.name} onClick={() => remove(r)}><Icon name="trash" /></button>}
                </div>
                {zones.length > 0 && (
                  <div className="exist" role="group" aria-label={'Khu của ' + r.name}>
                    <span className="note">Phụ trách khu:</span>
                    {zones.map(z => {
                      const on = (r.zones ?? []).includes(z.id);
                      return <label className="check" key={z.id} style={{ minHeight: 36 }}><input type="checkbox" checked={on}
                        onChange={() => set(r, { zones: on ? (r.zones ?? []).filter(x => x !== z.id) : [...(r.zones ?? []), z.id] })} />{z.name}</label>;
                    })}
                  </div>
                )}
                {me ? <p className="note">Quản trị. Không tự đổi quyền của mình để tránh mất quyền quản trị. Đổi khu của mình xong, tắt mở lại app để áp dụng.</p> : (
                  <>
                    <select aria-label={'Quyền của ' + r.name} value={r.role} onChange={async e => { const v = e.target.value as Member['role']; if (!await ask({ title: `Đổi quyền của ${r.name} thành ${ROLES.find(x => x[0] === v)?.[1]}?`, ok: 'Đổi quyền', danger: v === 'admin' })) return; set(r, { role: v, can_write: v !== 'viewer', can_delete: v === 'admin' ? true : r.can_delete && v !== 'viewer' }); }}>
                      {ROLES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                    {r.role === 'staff' && <label className="check"><input type="checkbox" checked={r.can_delete} onChange={async e => { const v = e.target.checked; if (await ask({ title: v ? `Cho ${r.name} xóa lô, xóa kệ?` : `Bỏ quyền xóa của ${r.name}?`, ok: v ? 'Cho phép' : 'Bỏ quyền' })) set(r, { can_delete: v }); }} />Được xóa lô, xóa kệ</label>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
