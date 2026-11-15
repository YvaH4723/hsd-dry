import { useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { money, type Product } from '../lib/db.ts';
import { describeTerm, termAt, termFor, type Cfg } from '../lib/action.ts';
import { TermEditor } from '../pages/Terms.tsx';

// Bỏ bản mã có thêm số 0 do app tự tạo cho mã UPC, để danh sách mã gọn.
export const showCodes = (p: Product) => (p.barcodes ?? []).map(b => b.code).filter((c, _, all) => !all.some(o => o !== c && c === '0' + o)).join(', ') || 'Chưa có mã vạch';
export const vendorText = (p: Product) => !p.vendors ? 'Chưa có NCC' : p.vendors.code.startsWith('TB-') ? `${p.vendors.name} (chưa có mã NCC)` : `${p.vendors.name} · ${p.vendors.code}`;

// Thẻ thông tin sản phẩm: hiện ngay khi quét / gõ mã. Quản trị viên sửa được điều khoản NCC và cờ không đổi trả / Sành Điệu tại chỗ.
export default function ProductInfo({ p, member, terms, onChange }: { p: Product; member: Member; terms: (Cfg & { reload: () => void }) | null; onChange?: (p: Product) => void }) {
  const admin = member.role === 'admin';
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState('');
  const t = terms ? termFor(p, terms.idx) : null;

  async function flag(field: 'no_return' | 'sanh_dieu', value: boolean) {
    const { error } = await supabase.from('products').update({ [field]: value }).eq('id', p.id);
    if (error) return setErr(error.message);
    onChange?.({ ...p, [field]: value });
  }

  return (
    <div>
      <b>{p.name}</b> {!p.active && <span className="warn">(không có trong Cadencia)</span>}
      <div className="mute">{[p.ax_code, p.brand, p.category].filter(Boolean).join(' · ')}</div>
      <div>Giá: <b>{money(p.price) || 'chưa có'}</b></div>
      <div className="mute">Mã vạch: {showCodes(p)}</div>
      <div>NCC: {vendorText(p)}</div>
      {t && terms && <div className={t.problem ? 'warn' : 'ok'}>{describeTerm(t, terms)}{t.raw && t.problem ? `. Câu gốc: ${t.raw}` : ''}</div>}
      {admin && (
        <div style={{ marginTop: 6 }}>
          {p.vendors && <button onClick={() => setEdit(!edit)}>{t?.problem ? 'Đặt điều khoản cho NCC này' : 'Sửa điều khoản NCC'}</button>}
          <label className="row" style={{ margin: '8px 0 0', color: 'var(--ink)' }}>
            <input type="checkbox" style={{ width: 'auto', flex: '0 0 auto' }} checked={p.no_return} onChange={e => flag('no_return', e.target.checked)} />
            <span>Sản phẩm này không đổi trả (dán giảm giá)</span>
          </label>
          <label className="row" style={{ margin: '4px 0 0', color: 'var(--ink)' }}>
            <input type="checkbox" style={{ width: 'auto', flex: '0 0 auto' }} checked={p.sanh_dieu} onChange={e => flag('sanh_dieu', e.target.checked)} />
            <span>Hàng Sành Điệu</span>
          </label>
        </div>
      )}
      {edit && p.vendor_id && p.vendors && terms && (
        <TermEditor store={member.store_id} vendor={{ id: p.vendor_id, code: p.vendors.code, name: p.vendors.name }}
          main={termAt(terms.idx, p.vendor_id) ?? undefined} done={() => { setEdit(false); terms.reload(); }} />
      )}
      {err && <p className="bad">{err}</p>}
    </div>
  );
}
