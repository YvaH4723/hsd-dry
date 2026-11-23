// In biển tên (kiểu máy PDA): quét sản phẩm cần in biển, bấm xác nhận để thêm vào danh sách chung của cả nhóm.
// Quét lại món đã có: cộng 1 biển. Xuất Excel 3 cột (mã sản phẩm, tên, số lượng biển) cho phần mềm in.
import { useEffect, useRef, useState } from 'react';
import { supabase, canWrite, type Member } from '../supabase.ts';
import { findByCode, pname, searchProducts, type Product } from '../lib/db.ts';
import { isNet } from '../lib/offline.ts';
import Scanner from '../components/Scanner.tsx';
import Icon from '../components/Icon.tsx';
import { ask } from '../components/Ask.tsx';
import { ProductRow, confirmAttach, attachCode } from '../components/ProductInfo.tsx';
import { saveXlsx } from '../lib/xlsxSave.ts';

interface Label { id: string; product_id: string; qty: number; created_at: string; updated_at: string; products: { name: string; name_vi: string | null; ax_code: string | null } | null }
type Sort = 'time' | 'name' | 'ax';
const SORT_KEY = 'hsd.label-sort';
const SEL = 'id,product_id,qty,created_at,updated_at,products(name,name_vi,ax_code)';
const nm = (l: Label) => l.products ? pname(l.products as Product) : '';
const errText = (e: any) => isNet(e) ? 'Đang mất mạng: danh sách in biển cần có mạng.' : 'Lỗi: ' + e.message;

