import { useState } from 'react';
import { supabase, type Member } from '../supabase.ts';
import { money, pname, type Product } from '../lib/db.ts';
import { localAddCodes } from '../lib/offline.ts';
import { codeVariants, isNet } from '../lib/offline.ts';
import { canWrite } from '../supabase.ts';
import Scanner from './Scanner.tsx';
import { describeTerm, termAt, termFor, type Cfg } from '../lib/action.ts';
import { TermEditor } from '../pages/Terms.tsx';
import Icon from './Icon.tsx';

// Bỏ bản mã có thêm số 0 do app tự tạo cho mã UPC, để danh sách mã gọn.
export const showCodes = (p: Product) => (p.barcodes ?? []).map(b => b.code).filter((c, _, all) => !all.some(o => o !== c && c === '0' + o)).join(', ') || 'Chưa có mã vạch';
export const vendorText = (p: Product) => !p.vendors ? 'Chưa có NCC' : p.vendors.code.startsWith('TB-') ? `${p.vendors.name} (chưa có mã NCC)` : `${p.vendors.name} · ${p.vendors.code}`;

// Một dòng sản phẩm trong kết quả tìm.
export function ProductRow({ p, onClick }: { p: Product; onClick: () => void }) {
  return (
    <div className="li">
      <button className="li-main" onClick={onClick}>
        <div className="grow">
          <div className="lot-name">{pname(p)}</div>
          {p.name_vi && <div className="note">{p.name}</div>}
          <div className="note num">{[p.ax_code, p.brand, money(p.price)].filter(Boolean).join(' · ')}</div>
          <div className="note">NCC: {vendorText(p)}{!p.active && <span className="warn"> · không có trong Cadencia</span>}</div>
        </div>
        <Icon name="chev" size={18} />
      </button>
    </div>
  );
}

