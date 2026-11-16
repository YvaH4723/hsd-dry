import { useEffect, useState } from 'react';
import { supabase, canDelete, canWrite, type Member } from '../supabase.ts';
import { useShelves, useZones, type Shelf, type Zone } from '../lib/db.ts';
import { isNet, loadBatches } from '../lib/offline.ts';
import BatchList from '../components/BatchList.tsx';
import Icon from '../components/Icon.tsx';

const errText = (e: { message: string }) => isNet(e) ? 'Đang mất mạng: sửa kệ cần có mạng.' : 'Lỗi: ' + e.message;

export default function Shelves({ member, rev }: { member: Member; rev?: number }) {
  const store = member.store_id;
  const { shelves, reload } = useShelves(store);
  const { zones, reload: reloadZones } = useZones(store);
  const zoneName = new Map(zones.map(z => [z.id, z.name]));
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    loadBatches(store, {}).then(data => {
      const c: Record<string, number> = {};
      data.forEach(b => { const k = b.shelf_id ?? ''; c[k] = (c[k] ?? 0) + 1; });
      setCounts(c);
    }, () => setCounts({}));
  }, [store, shelves.length, rev]);

  async function add() {
    const n = name.trim(); if (!n) return;
    const { error } = await supabase.from('shelves').insert({ store_id: store, name: n, sort_order: shelves.length + 1 });
    setErr(error ? errText(error) : ''); if (!error) { setName(''); reload(); }
  }

  const cur = shelves.find(s => s.id === open);
  if (cur) return <ShelfDetail shelf={cur} member={member} zones={zones} lots={counts?.[cur.id] ?? 0} rev={rev} back={() => setOpen(null)} changed={() => { reload(); }} />;
  return (
    <>
      {shelves.length ? (
        <div className="list">
          {shelves.map(s => (
            <div className="li" key={s.id}>
              <button className="li-main" onClick={() => setOpen(s.id)}>
                <span className="grow">{s.name}{s.zone_id && zoneName.has(s.zone_id) && <span className="note"> · {zoneName.get(s.zone_id)}</span>}</span>
                <span className="note num">{counts ? `${counts[s.id] ?? 0} lô` : ''}</span>
                <Icon name="chev" size={18} />
              </button>
            </div>
          ))}
        </div>
      ) : <p className="note">Chưa có kệ nào. Thêm kệ bên dưới, ví dụ: Kệ baby, Kệ bimbim, Kệ bột.</p>}
      {(counts?.[''] ?? 0) > 0 && <p className="note">{counts!['']} lô chưa gắn kệ. Mở lô ở tab Hết hạn để chọn kệ.</p>}
      {canWrite(member) && (
        <form className="row" onSubmit={e => { e.preventDefault(); add(); }}>
          <input className="grow" aria-label="Tên kệ mới" placeholder="Tên kệ mới" value={name} onChange={e => setName(e.target.value)} />
          <button type="submit" disabled={!name.trim()}><Icon name="plus" size={18} />Thêm kệ</button>
        </form>
      )}
      {err && <p className="msg bad">{err}</p>}
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
    if (!confirm(`Xóa kệ "${shelf.name}"?`)) return;
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
    if (!confirm(`Xóa khu "${z.name}"? Kệ trong khu này thành "chưa chọn khu".`)) return;
    await supabase.from('shelves').update({ zone_id: null }).eq('zone_id', z.id);
    const { error } = await supabase.from('zones').update({ deleted_at: new Date().toISOString() }).eq('id', z.id);
    if (error) return failed(error);
    reload();
  }
  return (
    <section className="grp">
      <div className="sec"><h2>Khu</h2><span className="cnt">{zones.length || ''}</span></div>
      <p className="note">Chia quầy thành khu, mở từng kệ để chọn khu, rồi vào Khác → Thành viên chọn khu cho từng người. Hôm nay và Hết hạn sẽ hiện mặc định việc của khu mình.</p>
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
      <form className="row" style={{ marginTop: 10 }} onSubmit={e => { e.preventDefault(); add(); }}>
        <input className="grow" aria-label="Tên khu mới" placeholder="Tên khu mới, ví dụ Bánh kẹo" value={name} onChange={e => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim()}><Icon name="plus" size={18} />Thêm khu</button>
      </form>
      {err && <p className="msg bad">{err}</p>}
    </section>
  );
}