export default function Labels({ member }: { member: Member }) {
  const store = member.store_id, write = canWrite(member);
  const [list, setList] = useState<Label[] | null>(null);
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem(SORT_KEY) as Sort) || 'time');
  const [found, setFound] = useState<Product | null>(null);
  const [unknown, setUnknown] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Product[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0), timer = useRef(0);

  async function load() {
    const { data, error } = await supabase.from('labels').select(SEL).eq('store_id', store).order('created_at', { ascending: false });
    if (error) return setMsg({ text: errText(error), tone: 'bad' });
    setList(data as unknown as Label[]);
  }
  useEffect(() => {
    load();
    const f = () => document.visibilityState === 'visible' && load();      // người khác vừa quét thêm: mở lại app là thấy
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [store]);

  const reset = () => { setFound(null); setUnknown(''); setQ(''); setHits(null); };
  async function onCode(code: string) {
    const n = ++seq.current;
    reset(); setMsg({ text: 'Đang tìm ' + code + '…' });
    try {
      const p = await findByCode(store, code);
      if (n !== seq.current) return;
      setMsg(null);
      if (p) return setFound(p);
      if (/^\d{6,14}$/.test(code)) return setUnknown(code);              // mã vạch lạ: tìm sản phẩm để gắn
      setQ(code); search(code);
    } catch (e: any) { if (n === seq.current) setMsg({ text: errText(e), tone: 'bad' }); }
  }
  async function search(v: string) {
    const n = ++seq.current;
    if (v.trim().length < 2) return setHits(null);
    const { data, error } = await searchProducts(store, v, 20);
    if (n !== seq.current) return;
    setMsg(error ? { text: error.message, tone: 'bad' } : null);
    setHits(data);
  }
  const type = (v: string) => { setQ(v); clearTimeout(timer.current); timer.current = window.setTimeout(() => search(v), 250); };

  async function pick(p: Product) {
    if (!unknown) { setFound(p); setQ(''); setHits(null); return; }
    if (!await confirmAttach(p, unknown)) return;
    setBusy(true);
    const r = await attachCode(store, p, unknown).finally(() => setBusy(false));
    if (!r.codes) return setMsg({ text: r.error!, tone: 'bad' });
    setMsg({ text: `Đã gắn mã ${unknown}. Lần sau quét là ra.`, tone: 'ok' });
    setUnknown(''); setQ(''); setHits(null); setFound(p);
  }

  async function add() {
    if (!found) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('label_add', { p_store: store, p_product: found.id });
      if (error) throw error;
      const row: Label = { ...(data as any), products: { name: found.name, name_vi: found.name_vi, ax_code: found.ax_code } };
      setList(l => [row, ...(l ?? []).filter(x => x.id !== row.id)]);
      setMsg({ text: row.qty > 1 ? `Đã có trong danh sách: giờ in ${row.qty} biển. Quét món tiếp theo.` : 'Đã thêm. Quét món tiếp theo.', tone: 'ok' });
      setFound(null);
    } catch (e: any) { setMsg({ text: errText(e), tone: 'bad' }); }
    finally { setBusy(false); }
  }
  // Bấm +/− nhanh: gửi lần lượt từng lệnh, lệnh sau chỉ chạy khi lệnh trước xong, nên máy chủ luôn giữ số cuối cùng.
  const chain = useRef(Promise.resolve());
  function setQty(l: Label, qty: number) {
    qty = Math.min(999, Math.max(1, qty || 1));
    setList(xs => xs!.map(x => x.id === l.id ? { ...x, qty } : x));
    chain.current = chain.current.then(async () => {
      const { error } = await supabase.from('labels').update({ qty }).eq('id', l.id);
      if (error) { setMsg({ text: errText(error), tone: 'bad' }); load(); }
    });
  }
  async function remove(l: Label) {
    if (!await ask({ title: 'Bỏ khỏi danh sách in?', body: l.products ? pname(l.products as Product) : '', ok: 'Bỏ', danger: true })) return;
    const { error } = await supabase.from('labels').delete().eq('id', l.id);
    if (error) return setMsg({ text: errText(error), tone: 'bad' });
    setList(xs => xs!.filter(x => x.id !== l.id));
  }
  async function clearAll() {
    const ids = list!.map(x => x.id);
    if (!await ask({ title: `Xóa hết ${ids.length} sản phẩm đang hiện?`, body: 'Món đồng nghiệp vừa quét thêm mà chưa hiện trên máy này được giữ lại. Nên xuất Excel trước.', ok: 'Xóa hết', danger: true })) return;
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('labels').delete().in('id', ids.slice(i, i + 200));
      if (error) { load(); return setMsg({ text: errText(error), tone: 'bad' }); }
    }
    await load();
    setMsg({ text: 'Đã xóa các sản phẩm đã hiện. Món người khác vừa thêm (nếu có) vẫn còn.', tone: 'ok' });
  }
  const [saving, setSaving] = useState(false);
  async function exportXlsx() {
    if (saving) return;
    setSaving(true);
    try {
    const XLSX = await import('xlsx');
    const rows = sorted.map(l => ({ 'Mã sản phẩm': l.products?.ax_code ?? '', 'Tên sản phẩm': l.products?.name ?? '', 'Số lượng': l.qty }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 60 }, { wch: 9 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Biển tên');
    const d = new Date(), p2 = (n: number) => String(n).padStart(2, '0');
    await saveXlsx(wb, `bien-ten-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.xlsx`);
    } catch (e: any) { setMsg({ text: 'Chưa xuất được file: ' + e.message, tone: 'bad' }); }
    finally { setSaving(false); }
  }

  const sorted = [...(list ?? [])].sort(
    sort === 'name' ? (a, b) => nm(a).localeCompare(nm(b), 'vi')
    : sort === 'ax' ? (a, b) => (a.products?.ax_code ?? '~').localeCompare(b.products?.ax_code ?? '~')
    : (a, b) => b.updated_at.localeCompare(a.updated_at));                 // quét lại món cũ: nhảy lên đầu
  const total = sorted.reduce((s, l) => s + l.qty, 0), noAx = sorted.filter(l => !l.products?.ax_code).length;
  const inList = found && list?.find(l => l.product_id === found.id);

  return (
    <>
      <h2 className="title">In biển tên</h2>
      {msg && !write && <p className={`msg ${msg.tone ?? ''}`} role="status">{msg.text}</p>}
      {write && <>
        <Scanner onCode={onCode} />
        {msg && <p className={`msg ${msg.tone ?? ''}`} role="status">{msg.text}</p>}
        {(unknown || q) && !found && (
          <>
            {unknown && <p className="note warn">Chưa có mã <b className="num">{unknown}</b> trong danh mục. Tìm đúng sản phẩm để gắn mã này:</p>}
            <div className="search"><Icon name="search" size={18} />
              <input aria-label="Tìm sản phẩm" placeholder="Tên sản phẩm hoặc mã AX" value={q} onChange={e => type(e.target.value)} />
            </div>
            {hits && !hits.length && <p className="note">Không tìm thấy “{q.trim()}”.</p>}
            {hits && hits.length > 0 && <div className="list">{hits.map(p => <ProductRow key={p.id} p={p} onClick={() => !busy && pick(p)} />)}</div>}
          </>
        )}
        {found && (
          <div className="panel stack">
            <div><b>{pname(found)}</b><div className="note num">{found.ax_code ?? 'Chưa có mã AX'}</div></div>
            {inList && <p className="note">Đã có trong danh sách ({inList.qty} biển). Xác nhận sẽ cộng thêm 1.</p>}
            {!found.ax_code && <p className="note warn">Sản phẩm này chưa có mã AX: file xuất sẽ để trống cột mã.</p>}
            <div className="grid2">
              <button className="pri" disabled={busy} onClick={add}>{inList ? 'Cộng thêm 1 biển' : 'Xác nhận thêm'}</button>
              <button disabled={busy} onClick={() => setFound(null)}>Bỏ qua</button>
            </div>
          </div>
        )}
      </>}

      <div className="sec"><h2>Danh sách ({sorted.length} sản phẩm · {total} biển)</h2></div>
      {sorted.length > 0 && <>
        <div className="seg" role="group" aria-label="Sắp xếp">
          {([['time', 'Mới quét'], ['name', 'Tên'], ['ax', 'Mã']] as [Sort, string][]).map(([k, t]) => (
            <button key={k} aria-pressed={sort === k} onClick={() => { setSort(k); localStorage.setItem(SORT_KEY, k); }}>{t}</button>
          ))}
        </div>
        {noAx > 0 && <p className="note warn">{noAx} sản phẩm chưa có mã AX.</p>}
        <div className="list">
          {sorted.map(l => (
            <div className="li label-row" key={l.id}>
              <div className="grow">
                <div>{l.products ? pname(l.products as Product) : 'Sản phẩm đã bị xóa'}</div>
                <div className="note num">{l.products?.ax_code ?? 'Chưa có mã AX'}</div>
              </div>
              {write ? <>
                <div className="stepper sm">
                  <button type="button" aria-label="Bớt 1 biển" disabled={l.qty <= 1} onClick={() => setQty(l, l.qty - 1)}><Icon name="minus" /></button>
                  <QtyInput value={l.qty} onSet={v => setQty(l, v)} />
                  <button type="button" aria-label="Thêm 1 biển" onClick={() => setQty(l, l.qty + 1)}><Icon name="plus" /></button>
                </div>
                <button className="icon" aria-label="Bỏ khỏi danh sách" onClick={() => remove(l)}><Icon name="x" size={18} /></button>
              </> : <span className="num">{l.qty}</span>}
            </div>
          ))}
        </div>
        <button className="pri block" disabled={saving} onClick={exportXlsx}><Icon name="download" size={18} />Xuất Excel</button>
        {write && <button className="danger block" onClick={clearAll}>Xóa hết danh sách</button>}
      </>}
      {list && !sorted.length && <p className="note">Chưa có sản phẩm nào. Quét mã ở trên rồi bấm Xác nhận thêm.</p>}
      {!list && !msg && <p className="note">Đang tải…</p>}
    </>
  );
}

// Ô số biển: gõ tự do (xóa hết để gõ số mới), rời ô mới lưu.
function QtyInput({ value, onSet }: { value: number; onSet: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return <input inputMode="numeric" aria-label="Số biển" value={v} onChange={e => setV(e.target.value.replace(/\D/g, '').slice(0, 3))}
    onBlur={() => { const n = Math.min(999, Math.max(1, parseInt(v) || 1)); setV(String(n)); if (n !== value) onSet(n); }} />;
}
