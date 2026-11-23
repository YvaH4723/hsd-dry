import { useEffect, useRef, useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { codeVariants, findByCode, pname, PRODUCT_COLS, searchProducts, useNames, useShelves, useTerms, type Product } from '../lib/db.ts';
import { actionFor, termFor } from '../lib/action.ts';
import { localAddCodes, addBatchOffline, incrBatchOffline, isNet, loadBatches } from '../lib/offline.ts';
import { daysLeft, fmt, whoLine } from '../lib/dates.ts';
import ProductInfo, { ProductRow, confirmAttach, attachCode, codeOwner } from '../components/ProductInfo.tsx';
import ActionLine from '../components/ActionLine.tsx';
import Scanner from '../components/Scanner.tsx';
import DateInput, { type DateVal } from '../components/DateInput.tsx';
import Icon from '../components/Icon.tsx';
import type { LotRow } from '../components/Lot.tsx';
import { ask } from '../components/Ask.tsx';

const LAST_SHELF = 'hsd.lastShelf';
type Msg = { text: string; tone?: 'bad' | 'ok' | 'warn' } | null;
const NO_DATE: DateVal = { exp: null, mfg: null, empty: true };

// Nhập lô nhanh: quét mã SP (hoặc QR kệ), nhớ kệ vừa dùng, Lưu xong quét tiếp ngay.
export default function AddBatch({ member, initial }: { member: Member; initial?: Product }) {
  const store = member.store_id;
  const { shelves } = useShelves(store);
  const terms = useTerms(store);
  const names = useNames();
  const [product, setProduct] = useState<Product | null>(initial ?? null);
  const [existing, setExisting] = useState<LotRow[] | null>(null);
  const [shelf, setShelf] = useState(() => { try { return localStorage.getItem(LAST_SHELF) ?? ''; } catch { return ''; } });
  const [qty, setQty] = useState('1');
  const [date, setDate] = useState<DateVal>(NO_DATE);
  const [dateKey, setDateKey] = useState(0);
  const [noRet, setNoRet] = useState(false);          // riêng lô này không đổi trả: chỉ dán giảm giá
  const [msg, setMsg] = useState<Msg>(null);
  const [unknown, setUnknown] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Product[] | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);                 // chỉ nhận kết quả của lần tìm mới nhất
  const timer = useRef(0);

  // Lô đang có của sản phẩm vừa chọn: tránh nhập trùng, cho cộng dồn vào lô cùng HSD.
  useEffect(() => {
    setExisting(null);
    if (!product) return;
    let live = true;
    loadBatches(store, { productId: product.id }).then(d => live && setExisting(d), () => {});
    return () => { live = false; };
  }, [product?.id]);

  // Đổi sang sản phẩm khác: bỏ cờ "không đổi trả"; đã gõ NSX cho món trước thì xóa ô ngày (HSD gõ trước rồi quét thì giữ).
  const choose = (p: Product) => {
    if (p.id !== product?.id) { setNoRet(false); if (date.mfg) { setDate(NO_DATE); setDateKey(k => k + 1); } }
    setProduct(p); setUnknown(''); setQ(''); setHits(null);
  };
  const pickShelf = (id: string) => { setShelf(id); try { localStorage.setItem(LAST_SHELF, id); } catch { /* */ } };

  async function onCode(code: string) {
    const sh = shelves.find(s => s.qr_code === code || s.qr_code === code.replace(/^KE:/, ''));
    if (sh) { pickShelf(sh.id); setMsg({ text: 'Đã chọn kệ ' + sh.name, tone: 'ok' }); return; }
    const n = ++seq.current;
    setMsg({ text: 'Đang tìm ' + code + '…' });
    try {
      const p = await findByCode(store, code);
      if (n !== seq.current) return;
      setMsg(null);
      if (p) return choose(p);
      setProduct(null);
      if (/^\d{6,14}$/.test(code)) { setUnknown(code); setQ(''); setHits(null); return; }   // mã vạch lạ: gắn vào sản phẩm
      setUnknown(''); setQ(code); search(code);                                            // gõ tên / một phần mã AX
    } catch (e: any) { if (n === seq.current) setMsg({ text: e.message, tone: 'bad' }); }
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

  // Mã chưa có trong danh mục: chọn đúng sản phẩm để gắn mã, lần sau quét là ra.
  async function attach(p: Product) {
    const code = unknown;
    if (!await confirmAttach(p, code)) return;
    setBusy(true);
    try {
      const r = await attachCode(store, p, code);
      if (r.offline) { choose(p); return setMsg({ text: r.error + ' Vẫn thêm lô được, có mạng thì quét lại để gắn.', tone: 'warn' }); }
      if (!r.codes) return setMsg({ text: r.error!, tone: 'bad' });
      choose({ ...p, barcodes: [...(p.barcodes ?? []), ...r.codes.map(code => ({ code }))] });
      setMsg({ text: `Đã gắn mã ${code} cho sản phẩm này. Lần sau quét là ra.`, tone: 'ok' });
    } finally { setBusy(false); }
  }

  const n = Math.max(1, parseInt(qty) || 1);
  const sh = shelves.find(s => s.id === shelf);
  useEffect(() => { if (shelf && shelves.length && !sh) setShelf(''); }, [shelves, shelf]);   // kệ đã lưu không còn (bị xóa / tài khoản khác)
  // Chỉ cộng vào lô còn trên kệ: lô đã báo trả / dán giảm giá xử lý riêng, cộng vào sẽ mất dấu hộp mới.
  const same = existing?.find(l => l.status === 'on_shelf' && l.expiry_note !== 'action_date' && l.expiry_date === date.exp && !!l.no_return === noRet);
  const canMerge = same && (same.shelf_id ?? '') === shelf;

  function reset(text: string) {
    setProduct(null); setQty('1'); setDate(NO_DATE); setDateKey(k => k + 1); setNoRet(false);
    setMsg({ text, tone: 'ok' });
  }
  async function save() {
    if (!product || !date.exp) return;
    const d = daysLeft(date.exp);
    if ((d < 0 || d > 5 * 365) && !await ask({ title: `HSD ${fmt(date.exp)} ${d < 0 ? `đã quá ${-d} ngày` : 'xa hơn 5 năm'}`, body: 'Có gõ nhầm năm không? Kiểm tra lại ngày in trên bao bì.', ok: 'Vẫn lưu' })) return;
    setBusy(true);
    try {
      const row = { product_id: product.id, shelf_id: shelf || null, qty: n, expiry_date: date.exp, mfg_date: date.mfg, no_return: noRet };
      const view = { ...row, expiry_note: null, status: 'on_shelf', shelves: sh ? { name: sh.name } : null,
        products: { id: product.id, name: product.name, name_vi: product.name_vi, ax_code: product.ax_code, brand: product.brand, vendor_id: product.vendor_id,
          no_return: product.no_return, sanh_dieu: product.sanh_dieu, category: product.category, vendors: product.vendors ?? null } };
      const { offline } = await addBatchOffline(store, row, view);
      setSaved(s => [`${pname(product)} · SL ${n} · HSD ${fmt(date.exp!)}${offline ? ' · chờ gửi' : ''}`, ...s].slice(0, 5));
      reset(offline ? 'Đã lưu trên máy (đang mất mạng), có mạng sẽ tự gửi. Quét món tiếp theo.' : 'Đã lưu. Quét món tiếp theo.');
    } catch (e: any) { setMsg({ text: 'Chưa lưu được: ' + e.message, tone: 'bad' }); }
    finally { setBusy(false); }
  }
  async function merge() {
    if (!product || !same) return;
    setBusy(true);
    try {
      await incrBatchOffline(store, same.id, n, { qty: same.qty });
      setSaved(s => [`${pname(product)} · cộng ${n} vào lô HSD ${fmt(same.expiry_date)} (giờ SL ${same.qty + n})`, ...s].slice(0, 5));
      reset(`Đã cộng ${n} vào lô cũ. Quét món tiếp theo.`);
    } catch (e: any) { setMsg({ text: 'Chưa lưu được: ' + e.message, tone: 'bad' }); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Scanner onCode={onCode} />
      {msg && <p className={`msg ${msg.tone ?? ''}`} role="status">{msg.text}</p>}

      {(unknown || q) && !product && (
        <>
          {unknown && <p className="note warn">Chưa có mã <b className="num">{unknown}</b> trong danh mục. Tìm đúng sản phẩm để gắn mã này:</p>}
          <div className="search"><Icon name="search" size={18} />
            <input aria-label="Tìm sản phẩm" placeholder="Tên sản phẩm hoặc mã AX" value={q} onChange={e => type(e.target.value)} />
          </div>
          {hits && !hits.length && <p className="note">Không tìm thấy “{q.trim()}”.</p>}
          {hits && hits.length > 0 && <div className="list">{hits.map(p => <ProductRow key={p.id} p={p} onClick={() => unknown ? !busy && attach(p) : choose(p)} />)}</div>}
          {unknown && (member.role === 'admin'
            ? <NewProduct store={store} code={unknown} name={q} created={p => { choose(p); setMsg({ text: `Đã tạo sản phẩm và gắn mã ${unknown}. Lần sau quét là ra.`, tone: 'ok' }); }} />
            : <p className="note">Không có trong danh mục thì nhờ quản trị viên tạo sản phẩm này.</p>)}
        </>
      )}

      {(product || !(unknown || q)) && <div className="panel">
        {product ? (
          <div className="found pi" key={product.id}>
            <ProductInfo p={product} member={member} terms={terms} onChange={setProduct} />
            {existing && existing.length > 0 && (
              <div className="exist">
                <span className="note">Đang có {existing.length} lô:</span>
                {existing.slice(0, 6).map(l => (
                  <span className="pill num" key={l.id}>{l.expiry_note === 'action_date' ? 'chưa có HSD' : fmt(l.expiry_date)} · SL {l.qty}{l.shelves ? ' · ' + l.shelves.name : ''}{whoLine(l, names) && ' · ' + whoLine(l, names)}</span>
                ))}
              </div>
            )}
          </div>
        ) : <p className="note">Quét mã vạch, hoặc gõ mã vạch, mã AX, tên sản phẩm ở trên.</p>}
      </div>}

      <div className="panel">
        <label className="lbl" htmlFor="ab-shelf">Kệ</label>
        <select id="ab-shelf" value={shelf} onChange={e => pickShelf(e.target.value)}>
          <option value="">Chưa chọn kệ</option>
          {shelves.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="lbl" htmlFor="ab-qty">Số lượng</label>
        <div className="stepper">
          <button type="button" aria-label="Bớt 1" disabled={n <= 1} onClick={() => setQty(String(n - 1))}><Icon name="minus" /></button>
          <input id="ab-qty" inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, '').slice(0, 5))} onBlur={() => setQty(String(n))} />
          <button type="button" aria-label="Thêm 1" onClick={() => setQty(String(n + 1))}><Icon name="plus" /></button>
        </div>
        <label className="lbl">Hạn sử dụng</label>
        <DateInput key={dateKey} onChange={setDate} needMfg={!!(product && terms && termFor(product, terms.idx).pct)} />
        {product && <label className="check"><input type="checkbox" checked={noRet} onChange={e => setNoRet(e.target.checked)} />Lô này không đổi trả, chỉ dán giảm giá</label>}
      </div>

      <div className="savebar">
        {product && date.exp && terms && <ActionLine a={actionFor({ expiry_date: date.exp, expiry_note: null, no_return: noRet, mfg_date: date.mfg }, product, terms)} status="on_shelf" />}
        {same && (
          <p className="note warn">
            Đã có lô cùng HSD {sh?.id === same.shelf_id ? 'trên kệ này' : same.shelves ? 'trên ' + same.shelves.name : 'chưa gắn kệ'} (SL {same.qty}).
            {canMerge ? ' Cộng vào lô đó cho gọn.' : ''}
          </p>
        )}
        {canMerge ? (
          <div className="grid2">
            <button className="pri" disabled={busy} onClick={merge}>Cộng vào lô cũ</button>
            <button disabled={busy} onClick={save}>Lưu lô mới</button>
          </div>
        ) : (
          <button className="pri block" disabled={busy || !product || !date.exp} onClick={save}>
            {!product ? 'Chọn sản phẩm để lưu' : !date.exp ? 'Nhập hạn sử dụng để lưu' : `Lưu lô · SL ${n}`}
          </button>
        )}
      </div>

      {saved.length > 0 && (
        <section className="grp">
          <div className="sec"><h2>Vừa lưu</h2></div>
          <div className="list">{saved.map((s, i) => <div className="li li-body note" key={i}>{s}</div>)}</div>
        </section>
      )}
    </>
  );
}

