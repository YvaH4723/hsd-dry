import { useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { audit, codeVariants, findByCode, money, pname, searchProducts, useShelves, useTerms, type Product } from '../lib/db.ts';
import { actionFor } from '../lib/action.ts';
import ProductInfo, { vendorText } from '../components/ProductInfo.tsx';
import ActionLine from '../components/ActionLine.tsx';
import { fmt } from '../lib/dates.ts';
import Scanner from '../components/Scanner.tsx';
import DateInput from '../components/DateInput.tsx';

const LAST_SHELF = 'hsd.lastShelf';

// Nhập lô nhanh: quét mã SP (hoặc QR kệ), nhớ kệ vừa dùng, Lưu xong quét tiếp ngay.
export default function AddBatch({ member, initial, onClose }: { member: Member; initial?: Product; onClose: () => void }) {
  const store = member.store_id;
  const { shelves } = useShelves(store);
  const terms = useTerms(store);
  const [product, setProduct] = useState<Product | null>(initial ?? null);
  const [shelf, setShelf] = useState(() => localStorage.getItem(LAST_SHELF) ?? '');
  const [qty, setQty] = useState('1');
  const [date, setDate] = useState<{ exp: string | null; mfg: string | null }>({ exp: null, mfg: null });
  const [dateKey, setDateKey] = useState(0);
  const [msg, setMsg] = useState('');
  const [unknown, setUnknown] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Product[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function onCode(code: string) {
    const sh = shelves.find(s => s.qr_code === code || s.qr_code === code.replace(/^KE:/, ''));
    if (sh) { pickShelf(sh.id); setMsg('Kệ: ' + sh.name); return; }
    setMsg('Đang tìm ' + code + '…');
    const p = await findByCode(store, code);
    if (p) { setProduct(p); setUnknown(''); setQ(''); setHits([]); setMsg(''); return; }
    setProduct(null); setMsg('');
    if (/^\d{6,14}$/.test(code)) { setUnknown(code); setQ(''); setHits([]); return; }   // mã vạch lạ: gắn vào sản phẩm
    setUnknown(''); search(code);                                                      // gõ tên / một phần mã AX: chọn trong danh sách
  }
  const pickShelf = (id: string) => { setShelf(id); localStorage.setItem(LAST_SHELF, id); };

  async function search(v: string) {
    setQ(v);
    if (v.trim().length < 2) return setHits([]);
    const { data } = await searchProducts(store, v, 20);
    setHits((data as unknown as Product[]) ?? []);
  }
  // Mã chưa có trong danh mục: chọn đúng sản phẩm để gắn mã, lần sau quét là ra.
  async function attach(p: Product) {
    if (unknown) {
      const rows = (/^\d{11,12}$/.test(unknown) ? codeVariants(unknown) : [unknown]).map(code => ({ store_id: store, product_id: p.id, code }));
      const { data, error } = await supabase.from('barcodes').upsert(rows, { onConflict: 'store_id,code', ignoreDuplicates: true }).select('code');
      if (error) return setMsg('Lỗi gắn mã: ' + error.message);
      if (!data?.length) {
        const { data: o } = await supabase.from('barcodes').select('deleted_at,products(name)').eq('store_id', store).in('code', rows.map(r => r.code)).limit(1).maybeSingle();
        return setMsg(`Không gắn được: mã ${unknown} đã thuộc "${(o as any)?.products?.name ?? 'sản phẩm khác'}"${(o as any)?.deleted_at ? ' (đã xóa)' : ''}.`);
      }
    }
    setProduct(p); setUnknown(''); setQ(''); setHits([]); setMsg('Đã gắn mã ' + unknown + ' cho sản phẩm này.');
  }

  async function save() {
    if (!product || !date.exp) return;
    setBusy(true);
    const row = { store_id: store, product_id: product.id, shelf_id: shelf || null, qty: Math.max(0, parseInt(qty) || 0), expiry_date: date.exp, mfg_date: date.mfg };
    const { data, error } = await supabase.from('batches').insert(row).select('id').single();
    setBusy(false);
    if (error) return setMsg('Lỗi lưu: ' + error.message);
    audit(store, data.id, 'add', null, row);
    setSaved(s => [`${pname(product)} · SL ${row.qty} · HSD ${fmt(date.exp!)}`, ...s].slice(0, 5));
    setProduct(null); setQty('1'); setDate({ exp: null, mfg: null }); setDateKey(k => k + 1); setMsg('Đã lưu. Quét món tiếp theo.');
  }

  return (
    <>
      <div className="row"><b style={{ flex: 1 }}>Thêm lô</b><button style={{ flex: '0 0 auto' }} onClick={onClose}>Đóng</button></div>
      <Scanner onCode={onCode} />
      {msg && <p className="mute">{msg}</p>}

      {(unknown || q) && !product && (
        <div className="card">
          {unknown
            ? <p className="warn" style={{ marginTop: 0 }}>Không thấy mã <b>{unknown}</b> trong danh mục. Tìm sản phẩm để gắn mã này:</p>
            : <p className="mute" style={{ marginTop: 0 }}>Chọn sản phẩm:</p>}
          <input placeholder="Gõ tên sản phẩm hoặc mã AX" value={q} onChange={e => search(e.target.value)} />
          {q.trim().length >= 2 && !hits.length && <p className="mute">Không tìm thấy.</p>}
          {hits.map(p => (
            <div className="item click" key={p.id} onClick={() => unknown ? attach(p) : (setProduct(p), setQ(''), setHits([]))}>
              {pname(p)}
              {p.name_vi && <div className="mute">{p.name}</div>}
              <div className="mute">{[p.ax_code, p.brand, money(p.price)].filter(Boolean).join(' · ')}</div>
              <div className="mute">NCC: {vendorText(p)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <label style={{ marginTop: 0 }}>Sản phẩm</label>
        {product ? <ProductInfo p={product} member={member} terms={terms} onChange={setProduct} /> : <span className="mute">Quét mã vạch, hoặc gõ mã vạch / mã AX / tên sản phẩm ở trên</span>}
        <label>Kệ</label>
        <select value={shelf} onChange={e => pickShelf(e.target.value)}>
          <option value="">— Chưa chọn kệ —</option>
          {shelves.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label>Số lượng</label>
        <input inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ''))} />
        <label>Hạn sử dụng</label>
        <DateInput key={dateKey} onChange={setDate} />
        {product && date.exp && terms && <ActionLine a={actionFor({ expiry_date: date.exp, expiry_note: null }, product, terms)} status="on_shelf" />}
        <button className="pri" style={{ width: '100%', marginTop: 12 }} disabled={busy || !product || !date.exp} onClick={save}>Lưu lô</button>
      </div>
      {saved.length > 0 && <div className="card"><span className="mute">Vừa lưu</span>{saved.map((s, i) => <div className="item" key={i}>{s}</div>)}</div>}
    </>
  );
}
