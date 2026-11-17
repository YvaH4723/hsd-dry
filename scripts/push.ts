// Gửi thông báo hằng ngày. Chạy bởi GitHub Actions (.github/workflows/push.yml), TZ=Asia/Ho_Chi_Minh.
// Dùng lại đúng quy tắc của app (action.ts) để đếm: quá HSD, cần báo trả, cần dán giảm giá, chờ NCC lấy.
import webpush from 'web-push';
import { actionFor, indexTerms, type Term } from '../src/lib/action.ts';
import { daysLeft } from '../src/lib/dates.ts';

const URL = 'https://xxekbzkrixiaehqxyjek.supabase.co/rest/v1/rpc/';
const KEY = 'sb_publishable_AZaUVmXoX8pGMWepO98L7g_-g4Td9W0';
const VAPID_PUBLIC = 'BOgCMmZbH1w_ilrDPxdqdN6TH0KsaCsUP669S7vMRb8ppPueCzXHfWHBeRAKefFtjDRDNxp8tfU4Y7Lt9THXc3o';
const SOON = 7;
const token = process.env.PUSH_TOKEN;
if (!token) throw new Error('Thiếu secret PUSH_TOKEN');
const rpc = async (fn: string, body: object) => {
  const r = await fetch(URL + fn, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};

const d = await rpc('push_export', { p_token: token });
webpush.setVapidDetails('https://yvah4723.github.io/hsd-dry/', VAPID_PUBLIC, d.vapid);
const afternoon = new Date().getHours() >= 12;
let sent = 0;
for (const s of d.stores) {
  const subs = d.subs.filter((x: any) => x.store_id === s.id);
  if (!subs.length) continue;
  const cfg = { idx: indexTerms(d.terms.filter((t: any) => t.store_id === s.id) as Term[]), discountDays: s.discount_days ?? 45, returnBuffer: s.return_buffer_days ?? 5 };
  const n = { exp: 0, ret: 0, disc: 0, pick: 0, rem: 0 };
  for (const l of d.lots.filter((x: any) => x.store_id === s.id)) {
    if (l.status === 'return_notified') { n.pick++; continue; }
    if (l.expiry_note !== 'action_date' && daysLeft(l.expiry_date) < 0) { n.exp++; continue; }
    if (l.status !== 'on_shelf') continue;
    const a = actionFor(l, l.products, cfg), left = daysLeft(a.date);
    if (left <= SOON) a.kind === 'discount' ? n.disc++ : a.kind === 'reminder' ? n.rem++ : n.ret++;
  }
  const parts = [n.exp && `${n.exp} lô quá HSD`, n.ret && `${n.ret} cần báo trả NCC`, n.disc && `${n.disc} cần dán giảm giá`, n.pick && `${n.pick} chờ NCC lấy`, n.rem && `${n.rem} đến ngày nhắc`].filter(Boolean);
  if (!parts.length) continue;
  console.log('Cửa hàng', s.id.slice(0, 8), parts.join(' · '), subs.length, 'máy');
  const payload = JSON.stringify({ title: afternoon ? 'HSD Dry · nhắc lại chiều nay' : 'HSD Dry · việc hôm nay', body: parts.join(' · '), url: 'https://yvah4723.github.io/hsd-dry/' });
  for (const sub of subs) {
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 6 * 3600 }); sent++; }
    catch (e: any) {
      if ([401, 403, 404, 410].includes(e.statusCode)) await rpc('push_remove', { p_token: token, p_endpoint: sub.endpoint });   // máy đã gỡ app / tắt thông báo
      else console.error('Lỗi gửi', e.statusCode, e.body);
    }
  }
}
console.log('Đã gửi', sent, 'thông báo');
