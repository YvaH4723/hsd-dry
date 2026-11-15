import type { Action } from '../lib/action.ts';
import { daysLeft, fmt } from '../lib/dates.ts';

export default function ActionLine({ a, status }: { a: Action; status: string }) {
  if (status === 'return_notified') return <div className="mute">Đã báo trả NCC</div>;
  if (status === 'discounted' && a.kind === 'discount') return <div className="mute">Đã dán giảm giá</div>;
  const d = daysLeft(a.date);
  const when = d < 0 ? `quá ${-d} ngày` : d === 0 ? 'hôm nay' : `còn ${d} ngày`;
  const what = a.kind === 'return' ? 'Báo trả NCC trước' : a.kind === 'discount' ? 'Dán giảm giá từ' : 'Nhắc';
  return (
    <div>
      <span className={d < 0 ? 'over' : d <= 7 ? 'soon' : 'mute'}>{what} {fmt(a.date)} ({when})</span>
      {a.label && <div className="warn">{a.label}{a.raw ? ': ' + a.raw.replace(/\n/g, ' / ') : ''}</div>}
    </div>
  );
}
