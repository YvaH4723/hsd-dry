import { clearFailed, flush, refreshSnapshot, useSync } from '../lib/offline.ts';

// Chấm trạng thái trên thanh tiêu đề.
export function SyncBadge() {
  const s = useSync();
  if (s.online && !s.pending && !s.failed.length) return null;
  return (
    <span className={s.failed.length ? 'bad' : 'warn'} style={{ fontSize: 13 }}>
      {!s.online ? 'Mất mạng' : ''}{s.pending ? `${!s.online ? ' · ' : ''}${s.pending} chờ gửi` : ''}{s.failed.length ? ' · có lỗi' : ''}
    </span>
  );
}

// Thẻ trong tab Khác: thời điểm tải dữ liệu, số thay đổi chờ gửi, lỗi bị máy chủ từ chối.
export default function SyncPanel({ store }: { store: string }) {
  const s = useSync();
  return (
    <div className="card">
      <b>Dùng khi mất mạng</b>
      <p className="mute" style={{ margin: '6px 0' }}>
        Mất mạng vẫn quét mã, tìm sản phẩm, xem lô, thêm và sửa lô được. Thay đổi lưu trên máy và tự gửi khi có mạng.
        Nhập file, sửa điều khoản, gắn mã vạch cần có mạng.
      </p>
      <div>Trạng thái: {s.online ? <span className="ok">Có mạng</span> : <span className="warn">Mất mạng</span>}</div>
      <div>Dữ liệu trên máy: {s.syncedAt ? new Date(s.syncedAt).toLocaleString('vi-VN') : <span className="warn">chưa tải</span>}</div>
      <div>Thay đổi chờ gửi: {s.pending}</div>
      {s.busy && <p className="mute">{s.busy}</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <button disabled={!s.online || !!s.busy} onClick={() => refreshSnapshot(store)}>Tải lại dữ liệu về máy</button>
        <button disabled={!s.online || !s.pending} onClick={() => flush()}>Gửi ngay</button>
      </div>
      {s.failed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p className="bad" style={{ margin: 0 }}>Máy chủ từ chối {s.failed.length} thay đổi (đã bỏ qua):</p>
          {s.failed.map((f, i) => <div className="mute" key={i}>• {f}</div>)}
          <button style={{ marginTop: 6 }} onClick={clearFailed}>Xóa thông báo</button>
        </div>
      )}
    </div>
  );
}
