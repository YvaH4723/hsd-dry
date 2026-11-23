import { useEffect, useRef, useState } from 'react';
import { canWrite, type Member } from '../supabase.ts';
import { pname, useNames, useShelves, useTerms, useZones, zoneFilter } from '../lib/db.ts';
import ZoneChips from '../components/ZoneChips.tsx';
import LotSearchBar, { useLotSearch } from '../components/LotSearch.tsx';
import { loadBatches, onResume, updateBatchOffline, useSync } from '../lib/offline.ts';
import { actionFor, type Action } from '../lib/action.ts';
import { daysLeft, fmt, whoLine } from '../lib/dates.ts';
import { LotsLoading, type LotRow } from '../components/Lot.tsx';
import Icon from '../components/Icon.tsx';

type Tone = 'bad' | 'ret' | 'disc' | 'pick';
type Tile = 'over' | 'ret' | 'disc' | 'pick';
type Btn = [status: string, label: string, pri?: boolean];
type Item = { l: LotRow; a: Action; tone: Tone; btns: Btn[]; meta: string };
type Group = { key: string; title: string; tone: Tone; tile: Tile; items: Item[]; note?: string };
type By = 'viec' | 'ncc' | 'ke';
const SOON = 7;
const DONE: Record<string, string> = { sold_out: 'Đã bán hết', discarded: 'Đã hủy', return_notified: 'Đã báo trả', discounted: 'Đã dán giảm giá', returned: 'NCC đã lấy', on_shelf: 'Đã đưa về trên kệ' };
const TILES: [Tile, string][] = [['over', 'Quá hạn'], ['ret', 'Báo trả'], ['disc', 'Giảm giá'], ['pick', 'Chờ NCC']];
const TILE_TONE: Record<Tile, Tone> = { over: 'bad', ret: 'ret', disc: 'disc', pick: 'pick' };
const BY_KEY = 'hsd.todayBy';
const when = (d: number) => d < 0 ? `quá ${-d} ngày` : d === 0 ? 'hôm nay' : `còn ${d} ngày`;

