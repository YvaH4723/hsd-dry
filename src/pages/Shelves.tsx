import { useEffect, useState } from 'react';
import { supabase, canDelete, canWrite, type Member } from '../supabase.ts';
import { useShelves, useTerms, useZones, type Shelf, type Zone } from '../lib/db.ts';
import { actionFor, type Cfg } from '../lib/action.ts';
import { daysLeft } from '../lib/dates.ts';
import { isNet, loadBatches } from '../lib/offline.ts';
import BatchList from '../components/BatchList.tsx';
import Icon from '../components/Icon.tsx';
import { ask } from '../components/Ask.tsx';

type Tone = 'bad' | 'ret' | 'disc' | 'pick';
const RANK: Record<Tone, number> = { bad: 0, ret: 1, disc: 2, pick: 3 };
// Việc cần làm của một lô, cùng mốc với tab Hôm nay (7 ngày). null: chưa cần làm gì.
function toneOf(b: any, terms: Cfg): Tone | null {
  if (b.status === 'return_notified') return 'pick';
  if (b.expiry_note !== 'action_date' && daysLeft(b.expiry_date) < 0) return b.status === 'on_shelf' || b.status === 'discounted' ? 'bad' : null;
  if (b.status !== 'on_shelf') return null;
  const a = actionFor(b, b.products, terms), d = daysLeft(a.date);
  return d > 7 ? null : a.kind === 'discount' ? 'disc' : a.kind === 'return' && d < 0 ? 'bad' : 'ret';
}
type Count = { n: number; todo: number; tone: Tone | null };
const errText = (e: { message: string }) => isNet(e) ? 'Đang mất mạng: sửa kệ cần có mạng.' : 'Lỗi: ' + e.message;

