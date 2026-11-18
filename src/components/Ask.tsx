import { useEffect, useRef, useState } from 'react';

// Hộp xác nhận trượt từ dưới lên, thay cho confirm() của trình duyệt. Gọi được ở bất kỳ đâu: if (!await ask({...})) return;
interface Q { title: string; body?: string; ok: string; danger?: boolean; done: (v: boolean) => void }
let show: ((q: Q) => void) | null = null;

export const ask = (q: Omit<Q, 'done'>) => new Promise<boolean>(done => show ? show({ ...q, done }) : done(confirm([q.title, q.body].filter(Boolean).join('\n\n'))));

export function AskHost() {
  const [q, setQ] = useState<Q | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { show = setQ; return () => { show = null; }; }, []);
  useEffect(() => {
    if (!q) return;
    (document.activeElement as HTMLElement | null)?.blur?.();   // ẩn bàn phím đang mở
    okRef.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close(false);
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [q]);
  if (!q) return null;
  function close(v: boolean) { q!.done(v); setQ(null); }
  return (
    <div className="sheet-bg" onClick={e => e.target === e.currentTarget && close(false)}>
      <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="ask-t" aria-describedby={q.body ? 'ask-b' : undefined}>
        <h2 id="ask-t">{q.title}</h2>
        {q.body && <p id="ask-b">{q.body}</p>}
        <div className="sheet-btns">
          <button ref={okRef} className={q.danger ? 'danger-solid' : 'pri'} onClick={() => close(true)}>{q.ok}</button>
          <button onClick={() => close(false)}>Hủy</button>
        </div>
      </div>
    </div>
  );
}
