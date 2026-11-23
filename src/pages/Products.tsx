import { useEffect, useRef, useState } from 'react';
import { supabase, canWrite, type Member } from '../supabase.ts';
import { findByCode, pname, listVendors, searchByCode, searchProducts, useTerms, vendorProducts, type Product, type Vendor } from '../lib/db.ts';
import { unaccent } from '../lib/cadencia.ts';
import ProductInfo, { ProductRow } from '../components/ProductInfo.tsx';
import BatchList from '../components/BatchList.tsx';
import Icon from '../components/Icon.tsx';
import Scanner from '../components/Scanner.tsx';
import { LotsLoading } from '../components/Lot.tsx';
import { localActive, localNoCode, useSync } from '../lib/offline.ts';

const SHOW = 200;
const PAGE = 100;
const attached = new Set<string>();     // đã gắn mã trong phiên này: bỏ khỏi danh sách Chưa có mã vạch ngay
const vcode = (v: Vendor) => v.code.startsWith('TB-') ? 'chưa có mã NCC' : v.code;

export default function Products({ member, onAdd, rev }: { member: Member; onAdd: (p: Product) => void; rev?: number }) {
  const store = member.store_id;
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Product[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Product | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [picking, setPicking] = useState(false);
  const [nocode, setNocode] = useState(false);
  const [scan, setScan] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const scanOn = useRef(false); scanOn.current = scan;
  const [ncTb, setNcTb] = useState(false);
  const [ncQ, setNcQ] = useState('');
  const [all, setAll] = useState<Product[] | null>(null);       // toàn bộ sản phẩm của NCC đang chọn
  const terms = useTerms(store);
  const [cat, setCat] = useState<Product[] | null>(null);       // cả danh mục đang bán, hiện sẵn khi chưa gõ tìm
  const [inStock, setInStock] = useState(false);
  const [more, setMore] = useState(PAGE);
  const { syncedAt } = useSync();                            // máy vừa tải dữ liệu mới (sau khi nhập tồn kho…): đọc lại danh sách
  useEffect(() => { localActive().then(setCat, () => setCat([])); }, [store, rev, syncedAt]);

  useEffect(() => {
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', store).eq('active', true).is('deleted_at', null)
      .then(({ count }) => setTotal(count));
  }, [store]);

  // Chọn NCC: tải hết sản phẩm của NCC đó.
  useEffect(() => {
    setAll(null);
    if (!vendor) return;
    let live = true;
    vendorProducts(store, vendor.id).then(d => { if (live) { setAll(d); setErr(''); } }, (e: Error) => live && setErr(e.message));
    return () => { live = false; };
  }, [vendor?.id]);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setRows(null); if (!vendor) setErr(''); return; }
    let live = true;
    const t = setTimeout(async () => {
      const res = /^\d{6,14}$/.test(s) ? await searchByCode(store, s) : await searchProducts(store, s, 50, vendor?.id);
      if (!live) return;                       // đã gõ tiếp: bỏ kết quả cũ
      setErr(res.error?.message ?? '');
      setRows(vendor ? res.data.filter(p => p.vendor_id === vendor.id) : res.data);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, store, vendor?.id]);

  if (nocode && !open) return <NoCode tb={ncTb} setTb={setNcTb} q={ncQ} setQ={setNcQ} back={() => setNocode(false)} openP={p => { setOpen(p); scrollTo(0, 0); }} />;
  if (picking) return <VendorPicker store={store} pick={v => { setVendor(v); setPicking(false); scrollTo(0, 0); }} back={() => setPicking(false)} />;

  if (open) return (
    <>
      <button className="back" onClick={() => setOpen(null)}><Icon name="back" size={20} />Quay lại</button>
      <div className="panel">
        <ProductInfo p={open} member={member} terms={terms} onChange={p => { p.barcodes?.length ? attached.add(p.id) : attached.delete(p.id); const up = (r: Product[] | null) => r && r.map(x => x.id === p.id ? p : x); setOpen(p); setRows(up); setAll(up); setCat(up); }} />
      </div>
      {canWrite(member) && <button className="pri block" onClick={() => onAdd(open)}><Icon name="plus" size={18} />Thêm lô cho sản phẩm này</button>}
      <div className="sec"><h2>Lô đang theo dõi</h2></div>
      <BatchList member={member} productId={open.id} rev={rev} />
    </>
  );

  async function onScan(code: string) {
    setScanMsg('Đang tìm ' + code + '…');
    try {
      const p = await findByCode(store, code);
      if (!scanOn.current) return;                 // đã bấm Đóng quét trong lúc tìm
      if (p) { setScan(false); setScanMsg(''); setOpen(p); scrollTo(0, 0); }
      else setScanMsg(`Chưa có mã ${code} trong danh mục. Quét món khác, hoặc gắn mã ở Chưa có mã vạch.`);
    } catch (e) { setScanMsg((e as Error).message); }
  }

  const list = (ps: Product[]) => (
    <>
      <div className="list">{ps.slice(0, SHOW).map(r => <ProductRow key={r.id} p={r} onClick={() => { setOpen(r); scrollTo(0, 0); }} />)}</div>
      {ps.length > SHOW && <p className="note">Còn {ps.length - SHOW} sản phẩm, gõ thêm để lọc.</p>}
    </>
  );

  return (
    <>
      <div className="search"><Icon name="search" size={18} />
        <input type="search" enterKeyHint="search" aria-label="Tìm sản phẩm" placeholder={vendor ? 'Tìm trong NCC này' : 'Tên, mã AX hoặc mã vạch'} value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {scan ? (
        <>
          <Scanner auto onCode={onScan} />
          {scanMsg && <p className="note" role="status">{scanMsg}</p>}
          <button className="block" onClick={() => { setScan(false); setScanMsg(''); }}><Icon name="x" size={18} />Đóng quét</button>
        </>
      ) : <button className="block" onClick={() => setScan(true)}><Icon name="camera" size={18} />Quét mã vạch để tìm</button>}
      {vendor ? (
        <div className="panel row" style={{ padding: '8px 6px 8px 14px' }}>
          <Icon name="truck" size={20} />
          <div className="grow"><div className="lot-name">{vendor.name}</div><div className="note">{vcode(vendor)}{all ? ` · ${all.length} sản phẩm` : ''}</div></div>
          <button className="sm ghost" onClick={() => setPicking(true)}>Đổi</button>
          <button className="icon" aria-label="Bỏ lọc NCC" onClick={() => setVendor(null)}><Icon name="x" /></button>
        </div>
      ) : (
        <div className="grid2">
          <button onClick={() => setPicking(true)}><Icon name="truck" size={18} />Theo NCC</button>
          <button onClick={() => { setNocode(true); scrollTo(0, 0); }}><Icon name="alert" size={18} />Chưa có mã vạch</button>
        </div>
      )}
      {err && <p className="msg bad">{err}</p>}
      {rows == null && !vendor && cat?.length ? <Catalog ps={cat} inStock={inStock} setInStock={v => { setInStock(v); setMore(PAGE); }} more={more} setMore={setMore} openP={p => { setOpen(p); scrollTo(0, 0); }} /> : null}
      {rows != null ? (rows.length ? list(rows) : !err && <p className="note">Không tìm thấy “{q.trim()}”{vendor ? ' trong NCC này' : ''}. Thử bớt chữ, hoặc gõ mã AX.</p>)
        : vendor ? (all == null ? (!err && <LotsLoading />) : all.length ? list(all) : <p className="note">NCC này chưa có sản phẩm nào trong danh mục.</p>)
        : cat?.length ? null : (
        <p className="note">
          {total == null ? 'Gõ ít nhất 2 ký tự: tên tiếng Việt hoặc tên gốc (không dấu cũng được), mã AX, mã vạch.'
            : `${total.toLocaleString('vi-VN')} sản phẩm đang bán. Gõ ít nhất 2 ký tự để tìm: tên (không dấu cũng được), mã AX, mã vạch.`}
          {total === 0 && member.role === 'admin' ? ' Chưa có danh mục: vào Khác → Nhập file.' : ''}
        </p>
      )}
    </>
  );
}

