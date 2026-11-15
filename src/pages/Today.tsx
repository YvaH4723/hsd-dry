import { useEffect, useState } from 'react';
import { supabase, canWrite, type Member } from '../supabase.ts';
import { audit, BATCH_COLS, fetchAll, useTerms } from '../lib/db.ts';
import { actionFor, type Action, type LotProduct } from '../lib/action.ts';
import { daysLeft, fmt } from '../lib/dates.ts';
import ActionLine from '../components/ActionLine.tsx';

interface Lot { id: string; qty: number; expiry_date: string; expiry_note: string | null; status: string; shelves: { name: string } | null; products: LotProduct & { name: string; ax_code: string | null }; a: Action }
const SOON = 7;

// "Hôm nay cần làm": quá HSD → quá ngày báo trả → báo trả trong 7 ngày → cần dán giảm giá.
export default function Today({ member }: { member: Member }) {
  const store = member.store_id;
  const terms = useTerms(store);
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [err, setErr] = useState('');

  async function load() {
    if (!terms) return;
    try {
      const data = await fetchAll<any>((a, b) => supabase.from('batches').select(BATCH_COLS).eq('store_id', store).is('deleted_at', null)
        .in('status', ['on_shelf', 'discounted', 'return_notified']).order('expiry_date').order('id').range(a, b));
      setErr('');
      setLots(data.map(b => ({ ...b, a: actionFor(b, b.products, terms) })));
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [terms]);

  async function mark(l: Lot, status: string) {
    const { error } = await supabase.from('batches').update({ status }).eq('id', l.id);
    if (error) return setErr(error.message);
    audit(store, l.id, status, { status: l.status }, { status });
    load();
  }

  if (!lots) return <p className="mute">{err || 'Đang tải…'}</p>;
  const open = lots.filter(l => l.status === 'on_shelf');
  const byDate = (x: Lot, y: Lot) => x.a.date.localeCompare(y.a.date);
  const groups: [string, Lot[], 'return' | 'discount' | null][] = [
    ['Quá HSD', lots.filter(l => l.expiry_note !== 'action_date' && daysLeft(l.expiry_date) < 0), null],
    ['Quá ngày báo trả', open.filter(l => l.a.kind !== 'discount' && daysLeft(l.a.date) < 0).sort(byDate), 'return'],
    [`Báo trả trong ${SOON} ngày`, open.filter(l => l.a.kind !== 'discount' && daysLeft(l.a.date) >= 0 && daysLeft(l.a.date) <= SOON).sort(byDate), 'return'],
    ['Cần dán giảm giá', open.filter(l => l.a.kind === 'discount' && daysLeft(l.a.date) <= SOON).sort(byDate), 'discount'],
  ];

  return (
    <>
      {err && <p className="bad">{err}</p>}
      {groups.every(g => !g[1].length) && <p className="mute">Hôm nay không có việc gì.</p>}
      {groups.filter(g => g[1].length).map(([title, items, kind]) => (
        <div className="card" key={title}>
          <b>{title} ({items.length})</b>
          {items.map(l => (
            <div className="item" key={l.id}>
              <div>{l.products.name}</div>
              <div className="mute">{l.expiry_note === 'action_date' ? 'Chưa có HSD' : `HSD ${fmt(l.expiry_date)}${l.expiry_note ? ' (ước tính)' : ''}`} · SL {l.qty}{l.shelves ? ' · ' + l.shelves.name : ''}</div>
              <ActionLine a={l.a} status={l.status} />
              {kind && canWrite(member) && (
                <div className="row" style={{ marginTop: 6 }}>
                  {(kind === 'return' || l.a.kind === 'reminder') && <button onClick={() => mark(l, 'return_notified')}>Đã báo trả</button>}
                  {(kind === 'discount' || l.a.kind === 'reminder') && <button onClick={() => mark(l, 'discounted')}>Đã dán giảm giá</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
