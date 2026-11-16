import { clearFailed, flush, refreshSnapshot, useSync } from '../lib/offline.ts';
import Icon from './Icon.tsx';

// Nút trạng thái trên thanh tiêu đề: chỉ hiện khi mất mạng, còn thay đổi chờ gửi, hoặc có lỗi.
export function SyncBadge({ onClick }: { onClick: () => void }) {
  const s = useSync();
  if (s.online && !s.pending && !s.failed.length) return null;
  const text = [!s.online && 'Mất mạng', s.pending > 0 && `${s.pending} chờ gửi`, s.failed.length > 0 && 'Có lỗi'].filter(Boolean).join(' · ');
  return <button className={`badge ${s.failed.length ? 'bad' : ''}`} onClick={onClick}>{!s.online && <Icon name="offline" size={14} />}{text}</button>;
}

const p2 = (n: number) => String(n).padStart(2, '0');
export const syncedText = (t: number | null) => { if (!t) return null; const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}, ${p2(d.getDate())}/${p2(d.getMonth() + 1)}`; };

// Thẻ trong Khác: thời điểm tải dữ liệu, số thay đổi chờ gửi, lỗi bị máy chủ từ chối.
export default function SyncPanel({ store }: { store: string }) {
  const s = useSync();
  return (
    <div className="panel">
      <h2>Dùng khi mất mạng</h2>
      <p className="note">
        Mất mạng vẫn quét mã, tìm sản phẩm, xem lô, thêm và sửa lô được. Thay đổi lưu trên máy và tự gửi khi có mạng.
        Nhập file, sửa điều khoản, gắn mã vạch cần có mạng.
      </p>
      <dl className="facts">
        <dt>Mạng</dt><dd>{s.online ? <span className="ok">Có mạng</span> : <span className="warn">Mất mạng</span>}</dd>
        <dt>Dữ liệu trên máy</dt><dd className="num">{syncedText(s.syncedAt) ?? <span className="warn">chưa tải</span>}</dd>
        <dt>Chờ gửi</dt><dd className="num">{s.pending} thay đổi</dd>
      </dl>
      {s.busy && <p className="note">{s.busy}</p>}
      <div className="actions">
        <button disabled={!s.online || !!s.busy} onClick={() => refreshSnapshot(store)}>Tải lại dữ liệu về máy</button>
        <button disabled={!s.online || !s.pending} onClick={() => flush()}>Gửi ngay</button>
      </div>
      {s.failed.length > 0 && (
        <div className="msg bad">
          <p>Máy chủ từ chối {s.failed.length} thay đổi (đã bỏ qua):</p>
          {s.failed.map((f, i) => <p className="note bad" key={i}>{f}</p>)}
          <button className="sm" style={{ marginTop: 8 }} onClick={clearFailed}>Xóa thông báo</button>
        </div>
      )}
    </div>
  );
}