// "Hôm nay cần làm". Đầu trang: 4 ô đếm (bấm để chỉ xem việc đó). Dưới: nhóm gập/mở, tên nhóm dính đầu màn khi kéo.
// Mỗi lô một dòng; bấm vào mới hiện chi tiết và nút xử lý. Có thể gom theo việc, theo NCC hoặc theo kệ.
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
  const [tile, setTile] = useState<Tile | null>(null);
  const [by, setBy] = useState<By>(() => (localStorage.getItem(BY_KEY) as By) || 'viec');
  const [open, setOpen] = useState<Set<string> | null>(null);       // null: mặc định (nhóm quá hạn mở sẵn)
  const [row, setRow] = useState<string | null>(null);              // lô đang mở nút
  const search = useLotSearch();

  const load = () => loadBatches(store, {}).then(d => { setErr(''); setLots(d); }, (e: Error) => setErr(e.message));
  useEffect(() => { load(); return onResume(load); }, [store, rev]);
  const { failed } = useSync();
  useEffect(() => { if (failed.length) load(); }, [failed.length]);   // máy chủ từ chối thay đổi gửi sau: tải lại cho màn đúng thật
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { try { localStorage.setItem(BY_KEY, by); } catch { /* */ } }, [by]);
  useEffect(() => setOpen(null), [by, tile, search.active]);

  const busy = useRef(new Set<string>());                                   // chặn bấm đúp
  async function mark(l: LotRow, status: string, undoable = true) {
    if (busy.current.has(l.id)) return;
    busy.current.add(l.id);
    const prev = l.status;
    setRow(null);
    setLots(ls => ls && ls.map(x => x.id === l.id ? { ...x, status } : x));        // đổi ngay trên màn, gửi sau
    try {
      await updateBatchOffline(store, l.id, { status }, status === 'on_shelf' ? 'undo' : status, { status: prev }, undefined, l.updated_at);
      setToast({ text: `${DONE[status]}: ${pname(l.products)}`, undo: undoable ? () => { setToast(null); mark({ ...l, status }, prev, false); } : undefined });
    } catch (e: any) { const m = 'Chưa lưu được: ' + e.message; await load(); setErr(m); }
    busy.current.delete(l.id);
  }

  if (!lots || !terms) return err ? <p className="msg bad">{err}</p> : <LotsLoading />;
  const inZone = zoneFilter(zone, mine, shelves);
  const base = lots.filter(inZone).map(l => ({ l, a: actionFor(l, l.products, terms) }));
  const expired = (l: LotRow) => l.expiry_note !== 'action_date' && daysLeft(l.expiry_date) < 0;
  const open0 = base.filter(x => x.l.status === 'on_shelf' && !expired(x.l));
  const left = (x: { a: Action }) => daysLeft(x.a.date);
  const byDate = (x: { a: Action }, y: { a: Action }) => x.a.date.localeCompare(y.a.date);
  const mk = (tone: Tone, btns: (x: { l: LotRow; a: Action }) => Btn[], meta: (x: { l: LotRow; a: Action }) => string) =>
    (x: { l: LotRow; a: Action }): Item => ({ ...x, tone, btns: btns(x), meta: meta(x) });
  const retMeta = (x: { a: Action }) => `Báo trả trước ${fmt(x.a.date)} · ${when(left(x))}`;
  const groups: Group[] = [
    { key: 'hsd', title: 'Quá HSD, bỏ khỏi kệ', tone: 'bad', tile: 'over',
      items: base.filter(x => expired(x.l) && (x.l.status === 'on_shelf' || x.l.status === 'discounted')).sort((x, y) => x.l.expiry_date.localeCompare(y.l.expiry_date))
        .map(mk('bad', x => [['discarded', 'Đã hủy', true], ...(x.a.kind === 'return' ? [['return_notified', 'Đã báo trả'] as Btn] : []), SOLD], x => `Quá HSD ${-daysLeft(x.l.expiry_date)} ngày`)) },
    { key: 'late', title: 'Quá ngày báo trả', tone: 'bad', tile: 'over',                // NCC không nhận nữa: cho dán giảm giá
      items: open0.filter(x => x.a.kind === 'return' && left(x) < 0).sort(byDate).map(mk('bad', x => [...retBtns(x).slice(0, 1), ['discounted', 'Đã dán giảm giá'] as Btn, SOLD], retMeta)) },
    { key: 'soon', title: `Báo trả trong ${SOON} ngày`, tone: 'ret', tile: 'ret',
      items: open0.filter(x => x.a.kind === 'return' && left(x) >= 0 && left(x) <= SOON).sort(byDate).map(mk('ret', retBtns, retMeta)) },
    { key: 'remind', title: 'Đến ngày nhắc, chưa có HSD', tone: 'ret', tile: 'ret',
      items: open0.filter(x => x.a.kind === 'reminder' && left(x) <= SOON).sort(byDate).map(mk('ret', retBtns, x => `Nhắc ${fmt(x.a.date)} · ${when(left(x))} · chưa có HSD`)) },
    { key: 'watch', title: 'Sắp hết hạn (không đổi trả, không giảm giá)', tone: 'ret', tile: 'ret',
      items: open0.filter(x => x.a.kind === 'watch' && left(x) <= 0).sort(byDate).map(mk('ret', () => [['discarded', 'Đã hủy'], SOLD], x => `HSD ${fmt(x.l.expiry_date)} · còn ${daysLeft(x.l.expiry_date)} ngày`)) },
    { key: 'disc', title: 'Cần dán giảm giá', tone: 'disc', tile: 'disc',
      items: open0.filter(x => x.a.kind === 'discount' && left(x) <= SOON).sort(byDate).map(mk('disc', () => [['discounted', 'Đã dán giảm giá', true], SOLD], x => `Dán giảm giá từ ${fmt(x.a.date)} · ${when(left(x))}`)) },
    { key: 'pick', title: 'Đã báo trả, chờ NCC lấy', tone: 'pick', tile: 'pick',
      items: base.filter(x => x.l.status === 'return_notified').sort(byDate).map(mk('pick', () => [['returned', 'NCC đã lấy', true], ['on_shelf', 'Hoàn tác']], x => `Đã báo trả · ${x.l.expiry_note === 'action_date' ? 'chưa có HSD' : 'HSD ' + fmt(x.l.expiry_date)}`)) },
  ];
  // Chưa rõ điều khoản mà HSD đã gần: có thể NCC cho trả hàng sớm hơn mốc giảm giá 45 ngày, cần đặt điều khoản ngay.
  const shownIds = new Set(groups.flatMap(g => g.items.map(x => x.l.id)));
  groups.push({ key: 'unclear', title: 'Chưa rõ điều khoản, HSD dưới 120 ngày', tone: 'disc', tile: 'disc',
    items: open0.filter(x => x.a.kind === 'discount' && x.a.label && (daysLeft(x.l.expiry_date) <= 120 || x.a.needMfg) && !shownIds.has(x.l.id)).sort(byDate)
      .map(mk('disc', () => [SOLD], x => `HSD ${fmt(x.l.expiry_date)} · tạm dán giảm giá từ ${fmt(x.a.date)}`)),
    note: 'App đang tạm tính dán giảm giá trước HSD 45 ngày. Nếu NCC cho trả hàng, quản trị viên đặt điều khoản (mở sản phẩm hoặc Khác → Điều khoản) để không lỡ hạn báo trả.' });

  const found = groups.map(g => ({ ...g, items: g.items.filter(x => search.match(x.l)) }));
  const count = (t: Tile) => found.filter(g => g.tile === t && g.key !== 'unclear').reduce((n, g) => n + g.items.length, 0);
  const total = found.reduce((n, g) => n + g.items.length, 0);
  const picked = found.filter(g => g.items.length && (!tile || g.tile === tile));

  // Gom lại theo NCC hoặc kệ: giữ màu việc trên từng dòng.
  const view: Group[] = by === 'viec' ? picked : (() => {
    const m = new Map<string, Item[]>();
    for (const x of picked.flatMap(g => g.items)) {
      const k = by === 'ncc' ? (x.l.products.vendors?.name || x.l.products.vendors?.code || 'Chưa có NCC') : (x.l.shelves?.name ?? 'Chưa gắn kệ');
      m.set(k, [...(m.get(k) ?? []), x]);
    }
    const rank: Record<Tone, number> = { bad: 0, ret: 1, disc: 2, pick: 3 };
    return [...m].map(([k, items]) => {
      const tone = items.reduce<Tone>((t, x) => rank[x.tone] < rank[t] ? x.tone : t, 'pick');
      return { key: k, title: k, tone, tile: 'over' as Tile, items: items.sort((x, y) => rank[x.tone] - rank[y.tone] || byDate(x, y)) };
    }).sort((x, y) => rank[x.tone] - rank[y.tone] || x.title.localeCompare(y.title, 'vi'));
  })();
  // Mặc định: theo việc thì mở nhóm quá hạn (không có thì nhóm đầu); theo NCC/kệ thì mở hết. Đang lọc / tìm: mở hết.
  const isOpen = (g: Group) => (open ?? new Set(tile || search.active || by !== 'viec' ? view.map(v => v.key)
    : (view.some(v => v.tile === 'over') ? view.filter(v => v.tile === 'over') : view.slice(0, 1)).map(v => v.key))).has(g.key);
  const toggle = (g: Group) => {
    const cur = new Set(view.filter(isOpen).map(v => v.key));
    cur.has(g.key) ? cur.delete(g.key) : cur.add(g.key);
    setOpen(cur);
  };
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const allTodo = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <p className="summary">{today.charAt(0).toUpperCase() + today.slice(1)}{allTodo > 0 && <> · <b>{allTodo}</b> lô cần xử lý</>}</p>
      {allTodo > 0 && <LotSearchBar q={search.q} setQ={search.setQ} />}
      <ZoneChips zones={zones} mine={mine} value={zone} onChange={setZone} />
      {err && <p className="msg bad">{err}</p>}
      {allTodo > 0 && (
        <div className="tiles" role="group" aria-label="Lọc theo việc">
          {TILES.map(([t, label]) => {
            const n = count(t);
            return (
              <button key={t} className={`tile ${TILE_TONE[t]} ${n ? '' : 'zero'}`} aria-pressed={tile === t} onClick={() => setTile(tile === t ? null : t)}>
                <b className="num">{n}</b><span>{label}</span>
              </button>
            );
          })}
        </div>
      )}
      {allTodo > 0 && (
        <div className="seg" role="group" aria-label="Gom theo">
          {([['viec', 'Theo việc'], ['ncc', 'Theo NCC'], ['ke', 'Theo kệ']] as [By, string][]).map(([k, t]) =>
            <button key={k} aria-pressed={by === k} onClick={() => setBy(k)}>{t}</button>)}
        </div>
      )}
      {!allTodo && (
        <div className="empty">
          <Icon name="checkCircle" size={32} />
          <b>Hôm nay không có việc gì</b>
          <span>Lô sắp đến ngày báo trả hoặc dán giảm giá (trong {SOON} ngày) sẽ hiện ở đây.</span>
        </div>
      )}
      {allTodo > 0 && !view.length && (
        <p className="empty">{search.active ? `Không có lô nào cần xử lý khớp "${search.q.trim()}".` : 'Không có lô nào trong mục này.'}</p>
      )}
      {view.map(g => {
        const on = isOpen(g);
        return (
          <section className={`tgrp ${g.tone}`} key={g.key}>
            <button className="tgrp-h" aria-expanded={!!on} onClick={() => toggle(g)}>
              {by !== 'viec' && <Icon name={by === 'ncc' ? 'truck' : 'shelf'} size={17} />}
              <span className="tgrp-t">{g.title}</span>
              <span className="tgrp-n num">{g.items.length}</span>
              <Icon name="chev" size={18} />
            </button>
            {on && g.note && <p className="note">{g.note}</p>}
            {on && (
              <div className="list">
                {g.items.map(x => (
                  <TodayRow key={x.l.id} x={x} by={by} open={row === x.l.id} write={write}
                    onToggle={() => setRow(row === x.l.id ? null : x.l.id)} onMark={s => mark(x.l, s)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
      {onHistory && <button className="ghost block" onClick={onHistory}>Xem lô đã xử lý, khôi phục khi bấm nhầm</button>}
      {total !== allTodo && search.active && <p className="note center">Đang lọc {total}/{allTodo} lô theo "{search.q.trim()}"</p>}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button onClick={toast.undo}>Hoàn tác</button>}
        </div>
      )}
    </>
  );
}

function TodayRow({ x, by, open, write, onToggle, onMark }: { x: Item; by: By; open: boolean; write: boolean; onToggle: () => void; onMark: (s: string) => void }) {
  const p = x.l.products, shelf = x.l.shelves?.name ?? 'Chưa gắn kệ', vendor = p.vendors?.name || p.vendors?.code;
  const where = by === 'ke' ? (vendor ?? '') : shelf, who = whoLine(x.l, useNames());
  return (
    <div className="li">
      <button className="trow" aria-expanded={open} onClick={onToggle}>
        <span className={`kdot ${x.tone}`} aria-hidden="true" />
        <span className="trow-txt">
          <span className="trow-name">{pname(p)}</span>
          <span className={`trow-meta ${x.tone}`}>{x.meta}{where && <span className="mute"> · {where}</span>}</span>
        </span>
        <span className="trow-qty num">SL {x.l.qty}</span>
      </button>
      {open && (
        <div className="trow-more">
          <p className="facts-line">
            {x.l.expiry_note === 'action_date' ? <span className="pill">Chưa có HSD</span> : <span className="num">HSD {fmt(x.l.expiry_date)}</span>}
            {x.l.expiry_note === 'estimated' && <span className="pill">HSD ước tính</span>}
            <span>{shelf}</span>
            {vendor && <span>{vendor}</span>}
            {p.ax_code && <span className="num mute">{p.ax_code}</span>}
          </p>
          {who && <p className="note">{who}</p>}
          {x.a.label && x.a.kind !== 'reminder' && <p className="note warn">{x.a.label}{x.a.raw ? ': ' + x.a.raw.replace(/\n/g, ' / ') : ''}</p>}
          {write && (
            <div className="actions">
              {x.btns.map(([status, label, pri]) => <button key={status} className={`sm ${pri ? 'pri' : ''}`} onClick={() => onMark(status)}>{label}</button>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Lô báo trả (hoặc lô chưa có HSD, chỉ có ngày nhắc: chưa biết báo trả hay giảm giá nên cho cả hai nút).
const retBtns = (x: { a: Action }): Btn[] => [['return_notified', 'Đã báo trả', true], ...(x.a.kind === 'reminder' ? [['discounted', 'Đã dán giảm giá'] as Btn] : []), SOLD];
// Lên kệ kiểm thì hàng đã bán hết: bỏ lô khỏi danh sách.
const SOLD: Btn = ['sold_out', 'Bán hết'];