// Danh sách mặc định: mọi sản phẩm đang bán theo thứ tự chữ cái, lọc nhanh "Còn tồn", bấm Xem thêm để mở thêm.
function Catalog({ ps, inStock, setInStock, more, setMore, openP }: { ps: Product[]; inStock: boolean; setInStock: (v: boolean) => void; more: number; setMore: (n: number) => void; openP: (p: Product) => void }) {
  const have = ps.filter(p => Number(p.stock_qty) > 0), noData = !ps.some(p => p.stock_qty != null);
  const sel = inStock ? have : ps;
  return (
    <>
      {!noData && (
        <div className="seg" role="group" aria-label="Lọc">
          <button aria-pressed={!inStock} onClick={() => setInStock(false)}>Tất cả ({ps.length.toLocaleString('vi-VN')})</button>
          <button aria-pressed={inStock} onClick={() => setInStock(true)}>Còn tồn ({have.length.toLocaleString('vi-VN')})</button>
        </div>
      )}
      <div className="list">{sel.slice(0, more).map(r => <ProductRow key={r.id} p={r} onClick={() => openP(r)} />)}</div>
      {sel.length > more
        ? <button className="block" onClick={() => setMore(more + PAGE)}>Xem thêm ({(sel.length - more).toLocaleString('vi-VN')} sản phẩm nữa)</button>
        : <p className="note center">Hết danh sách ({sel.length.toLocaleString('vi-VN')} sản phẩm).</p>}
    </>
  );
}

