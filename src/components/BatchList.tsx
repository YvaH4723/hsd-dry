import { useEffect, useState } from 'react';
import { canDelete, canWrite, type Member } from '../supabase.ts';
import { useShelves, useTerms, useZones, zoneFilter, type Shelf } from '../lib/db.ts';
import ZoneChips from './ZoneChips.tsx';
import { loadBatches, updateBatchOffline } from '../lib/offline.ts';
import { actionFor } from '../lib/action.ts';
import { daysLeft, fmt } from '../lib/dates.ts';
import DateInput, { type DateVal } from './DateInput.tsx';
import LotInfo, { LotsLoading, type LotRow } from './Lot.tsx';
import Icon from './Icon.tsx';

const RANGES = [['all', 'Tất cả'], ['over', 'Quá hạn'], ['7', '≤ 7 ngày'], ['30', '≤ 30 ngày'], ['90', '≤ 90 ngày']] as const;
const rel = (d: number) => d < 0 ? `Quá ${-d} ngày` : d === 0 ? 'Hết hạn hôm nay' : `Còn ${d} ngày`;

// Danh sách lô nhóm theo ngày HSD (giống ExpiryDay). Lô quá hạn chỉ gắn cờ đỏ, không tự trừ tồn.
export default function BatchList({ member, shelfId, productId, rev }: { member: Member; shelfId?: string; productId?: string; rev?: number }) {
  const store = member.store_id;
  const { shelves } = useShelves(store);
  const terms = useTerms(store);
  const { zones } = useZones(store);
  const mine = member.zones ?? [];
  const [zone, setZone] = useState(mine.length ? 'mine' : 'all');
  const [rows, setRows] = useState<LotRow[] | null>(null);
  const [range, setRange] = useState<string>('all');
  const [edit, setEdit] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = () => loadBatches(store, { shelfId, productId }).then(d => { setErr(''); setRows(d); }, (e: Error) => setErr(e.message));
  useEffect(() => { load(); }, [store, shelfId, productId, rev]);

  const top = !productId && !shelfId;           // chỉ lọc khu ở tab Hết hạn
  const all = (rows ?? []).filter(top ? zoneFilter(zone, mine, shelves) : () => true);
  const noHsd = all.filter(b => b.expiry_note === 'action_date');
  const dated = all.filter(b => b.expiry_note !== 'action_date');
  const over = dated.filter(b => daysLeft(b.expiry_date) < 0).length;
  const shown = dated.filter(b => range === 'all' || (range === 'over' ? daysLeft(b.expiry_date) < 0 : daysLeft(b.expiry_date) <= +range));
  const byDate = new Map<string, LotRow[]>();
  for (const b of shown) byDate.set(b.expiry_date, [...(byDate.get(b.expiry_date) ?? []), b]);

  const row = (b: LotRow) => {
    const info = <LotInfo l={b} a={terms ? actionFor(b, b.products, terms) : undefined} title={productId ? (b.shelves?.name ?? 'Chưa gắn kệ') : undefined}
      showShelf={!productId && !shelfId} showHsd={false} />;
    return (
      <div className="li" key={b.id}>
        {canWrite(member)
          ? <button className="li-main" aria-expanded={edit === b.id} onClick={() => setEdit(edit === b.id ? null : b.id)}>{info}</button>
          : <div className="li-body">{info}</div>}
        {edit === b.id && <Editor b={b} member={member} shelves={shelves} done={() => { setEdit(null); load(); }} />}
      </div>
    );
  };

  return (
    <>
      {!productId && rows && (
        <p className="summary">
          <b>{all.length}</b> lô {shelfId ? 'trên kệ' : 'đang theo dõi'} · <b className={over ? 'bad' : ''}>{over}</b> quá hạn
          {noHsd.length > 0 && <> · <b className="warn">{noHsd.length}</b> chưa có HSD</>}
        </p>
      )}
      {top && <ZoneChips zones={zones} mine={mine} value={zone} onChange={setZone} />}
      {!productId && all.length > 0 && (
        <div className="chips" role="group" aria-label="Lọc theo số ngày còn lại">
          {RANGES.map(([k, t]) => <button key={k} aria-pressed={range === k} onClick={() => setRange(k)}>{t}</button>)}
        </div>
      )}
      {err && <p className="msg bad">{err}</p>}
      {rows == null ? (!err && <LotsLoading />) : !all.length ? (
        <div className="empty">
          <Icon name="box" size={28} />
          <b>{productId ? 'Sản phẩm này chưa có lô nào' : shelfId ? 'Kệ này chưa có lô nào' : 'Chưa có lô nào'}</b>
          {canWrite(member) && <span>Bấm nút + ở giữa thanh dưới để thêm lô.</span>}
        </div>
      ) : (
        <>
          {range === 'all' && noHsd.length > 0 && (
            <section className="grp">
              <div className="sec"><h2><span className="dot warn" />Cần nhập HSD thật</h2><span className="cnt">{noHsd.length} lô</span></div>
              <p className="note">Lô chuyển từ ExpiryDay chỉ có ngày nhắc. Bấm vào lô, nhập HSD in trên bao bì.</p>
              <div className="list">{noHsd.map(row)}</div>
            </section>
          )}
          {[...byDate].map(([date, items]) => {
            const d = daysLeft(date);
            return (
              <section className="grp" key={date}>
                <div className="sec">
                  <h3 className="num">{fmt(date)}</h3>
                  <span className={`rel ${d < 0 ? 'bad' : d <= 7 ? 'warn' : ''}`}>{rel(d)} · {items.length} lô</span>
                </div>
                <div className="list">{items.map(row)}</div>
              </section>
            );
          })}
          {!shown.length && <p className="empty">Không có lô nào trong khoảng này.</p>}
        </>
      )}
    </>
  );
}