export default function Shelves({ member, rev }: { member: Member; rev?: number }) {
  const store = member.store_id;
  const { shelves, reload } = useShelves(store);
  const { zones, reload: reloadZones } = useZones(store);
  const zoneName = new Map(zones.map(z => [z.id, z.name]));
  const terms = useTerms(store);
  const [counts, setCounts] = useState<Record<string, Count> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!terms) return;
    loadBatches(store, {}).then(data => {
      const c: Record<string, Count> = {};
      data.forEach(b => {
        const k = b.shelf_id ?? '', x = c[k] ??= { n: 0, todo: 0, tone: null }, t = toneOf(b, terms);
        x.n++;
        if (t) { x.todo++; if (!x.tone || RANK[t] < RANK[x.tone]) x.tone = t; }
      });
      setCounts(c);
    }, () => setCounts({}));
  }, [store, shelves.length, rev, terms]);
  const zoneGroups = [...zones.map(z => ({ id: z.id, name: z.name, items: shelves.filter(s => s.zone_id === z.id) })),
    { id: '', name: zones.length ? 'Chưa chọn khu' : '', items: shelves.filter(s => !s.zone_id || !zoneName.has(s.zone_id)) }].filter(g => g.items.length);

  async function add() {
    const n = name.trim(); if (!n) return;
    const { error } = await supabase.from('shelves').insert({ store_id: store, name: n, sort_order: shelves.length + 1 });
    setErr(error ? errText(error) : ''); if (!error) { setName(''); reload(); }
  }

  const cur = shelves.find(s => s.id === open);
  if (cur) return <ShelfDetail shelf={cur} member={member} zones={zones} lots={counts?.[cur.id]?.n ?? 0} rev={rev} back={() => setOpen(null)} changed={() => { reload(); }} />;
  return (
    <>
      {canWrite(member) && (
        <form className="row" onSubmit={e => { e.preventDefault(); add(); }}>
          <input className="grow" aria-label="Tên kệ mới" placeholder="Tên kệ mới" value={name} onChange={e => setName(e.target.value)} />
          <button type="submit" disabled={!name.trim()}><Icon name="plus" size={18} />Thêm kệ</button>
        </form>
      )}
      {err && <p className="msg bad">{err}</p>}
      {shelves.length ? zoneGroups.map(g => (
        <section className="grp" key={g.id || 'none'}>
          {g.name && <div className="sec"><h2>{g.name}</h2><span className="cnt">{g.items.length} kệ</span></div>}
          <div className="list">
            {g.items.map(s => {
              const c = counts?.[s.id];
              return (
                <div className="li" key={s.id}>
                  <button className="li-main shelfrow" onClick={() => setOpen(s.id)}>
                    <span className={`kdot ${c?.tone ?? 'none'}`} aria-hidden="true" />
                    <span className="grow">
                      <span className="trow-name">{s.name}</span>
                      <span className="trow-meta num">{!counts ? '\u00a0' : !c?.n ? <span className="mute">Chưa có lô</span>
                        : <><span className="mute">{c.n} lô</span>{c.todo > 0 && <span className={c.tone ?? ''}> · {c.todo} cần xử lý</span>}</>}</span>
                    </span>
                    <Icon name="chev" size={18} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )) : <p className="note">Chưa có kệ nào. Thêm kệ bên dưới, ví dụ: Kệ baby, Kệ bimbim, Kệ bột.</p>}
      {(counts?.['']?.n ?? 0) > 0 && <p className="note">{counts!['']!.n} lô chưa gắn kệ{counts!['']!.todo ? `, ${counts!['']!.todo} cần xử lý` : ''}. Mở lô ở tab Hết hạn để chọn kệ.</p>}
      {member.role === 'admin' && <Zones store={store} zones={zones} reload={reloadZones} />}
    </>
  );
}

function ShelfDetail({ shelf, member, zones, lots, rev, back, changed }: { shelf: Shelf; member: Member; zones: Zone[]; lots: number; rev?: number; back: () => void; changed: () => void }) {
  const [name, setName] = useState<string | null>(null);
  const [err, setErr] = useState('');

  async function rename() {
    const n = name?.trim(); if (!n) return;
    const { error } = await supabase.from('shelves').update({ name: n }).eq('id', shelf.id);
    if (error) return setErr(errText(error));
    setErr(''); setName(null); changed();
  }
  async function remove() {
    if (lots) return setErr(`Kệ còn ${lots} lô. Chuyển các lô sang kệ khác rồi mới xóa được.`);
    if (!await ask({ title: `Xóa kệ "${shelf.name}"?`, ok: 'Xóa kệ', danger: true })) return;
    const { error } = await supabase.from('shelves').update({ deleted_at: new Date().toISOString() }).eq('id', shelf.id);
    if (error) return setErr(errText(error));
    back(); changed();
  }

  return (
    <>
      <button className="back" onClick={back}><Icon name="back" size={20} />Quay lại</button>
      {name === null ? (
        <div className="title-row">
          <h2 className="title">{shelf.name}</h2>
          {canWrite(member) && <button className="icon" aria-label="Đổi tên kệ" onClick={() => setName(shelf.name)}><Icon name="edit" /></button>}
          {canDelete(member) && <button className="icon" aria-label="Xóa kệ" onClick={remove}><Icon name="trash" /></button>}
        </div>
      ) : (
        <form className="row" onSubmit={e => { e.preventDefault(); rename(); }}>
          <input className="grow" autoFocus aria-label="Tên kệ" value={name} onChange={e => setName(e.target.value)} />
          <button type="submit" className="pri" disabled={!name.trim()}>Lưu</button>
          <button type="button" onClick={() => setName(null)}>Hủy</button>
        </form>
      )}
      {member.role === 'admin' && zones.length > 0 && (
        <div className="row">
          <label className="note" htmlFor="sh-zone">Thuộc khu</label>
          <select id="sh-zone" className="grow" value={shelf.zone_id ?? ''} onChange={async e => {
            const { error } = await supabase.from('shelves').update({ zone_id: e.target.value || null }).eq('id', shelf.id);
            if (error) setErr(errText(error)); else changed();
          }}>
            <option value="">Chưa chọn khu</option>{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
      )}
      {err && <p className="msg bad">{err}</p>}
      <BatchList member={member} shelfId={shelf.id} rev={rev} />
    </>
  );
}

// Quản trị viên tạo khu (Bánh kẹo, Mỹ phẩm…), rồi mở từng kệ để chọn khu. Khu chỉ để lọc danh sách.
function Zones({ store, zones, reload }: { store: string; zones: Zone[]; reload: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const failed = (e: { message: string }) => setErr(/zones/.test(e.message) && /exist|schema cache/i.test(e.message) ? 'Chưa chạy đoạn SQL 009_zones.sql trên Supabase.' : errText(e));
  async function add() {
    const { error } = await supabase.from('zones').insert({ store_id: store, name: name.trim(), sort_order: zones.length + 1 });
    if (error) return failed(error);
    setName(''); setErr(''); reload();
  }
  async function remove(z: Zone) {
    if (!await ask({ title: `Xóa khu "${z.name}"?`, body: 'Kệ trong khu này thành "chưa chọn khu". Lô không bị ảnh hưởng.', ok: 'Xóa khu', danger: true })) return;
    const r = await supabase.from('shelves').update({ zone_id: null }).eq('store_id', store).eq('zone_id', z.id);
    if (r.error) return failed(r.error);
    const { error } = await supabase.from('zones').update({ deleted_at: new Date().toISOString() }).eq('id', z.id);
    if (error) return failed(error);
    reload();
  }
  return (
    <section className="grp">
      <div className="sec"><h2>Khu</h2><span className="cnt">{zones.length || ''}</span></div>
      <p className="note">Chia quầy thành khu, mở từng kệ để chọn khu, rồi vào Khác → Thành viên chọn khu cho từng người. Hôm nay và Hết hạn sẽ hiện mặc định việc của khu mình.</p>
      <form className="row" onSubmit={e => { e.preventDefault(); add(); }}>
        <input className="grow" aria-label="Tên khu mới" placeholder="Tên khu mới, ví dụ Bánh kẹo" value={name} onChange={e => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim()}><Icon name="plus" size={18} />Thêm khu</button>
      </form>
      {err && <p className="msg bad">{err}</p>}
      {zones.length > 0 && (
        <div className="list">
          {zones.map(z => (
            <div className="li li-body row" key={z.id}>
              <span className="grow">{z.name}</span>
              <button className="icon" aria-label={'Xóa khu ' + z.name} onClick={() => remove(z)}><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
