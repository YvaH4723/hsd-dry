import { useEffect, useRef, useState } from 'react';
import { getDetector } from '../lib/scanner.ts';

// Màn quét duy nhất của app. Chỉ bật camera khi bấm nút; giữ camera mở để quét liên tục nhiều món
// (iPhone hay hỏi lại quyền mỗi lần bật). Rời app thì tắt, quay lại thì tự mở lại. Luôn có ô gõ mã và chụp ảnh.
export default function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const want = useRef(false);
  const last = useRef({ code: '', at: 0 });
  const cb = useRef(onCode); cb.current = onCode;
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState('');
  const [typed, setTyped] = useState('');

  const emit = (code: string) => {
    const now = Date.now();
    if (code === last.current.code && now - last.current.at < 2500) return;
    last.current = { code, at: now };
    navigator.vibrate?.(60);
    cb.current(code);
  };

  async function start() {
    if (stream.current) return;
    try {
      setMsg('Đang mở camera…');
      const det = await getDetector();
      const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      stream.current = s; setOn(true); setMsg('');
      const v = video.current!; v.srcObject = s; await v.play().catch(() => {});
      s.getVideoTracks()[0].addEventListener('ended', () => { stop(); setMsg('Camera bị ngắt. Bấm Bật camera lại.'); });
      const loop = async () => {
        if (stream.current !== s) return;
        if (v.readyState >= 2) {
          try { const r = await det.detect(v); if (r[0]) emit(r[0].rawValue); } catch { /* khung hỏng, bỏ qua */ }
        }
        setTimeout(loop, 120);
      };
      loop();
    } catch (e: any) {
      setMsg(e?.name === 'NotAllowedError' ? 'Chưa cho phép camera. Bật quyền camera cho trang này rồi thử lại, hoặc gõ mã / chụp ảnh.' : 'Không mở được camera: ' + (e?.message ?? e));
      want.current = false;
    }
  }
  function stop() {
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null; setOn(false);
  }

  useEffect(() => {
    const vis = () => { if (document.hidden) stop(); else if (want.current) start(); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); stop(); };
  }, []);

  async function photo(f?: File) {
    if (!f) return;
    try {
      const r = await (await getDetector()).detect(await createImageBitmap(f));
      r[0] ? emit(r[0].rawValue) : setMsg('Không đọc được mã trong ảnh. Chụp gần, đủ sáng, giữ thẳng.');
    } catch (e: any) { setMsg('Lỗi đọc ảnh: ' + e.message); }
  }

  return (
    <div className="card">
      <video ref={video} playsInline muted style={{ width: '100%', borderRadius: 10, display: on ? 'block' : 'none', background: '#000', maxHeight: '40vh', objectFit: 'cover' }} />
      <div className="row" style={{ marginTop: 8 }}>
        {on ? <button onClick={() => { want.current = false; stop(); }}>Tắt camera</button>
            : <button className="pri" onClick={() => { want.current = true; start(); }}>Bật camera</button>}
        <label className="btnlike">Chụp ảnh mã<input type="file" accept="image/*" capture="environment" hidden onChange={e => { photo(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input inputMode="numeric" placeholder="Gõ mã vạch / mã AX" value={typed} onChange={e => setTyped(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && typed.trim()) { cb.current(typed.trim()); setTyped(''); } }} />
        <button style={{ flex: '0 0 auto' }} disabled={!typed.trim()} onClick={() => { cb.current(typed.trim()); setTyped(''); }}>Tìm</button>
      </div>
      {msg && <p className="mute">{msg}</p>}
    </div>
  );
}