function Editor({ b, member, shelves, done }: { b: LotRow; member: Member; shelves: Shelf[]; done: () => void }) {
  const noHsd = b.expiry_note === 'action_date';
  const [qty, setQty] = useState(String(b.qty));
  const [shelf, setShelf] = useState(b.shelf_id ?? '');
  const [date, setDate] = useState<DateVal>({ exp: noHsd ? null : b.expiry_date, mfg: null, empty: noHsd });
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const n = parseInt(qty) || 0;
  const exp = noHsd && date.empty ? b.expiry_date : date.exp;          // lô chưa có HSD: để trống thì giữ ngày nhắc
  const clearNote = noHsd ? !date.empty : b.expiry_note === 'estimated' && (checked || exp !== b.expiry_date);
  const before = { qty: b.qty, shelf_id: b.shelf_id, expiry_date: b.expiry_date, expiry_note: b.expiry_note, status: b.status };

  async function upd(patch: Record<string, unknown>, action: string) {
    setBusy(true);
    try {
      const view = 'shelf_id' in patch ? { shelves: shelves.find(s => s.id === patch.shelf_id) ?? null } : undefined;
      await updateBatchOffline(member.store_id, b.id, patch, action, before, view);
      done();
    } catch (e: any) { setMsg('Chưa lưu được: ' + e.message); setBusy(false); }
  }
  const save = () => upd({ qty: n, shelf_id: shelf || null, expiry_date: exp, ...(clearNote ? { expiry_note: null } : {}) }, 'edit');

  return (
    <div className="li-edit">
      <div className="grid2">
        <div>
          <label className="lbl" htmlFor={'q' + b.id}>Số lượng</label>
          <input id={'q' + b.id} inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, '').slice(0, 5))} />
        </div>
        <div>
          <label className="lbl" htmlFor={'s' + b.id}>Kệ</label>
          <select id={'s' + b.id} value={shelf} onChange={e => setShelf(e.target.value)}>
            <option value="">Chưa chọn kệ</option>{shelves.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {n === 0 && <p className="note warn">Hết hàng thì bấm Bán hết thay vì để số lượng 0.</p>}
      <label className="lbl">{noHsd ? 'HSD in trên bao bì' : 'Hạn sử dụng'}</label>
      {noHsd && <p className="note">Đang lưu ngày nhắc {fmt(b.expiry_date)} từ ExpiryDay. Nhập HSD thật để app tính đúng ngày báo trả, giảm giá.</p>}
      <DateInput initial={noHsd ? undefined : b.expiry_date} onChange={setDate} />
      {b.expiry_note === 'estimated' && (
        <label className="check"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />HSD này đúng với bao bì (bỏ chữ ước tính)</label>
      )}
      <div className="actions">
        <button className="pri" disabled={busy || n < 1 || !exp} onClick={save}>Lưu</button>
        <button disabled={busy} onClick={() => upd({ status: 'sold_out' }, 'sold_out')}>Bán hết</button>
        {b.status !== 'on_shelf' && <button disabled={busy} onClick={() => upd({ status: 'on_shelf' }, 'undo')}>Hoàn tác {b.status === 'discounted' ? 'giảm giá' : 'báo trả'}</button>}
        {canDelete(member) && <button className="danger" disabled={busy} onClick={() => confirm('Xóa lô này? Lô bị ẩn khỏi danh sách, vẫn còn trong bản sao lưu.') && upd({ deleted_at: new Date().toISOString() }, 'delete')}>Xóa</button>}
      </div>
      {msg && <p className="msg bad">{msg}</p>}
    </div>
  );
}