// Chọn NCC: gõ tên hoặc mã NCC để lọc.
function VendorPicker({ store, pick, back }: { store: string; pick: (v: Vendor) => void; back: () => void }) {
  const [vs, setVs] = useState<Vendor[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { listVendors(store).then(setVs, (e: Error) => setErr(e.message)); }, [store]);
  const s = unaccent(q.trim());
  const shown = (vs ?? []).filter(v => !s || unaccent(`${v.name} ${v.code}`).includes(s));
  return (
    <>
      <button className="back" onClick={back}><Icon name="back" size={20} />Quay lại</button>
      <h2 className="title">Chọn nhà cung cấp</h2>
      <div className="search"><Icon name="search" size={18} />
        <input type="search" autoFocus aria-label="Tìm NCC" placeholder="Tên hoặc mã NCC" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {err && <p className="msg bad">{err}</p>}
      {vs == null ? (!err && <LotsLoading />) : !shown.length ? <p className="note">Không có NCC nào khớp.</p> : (
        <>
          <div className="list">
            {shown.slice(0, SHOW).map(v => (
              <div className="li" key={v.id}>
                <button className="li-main" onClick={() => pick(v)}>
                  <div className="grow"><div className="lot-name">{v.name}</div><div className="note num">{vcode(v)}</div></div>
                  <Icon name="chev" size={18} />
                </button>
              </div>
            ))}
          </div>
          {shown.length > SHOW && <p className="note">Còn {shown.length - SHOW} NCC, gõ thêm để lọc.</p>}
        </>
      )}
    </>
  );
}

// Sản phẩm chưa có mã vạch: đi kệ tìm hàng, mở sản phẩm, bấm "Quét mã vạch để gắn". Xếp theo nhóm hàng cho dễ đi theo kệ.
// tb, q giữ ở trang cha: mở sản phẩm rồi Quay lại vẫn đúng tab và chữ đang lọc.
function NoCode({ back, openP, tb, setTb, q, setQ }: { back: () => void; openP: (p: Product) => void; tb: boolean; setTb: (v: boolean) => void; q: string; setQ: (v: string) => void }) {
  const [ps, setPs] = useState<Product[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { localNoCode().then(d => setPs(d.filter(p => !attached.has(p.id))), (e: Error) => setErr(e.message)); }, []);
  const s = unaccent(q.trim());
  const sel = (ps ?? []).filter(p => p.active !== tb && (!s || unaccent(`${p.name} ${p.name_vi ?? ''} ${p.ax_code ?? ''} ${p.vendors?.name ?? ''} ${p.category ?? ''}`).includes(s)));
  const groups = new Map<string, Product[]>();
  for (const p of sel.sort((a, b) => pname(a).localeCompare(pname(b), 'vi'))) {
    const k = tb ? (p.vendors?.name ?? 'Chưa có NCC') : (p.category ?? 'Khác');
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const nOn = (ps ?? []).filter(p => p.active).length, nTb = (ps ?? []).length - nOn;
  let shown = 0;
  return (
    <>
      <button className="back" onClick={back}><Icon name="back" size={20} />Quay lại</button>
      <h2 className="title">Chưa có mã vạch</h2>
      <p className="note">Tìm hàng trên kệ, mở sản phẩm rồi bấm <b>Quét mã vạch để gắn</b>. Gắn xong sản phẩm tự biến khỏi danh sách.</p>
      <div className="seg" role="group" aria-label="Loại">
        <button aria-pressed={!tb} onClick={() => setTb(false)}>Đang bán ({nOn})</button>
        <button aria-pressed={tb} onClick={() => setTb(true)}>Chỉ trong file TB ({nTb})</button>
      </div>
      {tb && <p className="note">Hàng khu Dry có trong file tổng TB nhưng không có trong file GTB (có thể đã ngừng bán). Xếp theo NCC.</p>}
      <div className="search"><Icon name="search" size={18} />
        <input type="search" enterKeyHint="search" aria-label="Lọc" placeholder="Lọc theo tên, mã AX, NCC, nhóm" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {err && <p className="msg bad">{err}</p>}
      {ps == null ? (!err && <LotsLoading />) : !sel.length ? <p className="empty">Không có sản phẩm nào.</p> : [...groups].map(([k, items]) => {
        if (shown >= SHOW) return null;
        const part = items.slice(0, SHOW - shown); shown += part.length;
        return (
          <section key={k}>
            <div className="sec"><h2>{k}</h2><span className="cnt">{items.length}</span></div>
            <div className="list">{part.map(p => <ProductRow key={p.id} p={p} onClick={() => openP(p)} />)}</div>
          </section>
        );
      })}
      {sel.length > SHOW && <p className="note">Đang hiện {SHOW}/{sel.length}. Gõ vào ô lọc để thu hẹp.</p>}
    </>
  );
}
