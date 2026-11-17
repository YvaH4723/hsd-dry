import { useEffect, useRef, useState } from 'react';
import { canWrite, type Member } from '../supabase.ts';
import { pname, useShelves, useTerms, useZones, zoneFilter } from '../lib/db.ts';
import ZoneChips from '../components/ZoneChips.tsx';
import { loadBatches, updateBatchOffline } from '../lib/offline.ts';
import { actionFor, type Action } from '../lib/action.ts';
import { daysLeft } from '../lib/dates.ts';
import LotInfo, { LotsLoading, type LotRow } from '../components/Lot.tsx';
import Icon from '../components/Icon.tsx';

type Item = { l: LotRow; a: Action };
type Btn = [status: string, label: string, pri?: boolean];
const SOON = 7;
const DONE: Record<string, string> = { sold_out: 'Đã bán hết', discarded: 'Đã hủy', return_notified: 'Đã báo trả', discounted: 'Đã dán giảm giá', returned: 'NCC đã lấy', on_shelf: 'Đã đưa về trên kệ' };

// "Hôm nay cần làm": quá HSD → quá ngày báo trả → báo trả trong 7 ngày → cần dán giảm giá → chờ NCC lấy.
// Lô quá HSD chỉ nằm ở nhóm Quá HSD, không lặp ở nhóm khác.
export default function Today({ member, rev, onHistory }: { member: Member; rev?: number; onHistory?: () => void }) {
  const store = member.store_id, write = canWrite(member);
  const terms = useTerms(store);
  const { shelves } = useShelves(store);
  const { zones } = useZones(store);
  const mine = member.zones ?? [];
  const [zone, setZone] = useState(mine.length ? 'mine' : 'all');
  const [lots, setLots] = useState<LotRow[] | null>(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);

  const load = () => loadBatches(store, {}).then(d => { setErr(''); setLots(d); }, (e: Error) => setErr(e.message));
  useEffect(() => { load(); }, [store, rev]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); } }, [toast]);

  const busy = useRef(new Set<string>());                                   // chặn bấm đúp
  async function mark(l: LotRow, status: string, undoable = true) {
    if (busy.current.has(l.id)) return;
    busy.current.add(l.id);
    const prev = l.status;
    setLots(ls => ls && ls.map(x => x.id === l.id ? { ...x, status } : x));        // đổi ngay trên màn, gửi sau
    try {
      await updateBatchOffline(store, l.id, { status }, status === 'on_shelf' ? 'undo' : status, { status: prev }, undefined, l.updated_at);
      setToast({ text: `${DONE[status]}: ${pname(l.products)}`, undo: undoable ? () => { setToast(null); mark({ ...l, status }, prev, false); } : undefined });
    } catch (e: any) { const m = 'Chưa lưu được: ' + e.message; await load(); setErr(m); }
    busy.current.delete(l.id);
  }

  if (!lots || !terms) return err ? <p className="msg bad">{err}</p> : <LotsLoading />;
  const inZone = zoneFilter(zone, mine, shelves);
  const all: Item[] = lots.filter(inZone).map(l => ({ l, a: actionFor(l, l.products, terms) }));
  const expired = ({ l }: Item) => l.expiry_note !== 'action_date' && daysLeft(l.expiry_date) < 0;
  const open = all.filter(x => x.l.status === 'on_shelf' && !expired(x));
  const left = (x: Item) => daysLeft(x.a.date);
  const byDate = (x: Item, y: Item) => x.a.date.localeCompare(y.a.date);
  const groups: { title: string; tone: string; items: Item[]; btns: (x: Item) => Btn[]; note?: string }[] = [
    { title: 'Quá HSD', tone: 'bad', items: all.filter(x => expired(x) && (x.l.status === 'on_shelf' || x.l.status === 'discounted')),
      btns: x => [['discarded', 'Đã hủy', true], ...(x.a.kind === 'return' ? [['return_notified', 'Đã báo trả'] as Btn] : []), SOLD] },
    { title: 'Quá ngày báo trả', tone: 'bad', items: open.filter(x => x.a.kind === 'return' && left(x) < 0).sort(byDate), btns: retBtns },
    { title: `Báo trả trong ${SOON} ngày`, tone: 'warn', items: open.filter(x => x.a.kind === 'return' && left(x) >= 0 && left(x) <= SOON).sort(byDate), btns: retBtns },
    { title: 'Cần dán giảm giá', tone: 'warn', items: open.filter(x => x.a.kind === 'discount' && left(x) <= SOON).sort(byDate), btns: () => [['discounted', 'Đã dán giảm giá', true], SOLD] },
    { title: 'Đến ngày nhắc, chưa có HSD', tone: 'warn', items: open.filter(x => x.a.kind === 'reminder' && left(x) <= SOON).sort(byDate), btns: retBtns },
    { title: 'Đã báo trả, chờ NCC lấy', tone: 'acc', items: all.filter(x => x.l.status === 'return_notified').sort(byDate), btns: () => [['returned', 'NCC đã lấy', true], ['on_shelf', 'Hoàn tác']] },
  ];
  const todo = groups.reduce((n, g) => n + g.items.length, 0);
  // Chưa rõ điều khoản mà HSD đã gần: có thể NCC cho trả hàng sớm hơn mốc giảm giá 45 ngày, cần đặt điều khoản ngay.
  const shown = new Set(groups.flatMap(g => g.items.map(x => x.l.id)));
  const unclear = open.filter(x => x.a.kind === 'discount' && x.a.label && daysLeft(x.l.expiry_date) <= 120 && !shown.has(x.l.id)).sort(byDate);
  if (unclear.length) groups.push({ title: 'Chưa rõ điều khoản, HSD còn dưới 120 ngày', tone: 'warn', items: unclear, btns: () => [SOLD],
    note: 'App đang tạm tính dán giảm giá trước HSD 45 ngày. Nếu NCC cho trả hàng, quản trị viên đặt điều khoản (mở sản phẩm hoặc Khác → Điều khoản) để không lỡ hạn báo trả.' });
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <>
      <p className="summary">{today.charAt(0).toUpperCase() + today.slice(1)}{todo > 0 && <> · <b>{todo}</b> lô cần xử lý</>}</p>
      <ZoneChips zones={zones} mine={mine} value={zone} onChange={setZone} />
      {err && <p className="msg bad">{err}</p>}
      {!todo && (
        <div className="empty">
          <Icon name="checkCircle" size={32} />
          <b>Hôm nay không có việc gì</b>
          <span>Lô sắp đến ngày báo trả hoặc dán giảm giá (trong {SOON} ngày) sẽ hiện ở đây.</span>
        </div>
      )}
      {groups.filter(g => g.items.length).map(g => (
        <section className="grp" key={g.title}>
          <div className="sec"><h2><span className={`dot ${g.tone}`} />{g.title}</h2><span className="cnt">{g.items.length} lô</span></div>
          {g.note && <p className="note">{g.note}</p>}
          <div className="list">
            {g.items.map(x => (
              <div className="li li-body" key={x.l.id}>
                <LotInfo l={x.l} a={x.a} />
                {write && (
                  <div className="actions">
                    {g.btns(x).map(([status, label, pri]) => <button key={status} className={`sm ${pri ? 'pri' : ''}`} onClick={() => mark(x.l, status)}>{label}</button>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      {onHistory && <button className="ghost block" onClick={onHistory}>Xem lô đã xử lý, khôi phục khi bấm nhầm</button>}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button onClick={toast.undo}>Hoàn tác</button>}
        </div>
      )}
    </>
  );
}

// Lô báo trả (hoặc lô chưa có HSD, chỉ có ngày nhắc: chưa biết báo trả hay giảm giá nên cho cả hai nút).
const retBtns = (x: Item): Btn[] => [['return_notified', 'Đã báo trả', true], ...(x.a.kind === 'reminder' ? [['discounted', 'Đã dán giảm giá'] as Btn] : []), SOLD];
// Lên kệ kiểm thì hàng đã bán hết: bỏ lô khỏi danh sách.
const SOLD: Btn = ['sold_out', 'Bán hết'];
