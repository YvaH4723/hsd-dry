import { useEffect, useState } from 'react';
import { supabase } from '../supabase.ts';
import { isNet } from '../lib/offline.ts';
import Icon from './Icon.tsx';

const VAPID_PUBLIC = 'BOgCMmZbH1w_ilrDPxdqdN6TH0KsaCsUP669S7vMRb8ppPueCzXHfWHBeRAKefFtjDRDNxp8tfU4Y7Lt9THXc3o';
const key = (b64: string) => Uint8Array.from(atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const iosTab = /iphone|ipad/i.test(navigator.userAgent) && !(navigator as any).standalone;

// Bật / tắt thông báo hằng ngày (7:00 và 15:00) trên máy này.
export default function PushToggle({ store }: { store: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return setOn(false);
    navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(s => setOn(!!s && Notification.permission === 'granted'), () => setOn(false));
  }, []);

  async function enable() {
    setBusy(true); setMsg('');
    try {
      if (await Notification.requestPermission() !== 'granted') throw new Error('Bạn chưa cho phép thông báo. Vào cài đặt trình duyệt / ứng dụng, cho phép Thông báo cho HSD Dry rồi bấm lại.');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID_PUBLIC) });
      const j = sub.toJSON();
      const { error } = await supabase.from('push_subs').upsert({ endpoint: sub.endpoint, store_id: store, p256dh: j.keys!.p256dh, auth: j.keys!.auth }, { onConflict: 'endpoint' });
      if (error) throw new Error(isNet(error) ? 'Đang mất mạng, bật lại khi có mạng.' : /push_subs/.test(error.message) ? 'Chưa chạy đoạn SQL 008_push.sql trên Supabase.' : error.message);
      setOn(true); setMsg('Đã bật. Mỗi ngày 7:00 và 15:00 sẽ có thông báo nếu có việc cần làm.');
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }
  async function disable() {
    setBusy(true); setMsg('');
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await supabase.from('push_subs').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
      setOn(false);
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }

  return (
    <div className="panel stack">
      <div className="row"><Icon name="bell" size={22} /><h2 className="grow">Thông báo hằng ngày</h2>{on && <span className="pill ok">Đang bật</span>}</div>
      <p className="note">7:00 và 15:00: số lô quá HSD, cần báo trả NCC, cần dán giảm giá, chờ NCC lấy. Không có việc thì không báo.</p>
      {!supported ? <p className="msg warn">{iosTab ? 'Trên iPhone: bấm nút Chia sẻ → "Thêm vào Màn hình chính", mở app từ biểu tượng đó rồi bật thông báo ở đây (cần iOS 16.4 trở lên).' : 'Máy / trình duyệt này không hỗ trợ thông báo. Dùng Chrome trên Android.'}</p>
        : on ? <button className="block" disabled={busy} onClick={disable}>Tắt thông báo trên máy này</button>
        : <button className="pri block" disabled={busy || on == null} onClick={enable}><Icon name="bell" size={18} />{busy ? 'Đang bật…' : 'Bật thông báo trên máy này'}</button>}
      {msg && <p className={`msg ${/^Đã bật/.test(msg) ? 'ok' : 'bad'}`}>{msg}</p>}
    </div>
  );
}