// Hàng mới chưa có trong file danh mục (file cũ hơn hàng trên kệ): tạo sản phẩm ngay tại chỗ, gắn luôn mã vừa quét.
// Danh mục "Tạo trong app" không bị ẩn khi nhập lại file GTB.
function NewProduct({ store, code, name: initName, created }: { store: string; code: string; name: string; created: (p: Product) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [ax, setAx] = useState('');
  const [price, setPrice] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return <button className="block" onClick={() => { setName(initName.trim()); setOpen(true); }}><Icon name="plus" size={18} />Không có trong danh sách? Tạo sản phẩm mới</button>;

  async function save() {
    setBusy(true); setErr('');
    try {
      const owner = await codeOwner(store, code);                          // mã đã thuộc sản phẩm khác: không tạo sản phẩm mồ côi
      if (owner) return setErr(`Mã ${code} đang thuộc "${owner}". Tìm sản phẩm đó ở ô tìm phía trên, hoặc gỡ mã ở sản phẩm đó trước.`);
      const { data, error } = await supabase.from('products').insert({
        store_id: store, name: name.trim(), ax_code: ax.trim() || null, price: parseInt(price.replace(/\D/g, '')) || null,
        active: true, category: 'Tạo trong app',
      }).select('id').single();
      if (error) throw error;
      const codes = (/^\d{11,12}$/.test(code) ? codeVariants(code) : [code]).map(c => ({ store_id: store, product_id: data.id, code: c }));
      const b = await supabase.from('barcodes').upsert(codes, { onConflict: 'store_id,code', ignoreDuplicates: true }).select('code');
      if (b.error) throw b.error;
      if (!b.data?.length) alert(`Đã tạo sản phẩm nhưng mã ${code} đang gắn với sản phẩm khác (hoặc đã bị gỡ) nên chưa gắn vào sản phẩm mới.`);
      const { data: p, error: e2 } = await supabase.from('products').select(PRODUCT_COLS).eq('id', data.id).single();
      if (e2) throw e2;
      created(p as unknown as Product);
    } catch (e: any) {
      setErr(isNet(e) ? 'Đang mất mạng: tạo sản phẩm cần có mạng.' : /duplicate|unique/i.test(e.message) ? `Mã AX ${ax.trim()} đã có: gõ mã AX đó vào ô tìm ở trên để chọn.` : 'Lỗi: ' + e.message);
    } finally { setBusy(false); }
  }
  return (
    <div className="panel stack">
      <h2>Tạo sản phẩm mới · mã <span className="num">{code}</span></h2>
      <label className="lbl" htmlFor="np-name">Tên (như trên tem giá)</label>
      <input id="np-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ Cotobe Coconut Shell Candle Mango (150g)" />
      <div className="grid2">
        <div><label className="lbl" htmlFor="np-ax">Mã AX (nếu có)</label><input id="np-ax" value={ax} onChange={e => setAx(e.target.value.toUpperCase())} placeholder="H202107" /></div>
        <div><label className="lbl" htmlFor="np-price">Giá</label><input id="np-price" inputMode="numeric" value={price} onChange={e => setPrice(e.target.value)} placeholder="250000" /></div>
      </div>
      <button className="pri block" disabled={busy || name.trim().length < 3} onClick={save}>{busy ? 'Đang tạo…' : 'Tạo và gắn mã'}</button>
      {err && <p className="msg bad">{err}</p>}
    </div>
  );
}
