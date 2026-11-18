import { useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { diffCatalog, diffTB, mapRow, TB_COL, vendorKey, type Existing, type Preview } from '../lib/cadencia.ts';

const mapAll = (rows: Record<string, unknown>[]) => rows.map(mapRow).filter(i => i.ax);
import { resolveVendors, type VendorTerm } from '../lib/terms.ts';
import { fetchAll, reloadTerms } from '../lib/db.ts';
import { refreshSnapshot } from '../lib/offline.ts';

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// Đọc sheet đầu (hoặc sheet tên `sheet` nếu có), tự tìm dòng tiêu đề (file Cadencia có 3 dòng đầu không phải tiêu đề).
export async function readRows(file: File, col: string | string[] = 'AX Code', what = 'GTB Cadencia', sheet?: string): Promise<Record<string, unknown>[]> {
  const XLSX = await import('xlsx');
  const cols = [col].flat();
  const wb = XLSX.read(await file.arrayBuffer());
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[(sheet && wb.SheetNames.find(n => n.trim().toUpperCase() === sheet)) || wb.SheetNames[0]], { header: 1, defval: null });
  const h = aoa.findIndex((r, i) => i < 20 && r.some(c => cols.includes(String(c ?? '').trim())));
  if (h < 0) throw new Error(`Không thấy cột ${cols.map(c => `"${c}"`).join(' hoặc ')} trong 20 dòng đầu. Có đúng file ${what} không?`);
  const head = aoa[h].map((c, i) => String(c ?? '').trim() || 'col' + i);   // cột không có tiêu đề: col6, col16…
  return aoa.slice(h + 1).filter(r => r.some(c => c != null && c !== '')).map(r => Object.fromEntries(head.map((k, i) => [k, r[i]])));
}

async function loadExisting(store: string): Promise<Existing[]> {
  const out: Existing[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase.from('products').select('id,ax_code,name,brand,price,active,category,vendors(code)')
      .eq('store_id', store).not('ax_code', 'is', null).is('deleted_at', null).order('ax_code').range(i, i + 999);
    if (error) throw error;
    out.push(...data.map((p: any) => ({ id: p.id, ax: String(p.ax_code).trim().toUpperCase(), name: p.name, brand: p.brand ?? '', price: p.price == null ? null : Number(p.price), vendorCode: p.vendors?.code ?? '', active: p.active, category: p.category, keep: p.category === 'Từ ExpiryDay' || p.category === 'Tạo trong app' })));
    if (data.length < 1000) return out;
  }
}

