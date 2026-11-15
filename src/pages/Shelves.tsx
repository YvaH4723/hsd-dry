import { useEffect, useState } from 'react';
import { supabase, canWrite, type Member } from '../supabase.ts';
import { fetchAll, useShelves } from '../lib/db.ts';
import BatchList from '../components/BatchList.tsx';

export default function Shelves({ member }: { member: Member }) {
  const store = member.store_id;
  const { shelves, reload } = useShelves(store);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    fetchAll<{ shelf_id: string | null }>((a, b) => supabase.from('batches').select('shelf_id').eq('store_id', store).is('deleted_at', null)
      .in('status', ['on_shelf', 'discounted', 'return_notified']).order('id').range(a, b))
      .then(data => { const c: Record<string, number> = {}; data.forEach(b => { const k = b.shelf_id ?? ''; c[k] = (c[k] ?? 0) + 1; }); setCounts(c); });
  }, [store, shelves.length]);

  async function add() {
    const n = name.trim(); if (!n) return;
    const { error } = await supabase.from('shelves').insert({ store_id: store, name: n, sort_order: shelves.length + 1 });
    setErr(error?.message ?? ''); if (!error) { setName(''); reload(); }
  }

  const cur = shelves.find(s => s.id === open);
  if (cur) return (
    <>
      <div className="row"><b style={{ flex: 1 }}>{cur.name}</b><button style={{ flex: '0 0 auto' }} onClick={() => setOpen(null)}>Quay lại</button></div>
      <BatchList member={member} shelfId={cur.id} />
    </>
  );
  return (
    <>
      <div className="card">
        {!shelves.length && <p className="mute" style={{ marginTop: 0 }}>Chưa có kệ nào. Thêm kệ bên dưới (ví dụ: Kệ baby, Kệ bimbim, Kệ bột…).</p>}
        {shelves.map(s => (
          <div className="item click row" key={s.id} onClick={() => setOpen(s.id)}><span style={{ flex: 3 }}>{s.name}</span><span className="mute" style={{ textAlign: 'right' }}>{counts[s.id] ?? 0} lô</span></div>
        ))}
        {(counts[''] ?? 0) > 0 && <p className="mute">{counts['']} lô chưa gắn kệ.</p>}
      </div>
      {canWrite(member) && (
        <div className="card row">
          <input placeholder="Tên kệ mới" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <button style={{ flex: '0 0 auto' }} disabled={!name.trim()} onClick={add}>Thêm kệ</button>
        </div>
      )}
      {err && <p className="bad">{err}</p>}
    </>
  );
}
