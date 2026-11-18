import { useEffect, useRef, useState } from 'react';
import { getDetector } from '../lib/scanner.ts';
import Icon from './Icon.tsx';

// Màn quét duy nhất của app. Chỉ bật camera khi bấm nút; giữ camera mở để quét liên tục nhiều món
// (iPhone hay hỏi lại quyền mỗi lần bật). Rời app thì tắt, quay lại thì tự mở lại. Luôn có ô gõ mã và chụp ảnh.
// Trình duyệt nằm trong Zalo / Facebook / Messenger / Instagram / TikTok hay phóng camera toàn màn hình.
const ua = navigator.userAgent;
const INAPP = /Zalo/i.test(ua) ? 'Zalo' : /FBAN|FBAV|FB_IAB|Messenger/i.test(ua) ? 'Facebook / Messenger' : /Instagram/i.test(ua) ? 'Instagram' : /musical_ly|TikTok/i.test(ua) ? 'TikTok' : /; wv\)/.test(ua) ? 'một ứng dụng khác' : '';

const CAM_KEY = 'hsd.camera';

export default function Scanner({ onCode, auto = false }: { onCode: (code: string) => void; auto?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const want = useRef(false);
  const starting = useRef(false);
  const alive = useRef(true);
  const last = useRef({ code: '', at: 0 });
  const cb = useRef(onCode); cb.current = onCode;
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState('');
  const [typed, setTyped] = useState('');
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);        // camera sau (hoặc tất cả nếu máy không ghi tên)
  const [torch, setTorch] = useState<boolean | null>(null);        // null: máy / trình duyệt không cho bật đèn

  const emit = (code: string) => {
    const now = Date.now();
    if (code === last.current.code && now - last.current.at < 2500) return;
    last.current = { code, at: now };
    navigator.vibrate?.(60);
    cb.current(code);
  };

  async function start() {
    if (stream.current || starting.current) return;
    starting.current = true;
    let s: MediaStream | undefined;
    try {
      setMsg('Đang mở camera…');
      // Tải bộ đọc mã và mở camera cùng lúc cho nhanh.
      const detP = getDetector();
      detP.catch(() => {});
      const id = localStorage.getItem(CAM_KEY);
      const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
      s = await navigator.mediaDevices.getUserMedia({ audio: false, video: id ? { deviceId: { exact: id }, ...size } : { facingMode: { ideal: 'environment' }, ...size } })
        .catch(e => { if (!id || e?.name === 'NotAllowedError') throw e; localStorage.removeItem(CAM_KEY); return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, ...size } }); });
      const det = await detP;
      // Bấm Tắt hoặc rời màn trong lúc đang mở camera: nhả camera ngay.
      if (!want.current || !alive.current || document.hidden) { s.getTracks().forEach(t => t.stop()); setMsg(''); return; }
      stream.current = s; setOn(true); setMsg('');
      const track = s.getVideoTracks()[0], caps: any = track.getCapabilities?.() ?? {};
      setTorch(caps.torch ? false : null);
      if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }).catch(() => {});
      navigator.mediaDevices.enumerateDevices().then(ds => {
        const all = ds.filter(d => d.kind === 'videoinput'), back = all.filter(d => /back|rear|sau|environment/i.test(d.label));
        setCams(back.length >= 2 ? back : all);
      }).catch(() => {});
      // Đợi khung camera hiện ra (đang ẩn) rồi mới phát: iPhone phát vào khung đang ẩn thì hay ra màn đen.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const v = video.current!, cur = s;
      // Một số máy / trình duyệt cũ tự phóng video toàn màn hình nếu thiếu các thuộc tính này.
      v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.muted = true; v.srcObject = s; await v.play().catch(() => {});
      setTimeout(() => {
        if (stream.current === cur && !v.videoWidth) { v.play().catch(() => {}); setMsg('Camera chưa lên hình? Bấm Tắt camera rồi Bật lại, hoặc dùng Chụp ảnh.'); }
      }, 2500);
      s.getVideoTracks()[0].addEventListener('ended', () => { want.current = false; stop(); setMsg('Camera bị ngắt. Bấm Bật camera lại.'); });
      const loop = async () => {
        if (stream.current !== cur) return;
        if (v.readyState >= 2) {
          try { const r = await det.detect(v); if (r[0]) emit(r[0].rawValue); } catch { /* khung hỏng, bỏ qua */ }
        }
        setTimeout(loop, 120);
      };
      loop();
    } catch (e: any) {
      if (s && stream.current !== s) s.getTracks().forEach(t => t.stop());
      setMsg(e?.name === 'NotAllowedError' ? 'Chưa cho phép camera. Bật quyền camera cho trang này rồi thử lại, hoặc gõ mã / chụp ảnh.' : 'Không mở được camera: ' + (e?.message ?? e));
      want.current = false;
    } finally { starting.current = false; }
  }
  // Đổi sang camera kế tiếp (iPhone Pro: góc rộng / tele / siêu rộng). Nhớ lựa chọn cho lần sau.
  async function flip() {
    const cur = stream.current?.getVideoTracks()[0]?.getSettings().deviceId;
    const i = cams.findIndex(c => c.deviceId === cur), next = cams[(i + 1) % cams.length];
    if (!next) return;
    localStorage.setItem(CAM_KEY, next.deviceId);
    stop(); want.current = true; await start();
  }
  async function toggleTorch() {
    const t = stream.current?.getVideoTracks()[0];
    if (!t || torch === null) return;
    try { await t.applyConstraints({ advanced: [{ torch: !torch } as any] }); setTorch(!torch); }
    catch { setTorch(null); setMsg('Máy này không cho bật đèn từ trình duyệt.'); }
  }
  function stop() {
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null; setOn(false); setTorch(null);
  }

  useEffect(() => {
    // iPhone (app ngoài màn hình chính) hay hỏi lại quyền camera: không tự bật lại, để người dùng bấm.
    const ios = /iphone|ipad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const vis = () => { if (document.hidden) { stop(); if (ios) want.current = false; } else if (want.current) start(); };
    alive.current = true;
    if (auto) { want.current = true; start(); }
    document.addEventListener('visibilitychange', vis);
    return () => { alive.current = false; document.removeEventListener('visibilitychange', vis); stop(); };
  }, []);

  async function photo(f?: File) {
    if (!f) return;
    try {
      const r = await (await getDetector()).detect(await createImageBitmap(f, { resizeWidth: 1600, resizeQuality: 'high' }));   // ảnh 12MP làm máy cũ treo
      r[0] ? emit(r[0].rawValue) : setMsg('Không đọc được mã trong ảnh. Chụp gần, đủ sáng, giữ thẳng.');
    } catch (e: any) { setMsg('Lỗi đọc ảnh: ' + e.message); }
  }
  const submit = () => { const t = typed.trim(); if (t) { (document.activeElement as HTMLElement | null)?.blur(); cb.current(t); setTyped(''); } };

  return (
    <div className="panel scanner">
      {INAPP && <p className="msg warn">Bạn đang mở app trong {INAPP}, camera có thể bị bật toàn màn hình rồi tắt. Bấm nút ⋯ ở góc → "Mở bằng trình duyệt" (Chrome / Safari), rồi thêm app ra màn hình chính.</p>}
      <div className="viewport" hidden={!on}><video ref={video} playsInline muted /><div className="guide" />
        <div className="camtools">
          {torch !== null && <button className={torch ? 'on' : ''} aria-label={torch ? 'Tắt đèn pin' : 'Bật đèn pin'} aria-pressed={torch} onClick={toggleTorch}><Icon name="flash" size={20} /></button>}
          {cams.length > 1 && <button aria-label="Đổi camera" onClick={flip}><Icon name="flip" size={20} /></button>}
        </div>
      </div>
      <div className="row">
        {on ? <button className="grow" onClick={() => { want.current = false; stop(); }}><Icon name="x" size={18} />Tắt camera</button>
            : <button className="pri grow" onClick={() => { want.current = true; start(); }}><Icon name="camera" size={18} />Bật camera</button>}
        <label className="btnlike"><Icon name="image" size={18} />Chụp ảnh<input type="file" accept="image/*" capture="environment" hidden onChange={e => { photo(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      <form className="row" onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="search grow"><Icon name="search" size={18} />
          <input enterKeyHint="search" aria-label="Gõ mã vạch, mã AX hoặc tên" placeholder="Mã vạch, mã AX hoặc tên" value={typed} onChange={e => setTyped(e.target.value)} />
        </div>
        <button type="submit" disabled={!typed.trim()}>Tìm</button>
      </form>
      {msg && <p className="note" role="status">{msg}</p>}
    </div>
  );
}
