import type { Zone } from '../lib/db.ts';

// Hàng nút lọc theo khu. Ẩn khi cửa hàng chưa chia khu.
export default function ZoneChips({ zones, mine, value, onChange }: { zones: Zone[]; mine: string[]; value: string; onChange: (v: string) => void }) {
  if (!zones.length) return null;
  const opts: [string, string][] = [...(mine.length ? [['mine', 'Khu của tôi'] as [string, string]] : []), ['all', 'Tất cả khu'], ...zones.map(z => [z.id, z.name] as [string, string])];
  return (
    <div className="chips" role="group" aria-label="Lọc theo khu">
      {opts.map(([k, t]) => <button key={k} aria-pressed={value === k} onClick={() => onChange(k)}>{t}</button>)}
    </div>
  );
}