export default function Import({ member }: { member: Member }) {
  const store = member.store_id;
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [ids, setIds] = useState<Map<string, string>>(new Map());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(f?: File) {
    if (!f) return;
    setBusy(true); setPrev(null); setMsg('Đang đọc file…');
    try {
      const r = await readRows(f, ['AX Code', TB_COL], 'GTB Cadencia / Cadencia tổng TB');
      setMsg('Đang so với danh mục hiện có…');
      const ex = await loadExisting(store);
      setIds(new Map(ex.map(e => [e.ax, e.id!])));
      if (r.length && TB_COL in r[0]) {
        const vs = await fetchAll<{ code: string; name: string }>((a, b) => supabase.from('vendors').select('code,name').eq('store_id', store).is('deleted_at', null).order('code').range(a, b));
        setRows(r); setPrev(diffTB(r, ex, new Map(vs.map(v => [vendorKey(v.name), v.code]))));
      } else { setRows(r); setPrev(diffCatalog(r, ex)); }
      setMsg('');
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
        const { data, error } = await supabase.from('vendors').upsert(c, { onConflict: 'store_id,code', ignoreDuplicates: prev.mode === 'tb' }).select('id,code');
        if (error) throw error;
        data.forEach(v => vid.set(v.code, v.id));
      }
      // File tổng TB không đổi tên NCC đã có: chỉ thêm NCC mới, rồi lấy id của tất cả.
      if (prev.mode === 'tb') (await fetchAll<{ id: string; code: string }>((a, b) => supabase.from('vendors').select('id,code').eq('store_id', store).order('code').range(a, b)))
        .forEach(v => vid.set(v.code, v.id));
      const pid = new Map<string, string>();
      if (prev.mode === 'tb') {
        // Bổ sung từ file tổng TB: sản phẩm mới để "không có trong Cadencia"; sản phẩm có rồi chỉ điền NCC, giá còn trống.
        for (const [n, c] of chunks(prev.added, 500).entries()) {
          setMsg(`Đang thêm sản phẩm ${Math.min((n + 1) * 500, prev.added.length)}/${prev.added.length}…`);
          const { error } = await supabase.from('products').upsert(c.map(i => ({
            store_id: store, ax_code: i.ax, name: i.name, name_search: i.nameSearch, vendor_id: vid.get(i.vendorCode) ?? null,
            price: i.price, dept_group: i.group, category: i.category || 'TB', active: false, deleted_at: null,
          })), { onConflict: 'store_id,ax_code', ignoreDuplicates: true });
          if (error) throw error;
        }
        for (const [n, c] of chunks(prev.updated.map(u => u.item), 500).entries()) {
          setMsg(`Đang bổ sung NCC, giá ${Math.min((n + 1) * 500, prev.updated.length)}/${prev.updated.length}…`);
          const { error } = await supabase.from('products').upsert(c.map(i => ({
            store_id: store, ax_code: i.ax, name: i.name, vendor_id: vid.get(i.vendorCode) ?? null, price: i.price,
          })), { onConflict: 'store_id,ax_code' });
          if (error) throw error;
        }
      }
      for (const [n, c] of (prev.mode === 'tb' ? [] : chunks(write, 500)).entries()) {
        setMsg(`Đang ghi sản phẩm ${Math.min((n + 1) * 500, write.length)}/${write.length}…`);
        const { data, error } = await supabase.from('products').upsert(c.map(i => ({
          store_id: store, ax_code: i.ax, name: i.name, name_search: i.nameSearch, brand: i.brand || null,
          vendor_id: vid.get(i.vendorCode) ?? null, price: i.price, dept_group: i.group, category: i.category || null, active: true, deleted_at: null,
        })), { onConflict: 'store_id,ax_code' }).select('id,ax_code');
        if (error) throw error;
        data.forEach(p => pid.set(p.ax_code, p.id));
      }
      const bad = new Set(prev.errors.map(e => e.row));                // dòng báo lỗi: không ghi mã vạch
      // Thêm mọi mã vạch trong file còn thiếu (kể cả lần trước ghi dở). Mã đã có giữ nguyên, kể cả mã nhân viên gắn.
      const bc = (prev.mode === 'tb' ? [] : mapAll(rows.filter((_, i) => !bad.has(i + 1)))).flatMap(i => { const id = pid.get(i.ax) ?? ids.get(i.ax); return id ? i.barcodes.map(code => ({ store_id: store, product_id: id, code })) : []; });
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
      setMsg(prev.mode === 'tb' ? `Xong: thêm ${prev.added.length}, bổ sung NCC/giá ${prev.updated.length}.`
        : `Xong: thêm ${prev.added.length}, cập nhật ${prev.updated.length}, ẩn ${prev.hidden.length}.`);
      setPrev(null); setRows([]);
      refreshSnapshot(store);                  // bản sao trên máy (dùng khi mất mạng) lấy danh mục mới
    } catch (e: any) { setMsg('Lỗi khi ghi (chưa ghi hết, chọn lại file để làm tiếp): ' + e.message); }
    setBusy(false);
  }

  return (
    <>
      <h2 className="title">Nhập file</h2>
      <ContactImport store={store} />
      <div className="panel">
        <h2>Danh mục sản phẩm</h2>
        <p className="note">
          File GTB Cadencia (có cột AX Code, ví dụ Dry Salt/Sweet hoặc DHP/NF): cập nhật tên, giá, NCC, mã vạch; sản phẩm thuộc cùng nhóm hàng mà không còn trong file sẽ bị ẩn, không xóa.
          File Cadencia tổng TB (có cột Product number): lấy hàng của tất cả các quầy, thêm sản phẩm app chưa có và điền NCC, giá còn trống; không sửa tên, không ẩn gì.
          Cả hai không đụng lô HSD, kệ.
        </p>
        <input type="file" accept=".xlsx,.xls" aria-label="Chọn file Cadencia" disabled={busy} onChange={e => pick(e.target.files?.[0])} />
        {msg && <p className={msg.startsWith('Lỗi') ? 'msg bad' : 'note'}>{msg}</p>}
      </div>
      {prev && (
        <div className="panel">
          <div className="stats">
            <div><b className="ok">{prev.added.length}</b>Thêm mới</div>
            <div><b>{prev.updated.length}</b>{prev.mode === 'tb' ? 'Bổ sung NCC/giá' : 'Cập nhật'}</div>
            <div><b className="mute">{prev.unchanged}</b>{prev.mode === 'tb' ? 'Đã có, giữ nguyên' : 'Không đổi'}</div>
            {prev.mode === 'tb' ? null : <div><b className="warn">{prev.hidden.length}</b>Sẽ ẩn</div>}
            <div><b className="bad">{prev.errors.length}</b>Lỗi (bỏ qua)</div>
          </div>
          <p className="note">{rows.length} dòng trong file.</p>
          {prev.updated.slice(0, 10).map(u => <p className="note" key={u.item.ax}>{u.item.ax} {u.item.name}: đổi {u.changes.join(', ')}</p>)}
          {prev.hidden.slice(0, 10).map(h => <p className="note warn" key={h.ax}>Ẩn: {h.ax} {h.name}</p>)}
          {prev.errors.slice(0, 20).map(e => <p className="note bad" key={e.row}>Dòng {e.row}: {e.reason}</p>)}
          <button className="pri block" disabled={busy} onClick={apply}>Xác nhận ghi</button>
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
      const rows = await readRows(f, 'VENDOR CODE', 'Contact List', 'DRY');
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
      const old = await fetchAll<{ id: string; vendor_id: string; source: string }>((a, b) => supabase.from('terms').select('id,vendor_id,source').eq('store_id', store)
        .is('brand', null).is('product_id', null).is('deleted_at', null).order('id').range(a, b));
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
      reloadTerms(); refreshSnapshot(store);
    } catch (e: any) { setMsg('Lỗi khi ghi: ' + e.message); }
    setBusy(false);
  }

  const n = (f: (v: VendorTerm) => boolean) => vt?.filter(f).length ?? 0;
  return (
    <div className="panel">
      <h2>Điều khoản đổi trả (Contact List)</h2>
      <p className="note">Đọc sheet DRY. Không lấy tên buyer. Điều khoản đã sửa tay trong app được giữ nguyên.</p>
      <input type="file" accept=".xlsx,.xls" aria-label="Chọn file Contact List" disabled={busy} onChange={e => pick(e.target.files?.[0])} />
      {msg && <p className={msg.startsWith('Lỗi') ? 'msg bad' : 'note'}>{msg}</p>}
      {vt && (
        <>
          <div className="stats">
            <div><b>{vt.length}</b>NCC</div>
            <div><b className="ok">{n(v => !v.review && v.action === 'return')}</b>Báo trả</div>
            <div><b>{n(v => !v.review && v.action === 'discount')}</b>Giảm giá</div>
            <div><b className="warn">{n(v => v.review)}</b>Cần chọn tay</div>
          </div>
          <button className="pri block" disabled={busy} onClick={apply}>Xác nhận ghi</button>
        </>
      )}
    </div>
  );
}
