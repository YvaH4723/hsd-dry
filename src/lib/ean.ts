// Bộ đọc EAN-13 / UPC-A dự phòng, chạy khi ZXing không đọc được. Hay gặp: mã in sát mép nhãn (không có vùng trắng
// ở cuối), vạch in mảnh hơn khoảng trắng. Đo khoảng cách giữa các cạnh cùng chiều (vạch+trắng) nên không phụ thuộc
// độ dày mực, không cần vạch kết thúc. Chỉ nhận khi đúng số kiểm tra và ít nhất 2 dòng quét ra cùng một mã.
const L: number[][] = [[3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2], [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2]];
const G = L.map(w => [...w].reverse());
const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

// Một chữ số (4 phần tử, 7 module): chọn mẫu khớp khoảng cạnh-cạnh, hòa thì so tổng 2 vạch.
function digit(w: number[], T: number[][]): [number, number] | null {
  const m = (w[0] + w[1] + w[2] + w[3]) / 7, t1 = Math.round((w[0] + w[1]) / m), t2 = Math.round((w[1] + w[2]) / m);
  let best: [number, number] | null = null;
  T.forEach((p, d) => {
    if (p[0] + p[1] !== t1 || p[1] + p[2] !== t2) return;
    const err = Math.abs((w[1] + w[3]) / m - (p[1] + p[3])) + Math.abs((w[0] + w[2]) / m - (p[0] + p[2]));
    if (!best || err < best[1]) best = [d, err];
  });
  return best;
}

// runs: độ rộng các đoạn, phần tử đầu là vạch. Thử mọi vị trí vạch bắt đầu.
export function decodeRuns(runs: number[]): string | null {
  for (let i = 0; i + 56 <= runs.length; i += 2) {
    const r = runs.slice(i, i + 56), m = r.reduce((a, b) => a + b, 0) / 92;
    const ok = (k: number) => r[k] > m * 0.4 && r[k] < m * 1.8;
    if (![0, 1, 2, 27, 28, 29, 30, 31].every(ok)) continue;              // vạch mở đầu, giữa
    if (i > 0 && runs[i - 1] < m * 3) continue;                            // trước vạch mở đầu phải là vùng trắng
    const ds: number[] = []; let par = '', bad = false;
    for (let k = 3; k < 27 && !bad; k += 4) {
      const w = r.slice(k, k + 4), a = digit(w, L), b = digit(w, G);
      if (!a && !b) bad = true;
      else if (a && (!b || a[1] <= b[1])) { ds.push(a[0]); par += 'L'; } else { ds.push(b![0]); par += 'G'; }
    }
    for (let k = 32; k < 56 && !bad; k += 4) { const a = digit(r.slice(k, k + 4), L); a ? ds.push(a[0]) : bad = true; }
    const first = PAR.indexOf(par);
    if (bad || first < 0) continue;
    const c = [first, ...ds], s = c.slice(0, 12).reduce((a, v, j) => a + v * (j % 2 ? 3 : 1), 0);
    if ((10 - s % 10) % 10 === c[12]) return c.join('');
  }
  return null;
}

// Một dòng điểm ảnh xám → độ rộng đoạn tối/sáng (ngưỡng theo trung bình cục bộ), bắt đầu bằng đoạn tối.
export function rowRuns(px: ArrayLike<number>): number[] {
  const n = px.length, W = Math.max(15, n >> 4), sum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + px[i];
  const runs: number[] = []; let cur = false, len = 0, started = false;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - W), b = Math.min(n, i + W), dark = px[i] < (sum[b] - sum[a]) / (b - a) - 6;
    if (!started) { if (dark) { started = true; cur = true; len = 1; } else continue; }
    else if (dark === cur) len++;
    else { runs.push(len); cur = dark; len = 1; }
  }
  if (started) runs.push(len);
  return runs;
}

// Quét nhiều dòng ngang và dọc của ảnh xám (w×h), cả hai chiều đọc.
export function scanGray(g: Uint8Array, w: number, h: number): string | null {
  const seen = new Map<string, number>();
  const hit = (px: ArrayLike<number>) => {
    for (const r of [rowRuns(px), rowRuns(Array.from(px).reverse())]) {
      const code = decodeRuns(r);
      if (code && (seen.set(code, (seen.get(code) ?? 0) + 1).get(code)! >= 2)) return code;
    }
    return null;
  };
  for (let k = 1; k < 24; k++) {
    const y = Math.floor(h * k / 24), x = Math.floor(w * k / 24);
    const c1 = hit(g.subarray(y * w, y * w + w)); if (c1) return c1;
    const col = new Uint8Array(h); for (let j = 0; j < h; j++) col[j] = g[j * w + x];
    const c2 = hit(col); if (c2) return c2;
  }
  return null;
}

// Từ ảnh / khung camera: lấy vùng giữa (khung ngắm), chuyển xám rồi quét.
const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
export function scanImage(src: CanvasImageSource, W: number, H: number, crop = true): string | null {
  if (!cv || !W || !H) return null;
  const sw = crop ? Math.round(W * 0.9) : W, sh = crop ? Math.round(H * 0.7) : H, k = Math.min(1, 1400 / Math.max(sw, sh));
  const w = Math.round(sw * k), h = Math.round(sh * k);
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(src, (W - sw) / 2, (H - sh) / 2, sw, sh, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
  return scanGray(g, w, h);
}
