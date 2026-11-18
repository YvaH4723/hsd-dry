import { useEffect, useState } from 'react';
import { supabase, canDelete, canWrite, type Member } from '../supabase.ts';
import { BATCH_COLS, pname } from '../lib/db.ts';
import { isNet, updateBatchOffline } from '../lib/offline.ts';
import { fmt, iso } from '../lib/dates.ts';
import { LotsLoading, type LotRow } from '../components/Lot.tsx';

type Row = LotRow & { updated_at: string; deleted_at: string | null };
const DONE = ['sold_out', 'returned', 'discarded', 'discounted', 'return_notified'];
const KINDS: [string, string][] = [['all', 'Tất cả'], ['deleted', 'Đã xóa'], ['sold_out', 'Bán hết'], ['returned', 'NCC đã lấy'], ['discarded', 'Đã hủy'], ['return_notified', 'Đã báo trả'], ['discounted', 'Đã dán giảm giá']];
const label = (r: Row) => r.deleted_at ? 'Đã xóa' : r.status === 'on_shelf' ? 'Đang trên kệ' : KINDS.find(k => k[0] === r.status)?.[1] ?? r.status;
const tone = (r: Row) => r.deleted_at || r.status === 'discarded' ? 'bad' : r.status === 'discounted' ? 'disc' : r.status === 'returned' || r.status === 'return_notified' ? 'pick' : '';
const when = (s: string) => { const d = new Date(s); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${fmt(iso(d))}`; };

// Lô đã xử lý / đã xóa trong 60 ngày gần nhất: xem ai làm, lúc nào; bấm nhầm thì Khôi phục về lại danh sách.
export default function History({ member }: { member: Member }) {
  const store = member.store_id;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [who, setWho] = useState<Map<string, string>>(new Map());
  const [kind, setKind] = useState('all');
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Set<string>>(new Set());

  async function load() {
    const since = new Date(Date.now() - 60 * 864e5).toISOString();
    const { data, error } = await supabase.from('batches').select(BATCH_COLS + ',deleted_at').eq('store_id', store)
      .or(`deleted_at.not.is.null,status.in.(${DONE.join(',')})`).gte('updated_at', since).order('updated_at', { ascending: false }).limit(300);
    if (error) return setErr(isNet(error) ? 'Đang mất mạng: xem lịch sử cần có mạng.' : 'Lỗi: ' + error.message);
    const rs = data as unknown as Row[];
    setRows(rs);
    // Ai làm: lần ghi nhận gần nhất của từng lô.
    const { data: mem } = await supabase.from('members').select('user_id,name').eq('store_id', store);
    const names = new Map((mem ?? []).map(m => [m.user_id, m.name]));
    const by = new Map<string, string>();
    for (let i = 0; i < rs.length; i += 80) {
      const { data: au } = await supabase.from('audit_log').select('batch_id,user_id,at').eq('store_id', store).in('batch_id', rs.slice(i, i + 80).map(r => r.id)).order('at', { ascending: false });
      (au ?? []).forEach(a => { if (!by.has(a.batch_id)) by.set(a.batch_id, names.get(a.user_id) ?? 'không rõ'); });
    }
    rs.forEach(r => by.has(r.id) || by.set(r.id, 'không rõ người làm'));
    setWho(by);
  }
  useEffect(() => { load(); }, [store]);

  async function restore(r: Row) {
    // Lô bị xóa: giữ trạng thái cũ (đã báo trả, đã dán giảm giá…). Lô đã bán / hủy / trả: về lại kệ.
    const patch = r.deleted_at && ['on_shelf', 'discounted', 'return_notified'].includes(r.status) ? { deleted_at: null } : { deleted_at: null, status: 'on_shelf' };
    try {
      await updateBatchOffline(store, r.id, patch, 'restore', { status: r.status, deleted_at: r.deleted_at }, undefined, r.updated_at);
      setDone(s => new Set(s).add(r.id));
    } catch (e: any) { setErr('Chưa khôi phục được: ' + e.message); }
  }

  const shown = (rows ?? []).filter(r => kind === 'all' || (kind === 'deleted' ? !!r.deleted_at : !r.deleted_at && r.status === kind));
  return (
    <>
      <h2 className="title">Lịch sử, khôi phục</h2>
      <p className="note">Lô đã đánh dấu xong hoặc đã xóa trong 60 ngày gần nhất. Bấm nhầm thì bấm Khôi phục, lô quay lại danh sách như cũ.</p>
      <div className="chips" role="group" aria-label="Lọc">
        {KINDS.map(([k, t]) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{t}</button>)}
      </div>
      {err && <p className="msg bad">{err}</p>}
      {rows == null ? (!err && <LotsLoading />) : !shown.length ? <p className="empty">Không có lô nào.</p> : (
        <div className="list">
          {shown.map(r => (
            <div className="li li-body hrow" key={r.id}>
              <div className="lot-top">
                <span className="lot-name">{pname(r.products)}</span>
                <span className="lot-qty num">SL {r.qty}</span>
              </div>
              <div className="lot-meta">
                {r.expiry_note === 'action_date' ? <span>Chưa có HSD</span> : <span className="num">HSD {fmt(r.expiry_date)}</span>}
                <span>{r.shelves?.name ?? 'Chưa gắn kệ'}</span>
              </div>
              <div className="row">
                <span className={`pill ${tone(r)}`}>{label(r)}</span>
                <span className="note grow">{who.get(r.id) ?? '…'} · {when(r.deleted_at ?? r.updated_at)}</span>
                {(r.deleted_at ? canDelete(member) : canWrite(member)) && (done.has(r.id)
                  ? <span className="note ok">Đã khôi phục</span>
                  : <button className="sm" onClick={() => restore(r)}>Khôi phục</button>)}
              </div>
            </div>
          ))}
        </div>
      )}
      {rows && rows.length >= 300 && <p className="note">Chỉ hiện 300 lô gần nhất.</p>}
    </>
  );
}
