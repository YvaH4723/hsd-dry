import { useEffect, useState } from 'react';
import { supabase, canDelete, canWrite, type Member } from '../supabase.ts';
import { audit, BATCH_COLS, fetchAll, pname, useShelves, useTerms } from '../lib/db.ts';
import { actionFor, type LotProduct } from '../lib/action.ts';
import ActionLine from './ActionLine.tsx';
import { daysLeft, fmt } from '../lib/dates.ts';
import DateInput from './DateInput.tsx';

interface Batch { id: string; qty: number; expiry_date: string; expiry_note: string | null; status: string; shelf_id: string | null; shelves: { name: string } | null; products: LotProduct & { name: string; name_vi?: string | null; ax_code: string | null } }
const RANGES = [['all', 'Tất cả'], ['over', 'Quá hạn'], ['7', '≤ 7 ngày'], ['30', '≤ 30 ngày'], ['90', '≤ 90 ngày']] as const;

// Danh sách lô theo ngày còn lại; đỏ khi quá hạn. Lô quá hạn chỉ gắn cờ, không tự trừ tồn.
export default function BatchList({ member, shelfId, productId, reloadKey }: { member: Member; shelfId?: string; productId?: string; reloadKey?: number }) {
  const store = member.store_id;
  const { shelves } = useShelves(store);
  const [rows, setRows] = useState<Batch[] | null>(null);
  const [range, setRange] = useState<string>('all');
  const [edit, setEdit] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const terms = useTerms(store);

  async function load() {
    try {
      const data = await fetchAll<any>((a, b) => {
        let q = supabase.from('batches').select(BATCH_COLS)
          .eq('store_id', store).is('deleted_at', null).in('status', ['on_shelf', 'discounted', 'return_notified']);
        if (shelfId) q = q.eq('shelf_id', shelfId);
        if (productId) q = q.eq('product_id', productId);
        return q.order('expiry_date').order('id').range(a, b);
      });
      setErr(''); setRows(data);
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [store, shelfId, productId, reloadKey]);

  const shown = (rows ?? []).filter(b => {
    const d = daysLeft(b.expiry_date);
    return range === 'all' || (range === 'over' ? d < 0 : d <= +range);
  });

  return (
    <>
      <div className="chips">{RANGES.map(([k, t]) => <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{t}</button>)}</div>
      {err && <p className="bad">{err}</p>}
      {rows == null ? <p className="mute">Đang tải…</p> : !shown.length ? <p className="mute">Không có lô nào.</p> : (
        <div className="card">
          {shown.map(b => {
            const d = daysLeft(b.expiry_date);
            return (
              <div className="item" key={b.id}>
                <div className="click" onClick={() => canWrite(member) && setEdit(edit === b.id ? null : b.id)}>
                  <div className="row"><span style={{ flex: 3 }}>{productId ? (b.shelves?.name ?? 'Chưa có kệ') : pname(b.products)}</span>
                    <span style={{ textAlign: 'right' }} className={d < 0 ? 'over' : d <= 30 ? 'soon' : ''}>{d < 0 ? `Quá ${-d} ngày` : d === 0 ? 'Hết hạn hôm nay' : `Còn ${d} ngày`}</span></div>
                  {b.expiry_note === 'estimated' && <div className="warn">HSD ước tính từ ExpiryDay, kiểm lại trên bao bì</div>}
                  <div className="mute">{b.expiry_note === 'action_date' ? 'Ngày báo trả' : 'HSD'} {fmt(b.expiry_date)} · SL {b.qty}{!productId && !shelfId && b.shelves ? ' · ' + b.shelves.name : ''}</div>
                  {terms && <ActionLine a={actionFor(b, b.products, terms)} status={b.status} />}
                </div>
                {edit === b.id && <Editor b={b} member={member} shelves={shelves} done={() => { setEdit(null); load(); }} />}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function Editor({ b, member, shelves, done }: { b: Batch; member: Member; shelves: { id: string; name: string }[]; done: () => void }) {
  const [qty, setQty] = useState(String(b.qty));
  const [shelf, setShelf] = useState(b.shelf_id ?? '');
  const [exp, setExp] = useState(b.expiry_date);
  const [msg, setMsg] = useState('');
  const before = { qty: b.qty, shelf_id: b.shelf_id, expiry_date: b.expiry_date, status: b.status };

  async function upd(patch: Record<string, unknown>, action: string) {
    const { error } = await supabase.from('batches').update(patch).eq('id', b.id);
    if (error) return setMsg('Lỗi: ' + error.message);
    audit(member.store_id, b.id, action, before, patch);
    done();
  }
  return (
    <div style={{ marginTop: 8 }}>
      <label>Số lượng</label><input inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ''))} />
      <label>Kệ</label>
      <select value={shelf} onChange={e => setShelf(e.target.value)}><option value="">— Chưa chọn kệ —</option>{shelves.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <label>{b.expiry_note === 'action_date' ? 'HSD thật (đang lưu ngày nhắc, sửa sẽ thay bằng HSD)' : b.expiry_note === 'estimated' ? 'HSD (đang là ước tính)' : 'Hạn sử dụng'}</label><DateInput initial={b.expiry_date} onChange={v => v.exp && setExp(v.exp)} />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="pri" onClick={() => upd({ qty: parseInt(qty) || 0, shelf_id: shelf || null, expiry_date: exp, ...(exp !== b.expiry_date ? { expiry_note: null } : {}) }, 'edit')}>Lưu</button>
        <button onClick={() => upd({ status: 'sold_out' }, 'sold_out')}>Bán hết</button>
        {canDelete(member) && <button className="bad" onClick={() => confirm('Xóa lô này?') && upd({ deleted_at: new Date().toISOString() }, 'delete')}>Xóa</button>}
      </div>
      {msg && <p className="bad">{msg}</p>}
    </div>
  );
}
