import { useState } from 'react';
import { supabase } from '../supabase.ts';
import { fetchAll } from '../lib/offline.ts';
import { pname, settingsOf } from '../lib/db.ts';
import { actionFor, indexTerms, type Term } from '../lib/action.ts';

const STATUS: Record<string, string> = { on_shelf: 'Trên kệ', discounted: 'Đã giảm giá', return_notified: 'Đã báo trả', returned: 'NCC đã lấy', discarded: 'Đã hủy', sold_out: 'Bán hết' };
const NOTE: Record<string, string> = { estimated: 'HSD ước tính', action_date: 'Ngày nhắc (chưa có HSD)' };

// Xuất toàn bộ dữ liệu ra một file Excel để sao lưu (gói Supabase miễn phí không tự sao lưu).
export default function Backup({ store }: { store: string }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      setMsg('Đang tải dữ liệu…');
      const q = (t: string, cols: string, order = 'id') => fetchAll<any>((a, b) => supabase.from(t).select(cols).eq('store_id', store).order(order).range(a, b));
      const [lots, products, vendors, terms, shelves, st] = await Promise.all([
        q('batches', 'id,qty,expiry_date,expiry_note,mfg_date,status,deleted_at,updated_at,shelves(name),products(id,name,name_vi,ax_code,brand,vendor_id,no_return,sanh_dieu,vendors(code,name))'),
        q('products', 'ax_code,name,name_vi,brand,price,category,dept_group,active,no_return,sanh_dieu,deleted_at,vendors(code,name),barcodes(code)'),
        q('vendors', 'id,code,name', 'code'),
        q('terms', 'vendor_id,brand,product_id,action,days,raw_text,needs_review,source,deleted_at'),
        q('shelves', 'name,qr_code,sort_order,deleted_at', 'sort_order'),
        supabase.from('stores').select('*').eq('id', store).single(),
      ]);
      const cfg = { idx: indexTerms(terms.filter(t => !t.deleted_at) as Term[]), ...settingsOf(st.data) };
      const vname = new Map(vendors.map(v => [v.id, v]));
      setMsg('Đang tạo file…');
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const add = (name: string, rows: Record<string, unknown>[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
      add('Lô', lots.map(l => {
        const a = actionFor(l, l.products, cfg);
        return {
          'Mã AX': l.products?.ax_code, 'Sản phẩm': pname(l.products), 'Tên gốc': l.products?.name, 'NCC': l.products?.vendors?.name, 'Mã NCC': l.products?.vendors?.code,
          'Kệ': l.shelves?.name, 'SL': l.qty, 'HSD': l.expiry_note === 'action_date' ? '' : l.expiry_date,
          'NSX': l.mfg_date, 'Ghi chú ngày': NOTE[l.expiry_note] ?? '', 'Việc phải làm': a.kind === 'return' ? 'Báo trả' : a.kind === 'discount' ? 'Dán giảm giá' : 'Nhắc',
          'Ngày phải làm': a.date, 'Trạng thái': STATUS[l.status] ?? l.status, 'Đã xóa': l.deleted_at ? 'x' : '', 'Sửa lần cuối': l.updated_at, 'id': l.id,
        };
      }));
      add('Sản phẩm', products.map(p => ({
        'Mã AX': p.ax_code, 'Tên tiếng Việt': p.name_vi, 'Tên gốc': p.name, 'Nhãn': p.brand, 'Giá': p.price, 'Nhóm': p.category, 'Sweet/Salty': p.dept_group,
        'NCC': p.vendors?.name, 'Mã NCC': p.vendors?.code, 'Mã vạch': (p.barcodes ?? []).map((b: any) => b.code).join(' '),
        'Đang bán': p.active ? 'x' : '', 'Không đổi trả': p.no_return ? 'x' : '', 'Sành Điệu': p.sanh_dieu ? 'x' : '', 'Đã xóa': p.deleted_at ? 'x' : '',
      })));
      add('Điều khoản', terms.filter(t => !t.deleted_at).map(t => ({
        'Mã NCC': vname.get(t.vendor_id)?.code, 'NCC': vname.get(t.vendor_id)?.name, 'Nhãn hàng': t.brand ?? '', 'Riêng sản phẩm': t.product_id ? 'x' : '',
        'Loại': t.needs_review ? 'Cần chọn tay' : t.action === 'return' ? 'Báo trả' : 'Giảm giá', 'Số ngày': t.days, 'Câu gốc': t.raw_text, 'Nguồn': t.source === 'manual' ? 'Sửa tay' : 'File',
      })));
      add('NCC', vendors.map(v => ({ 'Mã NCC': v.code, 'Tên': v.name })));
      add('Kệ', shelves.filter(s => !s.deleted_at).map(s => ({ 'Kệ': s.name, 'Mã QR': s.qr_code, 'Thứ tự': s.sort_order })));
      add('Cài đặt', [{ 'Giảm giá trước HSD (ngày)': cfg.discountDays, 'Báo trả sớm thêm (ngày)': cfg.returnBuffer }]);
      const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      XLSX.writeFile(wb, `hsd-dry-sao-luu-${stamp}.xlsx`);
      setMsg(`Đã xuất: ${lots.length} lô, ${products.length} sản phẩm, ${terms.length} điều khoản.`);
    } catch (e: any) { setMsg('Lỗi: ' + e.message); }
    setBusy(false);
  }

  return (
    <div className="card">
      <b>Sao lưu</b>
      <p className="mute" style={{ margin: '6px 0' }}>Tải toàn bộ lô, sản phẩm, điều khoản, NCC, kệ về một file Excel. Nên làm mỗi tuần một lần và cất file vào Google Drive.</p>
      <button className="pri" style={{ width: '100%' }} disabled={busy} onClick={run}>Xuất toàn bộ ra Excel</button>
      {msg && <p className={msg.startsWith('Lỗi') ? 'bad' : 'mute'}>{msg}</p>}
    </div>
  );
}
