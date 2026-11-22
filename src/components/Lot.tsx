import type { Action, LotProduct } from '../lib/action.ts';
import { pname, useNames } from '../lib/db.ts';
import { daysLeft, fmt, whoLine } from '../lib/dates.ts';
import ActionLine from './ActionLine.tsx';
import Icon from './Icon.tsx';

export interface LotRow {
  id: string; qty: number; expiry_date: string; updated_at?: string; created_at?: string; created_by?: string | null; updated_by?: string | null; expiry_note: string | null; mfg_date?: string | null; no_return?: boolean; status: string; shelf_id?: string | null;
  shelves: { name: string } | null; products: LotProduct & { name: string; name_vi?: string | null; ax_code: string | null };
}

// Nội dung một lô, dùng chung cho Hôm nay, Hết hạn, Kệ, chi tiết sản phẩm.
export default function LotInfo({ l, a, title, showShelf = true, showHsd = true }: { l: LotRow; a?: Action; title?: string; showShelf?: boolean; showHsd?: boolean }) {
  // Hết hạn rồi thì ngày báo trả / giảm giá không còn ý nghĩa: chỉ nhắc bỏ khỏi kệ.
  const by = whoLine(l, useNames());
  const over = l.expiry_note !== 'action_date' && l.status !== 'return_notified' ? -daysLeft(l.expiry_date) : 0;
  return (
    <div className="lot">
      <div className="lot-top">
        <span className="lot-name">{title ?? pname(l.products)}</span>
        <span className="lot-qty num">SL {l.qty}</span>
      </div>
      <div className="lot-meta">
        {!title && l.products?.ax_code && <span className="num ax">{l.products.ax_code}</span>}
        {l.expiry_note === 'action_date'
          ? <span className="pill warn">Chưa có HSD</span>
          : showHsd && <span className="num">HSD {fmt(l.expiry_date)}</span>}
        {l.expiry_note === 'estimated' && <span className="pill">HSD ước tính</span>}
        {showShelf && <span>{l.shelves?.name ?? 'Chưa gắn kệ'}</span>}
      </div>
      {over > 0 ? <span className="act bad"><Icon name="alert" size={15} />Quá HSD {over} ngày · bỏ khỏi kệ</span>
        : a && <ActionLine a={a} status={l.status} />}
      {by && <span className="note">{by}</span>}
    </div>
  );
}

export const LotsLoading = () => (
  <div className="list" aria-busy="true" aria-label="Đang tải">
    {[62, 48, 70].map(w => <div className="li li-body" key={w}><div className="skel" style={{ width: w + '%' }} /><div className="skel" style={{ width: w - 24 + '%' }} /></div>)}
  </div>
);
