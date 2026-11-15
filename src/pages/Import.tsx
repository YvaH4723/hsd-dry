import { useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { diffCatalog, type Existing, type Preview } from '../lib/cadencia.ts';
import { resolveVendors, type VendorTerm } from '../lib/terms.ts';

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// Đọc sheet đầu, tự tìm dòng tiêu đề (file Cadencia có 3 dòng đầu không phải tiêu đề).
export async function readRows(file: File, col = 'AX Code', what = 'GTB Cadencia'): Promise<Record<string, unknown>[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const h = aoa.findIndex((r, i) => i < 20 && r.some(c => String(c ?? '').trim() === col));
  if (h < 0) throw new Error(`Không thấy cột "${col}" trong 20 dòng đầu. Có đúng file ${what} không?`);
  const head = aoa[h].map(c => String(c ?? '').trim());
  return aoa.slice(h + 1).filter(r => r.some(c => c != null && c !== '')).map(r => Object.fromEntries(head.map((k, i) => [k, r[i]])));
}

async function loadExisting(store: string): Promise<Existing[]> {
  const out: Existing[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase.from('products').select('ax_code,name,price,active,category,vendors(code)')
      .eq('store_id', store).not('ax_code', 'is', null).is('deleted_at', null).order('ax_code').range(i, i + 999);
    if (error) throw error;
    out.push(...data.map((p: any) => ({ ax: p.ax_code, name: p.name, price: p.price == null ? null : Number(p.price), vendorCode: p.vendors?.code ?? '', active: p.active, keep: p.category === 'Từ ExpiryDay' })));
    if (data.length < 1000) return out;
  }
}

export default function Import({ member }: { member: Member }) {
  const store = member.store_id;
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(f?: File) {
    if (!f) return;
    setBusy(true); setPrev(null); setMsg('Đang đọc file…');
    try {
      const r = await readRows(f);
      setMsg('Đang so với danh mục hiện có…');
      setRows(r); setPrev(diffCatalog(r, await loadExisting(store))); setMsg('');
    } catch (e: any) { setMsg('Lỗi: ' + e.message); }
    setBusy(false);
  }

  async function apply() {
    if (!prev) return;
    setBusy(true);
    try {
      const write = [...prev.added, ...prev.updated.map(u => u.item)];
      setMsg('Đang ghi NCC…');
      const vend = new Map(write.map(i => [i.vendorCode, i.vendorName]));
      const vrows = [...vend].filter(([c]) => c).map(([code, name]) => ({ store_id: store, code, name: name || code }));
      const vid = new Map<string, string>();
      for (const c of chunks(vrows, 500)) {
        const { data, error } = await supabase.from('vendors').upsert(c, { onConflict: 'store_id,code' }).select('id,code');
        if (error) throw error;
        data.forEach(v => vid.set(v.code, v.id));
      }
      const pid = new Map<string, string>();
      for (const [n, c] of chunks(write, 500).entries()) {
        setMsg(`Đang ghi sản phẩm ${Math.min((n + 1) * 500, write.length)}/${write.length}…`);
        const { data, error } = await supabase.from('products').upsert(c.map(i => ({
          store_id: store, ax_code: i.ax, name: i.name, name_search: i.nameSearch, brand: i.brand || null,
          vendor_id: vid.get(i.vendorCode) ?? null, price: i.price, dept_group: i.group, category: i.category || null, active: true,
        })), { onConflict: 'store_id,ax_code' }).select('id,ax_code');
        if (error) throw error;
        data.forEach(p => pid.set(p.ax_code, p.id));
      }
      // Mã vạch chỉ thêm cho sản phẩm mới; mã nhân viên đã gắn cho sản phẩm cũ giữ nguyên.
      const bc = prev.added.flatMap(i => i.barcodes.map(code => ({ store_id: store, product_id: pid.get(i.ax)!, code })));
      for (const [n, c] of chunks(bc, 1000).entries()) {
        setMsg(`Đang ghi mã vạch ${Math.min((n + 1) * 1000, bc.length)}/${bc.length}…`);
        const { error } = await supabase.from('barcodes').upsert(c, { onConflict: 'store_id,code', ignoreDuplicates: true });
        if (error) throw error;
      }
      for (const c of chunks(prev.hidden.map(h => h.ax), 200)) {
        setMsg('Đang ẩn sản phẩm không còn trong file…');
        const { error } = await supabase.from('products').update({ active: false }).eq('store_id', store).in('ax_code', c);
        if (error) throw error;
      }
      await supabase.from('import_runs').insert({ store_id: store, kind: 'cadencia', added: prev.added.length, updated: prev.updated.length,
        unchanged: prev.unchanged, errors: prev.errors.length, hidden: prev.hidden.length });
      setMsg(`Xong: thêm ${prev.added.length}, cập nhật ${prev.updated.length}, ẩn ${prev.hidden.length}.`);
      setPrev(null); setRows([]);
    } catch (e: any) { setMsg('Lỗi khi ghi (chưa ghi hết, chọn lại file để làm tiếp): ' + e.message); }
    setBusy(false);
  }

  return (
    <>
      <ContactImport store={store} />
      <div className="card">
        <b>Nhập danh mục GTB Cadencia</b>
        <p className="mute">Chỉ cập nhật tên, giá, NCC. Không đụng lô HSD, ảnh, kệ. Sản phẩm không còn trong file sẽ bị ẩn, không xóa.</p>
        <input type="file" accept=".xlsx,.xls" disabled={busy} onChange={e => pick(e.target.files?.[0])} />
      </div>
      {msg && <p className={msg.startsWith('Lỗi') ? 'bad' : 'mute'}>{msg}</p>}
      {prev && (
        <div className="card">
          <div className="stats">
            <div><b className="ok">{prev.added.length}</b>Thêm mới</div>
            <div><b>{prev.updated.length}</b>Cập nhật</div>
            <div><b className="mute">{prev.unchanged}</b>Không đổi</div>
            <div><b className="warn">{prev.hidden.length}</b>Sẽ ẩn</div>
            <div><b className="bad">{prev.errors.length}</b>Lỗi (bỏ qua)</div>
          </div>
          <p className="mute">{rows.length} dòng trong file.</p>
          {prev.updated.slice(0, 10).map(u => <div className="item mute" key={u.item.ax}>{u.item.ax} {u.item.name}: đổi {u.changes.join(', ')}</div>)}
          {prev.hidden.slice(0, 10).map(h => <div className="item warn" key={h.ax}>Ẩn: {h.ax} {h.name}</div>)}
          {prev.errors.slice(0, 20).map(e => <div className="item bad" key={e.row}>Dòng {e.row}: {e.reason}</div>)}
          <button className="pri" style={{ width: '100%', marginTop: 12 }} disabled={busy || !(prev.added.length + prev.updated.length + prev.hidden.length)} onClick={apply}>
            Xác nhận ghi
          </button>
        </div>
      )}
    </>
  );
}

// Contact List (sheet DRY): mỗi NCC một điều khoản cấp NCC. Điều khoản bạn đã sửa tay trong app được giữ nguyên.
// Không đọc cột BUYER NAME và sheet "Mail tổng NCC".
function ContactImport({ store }: { store: string }) {
  const [vt, setVt] = useState<VendorTerm[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(f?: File) {
    if (!f) return;
    setBusy(true); setMsg('Đang đọc file…'); setVt(null);
    try {
      const rows = await readRows(f, 'VENDOR CODE', 'Contact List');
      setVt(resolveVendors(rows.map(r => ({ code: r['VENDOR CODE'], name: r['VENDOR NAME'], category: r['CATEGORY'], term: r['Đổi trả hàng'] }))));
      setMsg('');
    } catch (e: any) { setMsg('Lỗi: ' + e.message); }
    setBusy(false);
  }

  async function apply() {
    if (!vt) return;
    setBusy(true);
    try {
      setMsg('Đang ghi NCC…');
      const vid = new Map<string, string>();
      for (const c of chunks(vt.map(v => ({ store_id: store, code: v.code, name: v.name })), 500)) {
        const { data, error } = await supabase.from('vendors').upsert(c, { onConflict: 'store_id,code' }).select('id,code');
        if (error) throw error;
        data.forEach(v => vid.set(v.code, v.id));
      }
      const { data: old, error: e1 } = await supabase.from('terms').select('id,vendor_id,source').eq('store_id', store)
        .is('brand', null).is('product_id', null).is('deleted_at', null).limit(5000);
      if (e1) throw e1;
      const cur = new Map(old.map(t => [t.vendor_id, t]));
      const rows = vt.map(v => ({ store_id: store, vendor_id: vid.get(v.code)!, action: v.action, days: v.days, raw_text: v.raw, needs_review: v.review, source: 'file' }));
      const kept = rows.filter(r => cur.get(r.vendor_id)?.source === 'manual').length;
      const upd = rows.filter(r => cur.get(r.vendor_id)?.source === 'file').map(r => ({ ...r, id: cur.get(r.vendor_id)!.id }));
      const ins = rows.filter(r => !cur.has(r.vendor_id));
      setMsg('Đang ghi điều khoản…');
      for (const c of chunks(upd, 500)) { const { error } = await supabase.from('terms').upsert(c, { onConflict: 'id' }); if (error) throw error; }
      for (const c of chunks(ins, 500)) { const { error } = await supabase.from('terms').insert(c); if (error) throw error; }
      await supabase.from('import_runs').insert({ store_id: store, kind: 'contact_list', added: ins.length, updated: upd.length, unchanged: kept });
      setMsg(`Xong: thêm ${ins.length}, cập nhật ${upd.length}, giữ nguyên ${kept} điều khoản đã sửa tay.`);
      setVt(null);
    } catch (e: any) { setMsg('Lỗi khi ghi: ' + e.message); }
    setBusy(false);
  }

  const n = (f: (v: VendorTerm) => boolean) => vt?.filter(f).length ?? 0;
  return (
    <div className="card">
      <b>Nhập điều khoản (Contact List)</b>
      <p className="mute">Đọc sheet DRY. Không lấy tên buyer. Điều khoản đã sửa tay trong app được giữ nguyên.</p>
      <input type="file" accept=".xlsx,.xls" disabled={busy} onChange={e => pick(e.target.files?.[0])} />
      {msg && <p className={msg.startsWith('Lỗi') ? 'bad' : 'mute'}>{msg}</p>}
      {vt && (
        <>
          <div className="stats" style={{ marginTop: 10 }}>
            <div><b>{vt.length}</b>NCC</div>
            <div><b className="ok">{n(v => !v.review && v.action === 'return')}</b>Báo trả</div>
            <div><b>{n(v => !v.review && v.action === 'discount')}</b>Giảm giá</div>
            <div><b className="warn">{n(v => v.review)}</b>Cần chọn tay</div>
          </div>
          <button className="pri" style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={apply}>Xác nhận ghi</button>
        </>
      )}
    </div>
  );
}
