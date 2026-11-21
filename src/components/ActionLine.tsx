import type { Action } from '../lib/action.ts';
import { daysLeft, fmt } from '../lib/dates.ts';
import Icon from './Icon.tsx';

// Việc phải làm của một lô: báo trả / dán giảm giá / nhắc (lô chưa có HSD), kèm số ngày còn lại.
export default function ActionLine({ a, status }: { a: Action; status: string }) {
  if (status === 'return_notified') return <span className="act pick"><Icon name="truck" size={15} />Đã báo trả NCC, chờ lấy</span>;
  if (status === 'discounted') return <span className="act disc"><Icon name="tag" size={15} />Đã dán giảm giá</span>;
  const d = daysLeft(a.date);
  const tone = d < 0 ? 'bad' : a.kind === 'discount' ? 'disc' : 'ret';      // màu theo việc, quá ngày thì đỏ
  const what = a.kind === 'return' ? 'Báo trả NCC trước' : a.kind === 'discount' ? 'Dán giảm giá từ' : a.kind === 'watch' ? 'Kiểm hạn từ' : 'Nhắc';
  const when = d < 0 ? `quá ${-d} ngày` : d === 0 ? 'hôm nay' : `còn ${d} ngày`;
  return (
    <>
      <span className={`act ${tone}`}>
        <Icon name={a.kind === 'return' ? 'truck' : a.kind === 'discount' ? 'tag' : 'bell'} size={15} />
        <span>{what} <b className="num">{fmt(a.date)}</b> · {when}</span>
      </span>
      {a.why && <span className="note">{a.why}</span>}
      {a.label && a.kind !== 'reminder' && <span className="note warn">{a.label}{a.raw ? ': ' + a.raw.replace(/\n/g, ' / ') : ''}</span>}
    </>
  );
}