// Thẻ thông tin sản phẩm: hiện ngay khi quét / gõ mã. Quản trị viên sửa được tên tiếng Việt, điều khoản NCC,
// cờ không đổi trả / Sành Điệu ngay tại chỗ.
export default function ProductInfo({ p, member, terms, onChange }: { p: Product; member: Member; terms: Cfg | null; onChange?: (p: Product) => void }) {
  const admin = member.role === 'admin';
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState('');
  const [vi, setVi] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const [ok, setOk] = useState('');
  const t = terms ? termFor(p, terms.idx) : null;

  async function set(patch: Partial<Product>) {
    const { error } = await supabase.from('products').update(patch).eq('id', p.id);
    if (error) return setErr(isNet(error) ? 'Đang mất mạng: sửa sản phẩm cần có mạng.' : 'Lỗi: ' + error.message);
    setErr(''); onChange?.({ ...p, ...patch });
  }

  // Quét mã trên bao bì để gắn vào sản phẩm này.
  async function attach(code: string) {
    setScan(false); setOk(''); setErr('');
    if (!/^\d{6,14}$/.test(code)) return setErr(`"${code}" không phải mã vạch sản phẩm (chỉ gồm 6–14 chữ số). Quét lại mã trên bao bì.`);
    const rows = (/^\d{11,12}$/.test(code) ? codeVariants(code) : [code]).map(c => ({ store_id: member.store_id, product_id: p.id, code: c }));
    const { data, error } = await supabase.from('barcodes').upsert(rows, { onConflict: 'store_id,code', ignoreDuplicates: true }).select('code');
    if (error) return setErr(isNet(error) ? 'Đang mất mạng: gắn mã cần có mạng.' : 'Lỗi gắn mã: ' + error.message);
    if (!data?.length) {
      const { data: o } = await supabase.from('barcodes').select('deleted_at,products(name)').eq('store_id', member.store_id).in('code', rows.map(r => r.code)).limit(1).maybeSingle();
      return setErr(`Không gắn được: mã ${code} đang thuộc "${(o as any)?.products?.name ?? 'sản phẩm khác'}"${(o as any)?.deleted_at ? ' (đã xóa)' : ''}.`);
    }
    localAddCodes(p.id, data.map(d => d.code as string)).catch(() => {});
    setOk(`Đã gắn mã ${code}. Lần sau quét là ra sản phẩm này.`);
    onChange?.({ ...p, barcodes: [...(p.barcodes ?? []), ...data.map(d => ({ code: d.code as string }))] });
  }

  return (
    <div className="pi">
      <div className="pi-head">
        <div>
          {vi === null ? <h2 className="pi-name">{pname(p)}</h2> : (
            <form className="row" onSubmit={e => { e.preventDefault(); set({ name_vi: vi.trim() || null }); setVi(null); }}>
              <input className="grow" autoFocus aria-label="Tên tiếng Việt" placeholder="Tên tiếng Việt" value={vi} onChange={e => setVi(e.target.value)} />
              <button type="submit" className="pri">Lưu</button>
              <button type="button" className="icon" aria-label="Hủy" onClick={() => setVi(null)}><Icon name="x" /></button>
            </form>
          )}
          {p.name_vi && <p className="pi-sub">{p.name}</p>}
          <p className="pi-sub num">{[p.ax_code, p.brand, p.category].filter(Boolean).join(' · ')}</p>
        </div>
        {admin && vi === null && <button className="icon" aria-label="Sửa tên tiếng Việt" onClick={() => setVi(p.name_vi ?? '')}><Icon name="edit" /></button>}
      </div>
      {t && terms && (
        <div className={`term ${t.problem ? 'warn' : t.kind === 'return' ? 'ret' : 'disc'}`}>
          <Icon name={t.problem ? 'alert' : t.kind === 'return' ? 'truck' : 'tag'} size={20} />
          <div>
            <b>{t.problem ? 'Cần đặt điều khoản' : t.kind === 'return' ? `Báo trả NCC · ${t.days} ngày` : 'Không đổi trả · dán giảm giá'}</b>
            <div>{describeTerm(t, terms)}</div>
            {t.raw && t.problem && <div className="note">Câu gốc: {t.raw}</div>}
          </div>
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {p.price == null ? <span className="note">Chưa có giá</span> : <span className="pi-price num">{money(p.price)}</span>}
        {!p.active && <span className="pill warn">Không có trong Cadencia</span>}
      </div>
      <dl className="facts">
        <dt>NCC</dt><dd>{vendorText(p)}</dd>
        <dt>Mã vạch</dt><dd className="num">{showCodes(p)}</dd>
      </dl>
      {canWrite(member) && (scan
        ? <><Scanner auto onCode={attach} /><button className="block" onClick={() => setScan(false)}>Hủy quét</button></>
        : <button className={`block ${p.barcodes?.length ? '' : 'pri'}`} onClick={() => setScan(true)}><Icon name="camera" size={18} />{p.barcodes?.length ? 'Gắn thêm mã vạch' : 'Quét mã vạch để gắn'}</button>)}
      {ok && <p className="msg ok">{ok}</p>}
      {admin && (
        <details className="more" open={!!t?.problem}>
          <summary>Điều khoản và cờ sản phẩm</summary>
          {p.vendors && p.vendor_id && (edit && terms
            ? <TermEditor store={member.store_id} vendor={{ id: p.vendor_id, code: p.vendors.code, name: p.vendors.name }}
                main={termAt(terms.idx, p.vendor_id) ?? undefined} done={() => setEdit(false)} />
            : <button className="sm" onClick={() => setEdit(true)}>{t?.problem ? 'Đặt điều khoản cho NCC này' : 'Sửa điều khoản NCC'}</button>)}
          <label className="check"><input type="checkbox" checked={p.no_return} onChange={e => set({ no_return: e.target.checked })} />Sản phẩm này không đổi trả (dán giảm giá)</label>
          <label className="check"><input type="checkbox" checked={p.sanh_dieu} onChange={e => set({ sanh_dieu: e.target.checked })} />Hàng Sành Điệu</label>
        </details>
      )}
      {err && <p className="msg bad">{err}</p>}
    </div>
  );
}
