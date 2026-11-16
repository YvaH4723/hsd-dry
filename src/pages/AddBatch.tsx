import { useEffect, useRef, useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { codeVariants, findByCode, pname, searchProducts, useShelves, useTerms, type Product } from '../lib/db.ts';
import { actionFor } from '../lib/action.ts';
import { addBatchOffline, isNet, loadBatches, updateBatchOffline } from '../lib/offline.ts';
import { fmt } from '../lib/dates.ts';
import ProductInfo, { ProductRow } from '../components/ProductInfo.tsx';
import ActionLine from '../components/ActionLine.tsx';
import Scanner from '../components/Scanner.tsx';
import DateInput, { type DateVal } from '../components/DateInput.tsx';
import Icon from '../components/Icon.tsx';
import type { LotRow } from '../components/Lot.tsx';

const LAST_SHELF = 'hsd.lastShelf';
type Msg = { text: string; tone?: 'bad' | 'ok' | 'warn' } | null;
const NO_DATE: DateVal = { exp: null, mfg: null, empty: true };

// Nhập lô nhanh: quét mã SP (hoặc QR kệ), nhớ kệ vừa dùng, Lưu xong quét tiếp ngay.
export default function AddBatch({ member, initial }: { member: Member; initial?: Product }) {
  const store = member.store_id;
  const { shelves } = useShelves(store);
  const terms = useTerms(store);
  const [product, setProduct] = useState<Product | null>(initial ?? null);
  const [existing, setExisting] = useState<LotRow[] | null>(null);
  const [shelf, setShelf] = useState(() => { try { return localStorage.getItem(LAST_SHELF) ?? ''; } catch { return ''; } });
  const [qty, setQty] = useState('1');
  const [date, setDate] = useState<DateVal>(NO_DATE);
  const [dateKey, setDateKey] = useState(0);
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

  const choose = (p: Product) => { setProduct(p); setUnknown(''); setQ(''); setHits(null); };
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
    const rows = (/^\d{11,12}$/.test(code) ? codeVariants(code) : [code]).map(c => ({ store_id: store, product_id: p.id, code: c }));
    setBusy(true);
    try {
      const { data, error } = await supabase.from('barcodes').upsert(rows, { onConflict: 'store_id,code', ignoreDuplicates: true }).select('code');
      if (error && isNet(error)) { choose(p); return setMsg({ text: `Đang mất mạng: chưa gắn được mã ${code}. Vẫn thêm lô được, có mạng thì quét lại để gắn.`, tone: 'warn' }); }
      if (error) return setMsg({ text: 'Lỗi gắn mã: ' + error.message, tone: 'bad' });
      if (!data?.length) {
        const { data: o } = await supabase.from('barcodes').select('deleted_at,products(name)').eq('store_id', store).in('code', rows.map(r => r.code)).limit(1).maybeSingle();
        return setMsg({ text: `Không gắn được: mã ${code} đã thuộc "${(o as any)?.products?.name ?? 'sản phẩm khác'}"${(o as any)?.deleted_at ? ' (đã xóa)' : ''}.`, tone: 'bad' });
      }
      choose({ ...p, barcodes: [...(p.barcodes ?? []), ...data.map(d => ({ code: d.code as string }))] });
      setMsg({ text: `Đã gắn mã ${code} cho sản phẩm này. Lần sau quét là ra.`, tone: 'ok' });
    } finally { setBusy(false); }
  }

  const n = Math.max(1, parseInt(qty) || 1);
  const sh = shelves.find(s => s.id === shelf);
  const same = existing?.find(l => l.expiry_note !== 'action_date' && l.expiry_date === date.exp);
  const canMerge = same && (same.shelf_id ?? '') === shelf;

  function reset(text: string) {
    setProduct(null); setQty('1'); setDate(NO_DATE); setDateKey(k => k + 1);
    setMsg({ text, tone: 'ok' });
  }
  async function save() {
    if (!product || !date.exp) return;
    setBusy(true);
    try {
      const row = { product_id: product.id, shelf_id: shelf || null, qty: n, expiry_date: date.exp, mfg_date: date.mfg };
      const view = { ...row, expiry_note: null, status: 'on_shelf', shelves: sh ? { name: sh.name } : null,
        products: { id: product.id, name: product.name, name_vi: product.name_vi, ax_code: product.ax_code, brand: product.brand, vendor_id: product.vendor_id,
          no_return: product.no_return, sanh_dieu: product.sanh_dieu, vendors: product.vendors ?? null } };
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
      await updateBatchOffline(store, same.id, { qty: same.qty + n }, 'edit', { qty: same.qty });
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
                  <span className="pill num" key={l.id}>{l.expiry_note === 'action_date' ? 'chưa có HSD' : fmt(l.expiry_date)} · SL {l.qty}{l.shelves ? ' · ' + l.shelves.name : ''}</span>
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
        <DateInput key={dateKey} onChange={setDate} />
      </div>

      <div className="savebar">
        {product && date.exp && terms && <ActionLine a={actionFor({ expiry_date: date.exp, expiry_note: null }, product, terms)} status="on_shelf" />}
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
