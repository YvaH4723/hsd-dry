// Bộ đọc EAN-13 / UPC-A dự phòng, chạy khi ZXing không đọc được. Hay gặp: mã in sát mép nhãn (không có vùng trắng
// ở cuối), vạch in mảnh hơn khoảng trắng. Đo khoảng cách giữa các cạnh cùng chiều (vạch+trắng) nên không phụ thuộc
// độ dày mực, không cần vạch kết thúc. Chỉ nhận khi đúng số kiểm tra và ít nhất 2 dòng quét ra cùng một mã.
const L: number[][] = [[3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2], [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2]];
const G = L.map(w => [...w].reverse());
const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

// Một chữ số (4 phần tử, 7 module): chọn mẫu khớp khoảng cạnh-cạnh, hòa thì so tổng 2 vạch.
function digit(w: number[], T: number[][]): [number, number] | null {
  const m = (w[0] + w[1] + w[2] + w[3]) / 7, t1 = Math.round((w[0] + w[1]) / m), t2 = Math.round((w[1] + w[2]) / m);
  const c: [number, number][] = [];
  T.forEach((p, d) => {
    if (p[0] + p[1] !== t1 || p[1] + p[2] !== t2) return;
    c.push([d, Math.abs((w[1] + w[3]) / m - (p[1] + p[3])) + Math.abs((w[0] + w[2]) / m - (p[0] + p[2]))]);
  });
  c.sort((a, b) => a[1] - b[1]);
  return c.length && (c.length < 2 || c[1][1] - c[0][1] >= 1) ? c[0] : null;   // 1↔7, 2↔8 sát nhau quá: không đoán
}

// runs: độ rộng các đoạn, phần tử đầu là vạch. Thử mọi vị trí vạch bắt đầu.
export function decodeRuns(runs: number[]): string | null {
  for (let i = 0; i + 56 <= runs.length; i += 2) {
    const r = runs.slice(i, i + 56), m = r.reduce((a, b) => a + b, 0) / 92;
    const ok = (k: number) => r[k] > m * 0.4 && r[k] < m * 1.8;
    if (![0, 1, 2, 27, 28, 29, 30, 31].every(ok)) continue;              // vạch mở đầu, giữa
    if (i > 0 && runs[i - 1] < m * 3) continue;                            // trước vạch mở đầu phải là vùng trắng
    // Bù độ loang / co mực: vạch mở đầu và vạch giữa đều 1 module, đo xem vạch mảnh hơn khoảng trắng bao nhiêu.
    const d = ((r[1] + r[27] + r[29] + r[31]) - (r[0] + r[2] + r[28] + r[30])) / 8;
    const cr = r.map((w, k) => w + (k % 2 ? -d : d));
    const okSum = (k: number) => { const s = cr[k] + cr[k + 1] + cr[k + 2] + cr[k + 3]; return s > m * 5.5 && s < m * 8.5; };
    const ds: number[] = []; let par = '', bad = false;
    for (let k = 3; k < 27 && !bad; k += 4) {
      if (!okSum(k)) { bad = true; break; }
      const w = cr.slice(k, k + 4), a = digit(w, L), b = digit(w, G);
      if (!a && !b) bad = true;
      else if (a && (!b || a[1] <= b[1])) { ds.push(a[0]); par += 'L'; } else { ds.push(b![0]); par += 'G'; }
    }
    for (let k = 32; k < 56 && !bad; k += 4) { const a = okSum(k) && digit(cr.slice(k, k + 4), L); a ? ds.push(a[0]) : bad = true; }
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

// Mã in loang mực (khe trắng 1 module bị lấp, 2 vạch dính thành 1): không tách được vạch theo mép nên đếm độ rộng hỏng.
// Cách khác: lấy mép trái của vạch mở đầu và mép phải của vạch kết thúc, chia đều 95 ô (module), ô nào tối hơn
// trung bình 7 ô quanh nó là vạch. Khe bị lấp vẫn sáng hơn vạch hai bên nên vẫn nhận ra. Nặng hơn: chỉ dùng cho ảnh chụp.
const BITS_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const BITS_R = BITS_L.map(p => [...p].map(c => c === '0' ? '1' : '0').join('')), BITS_G = BITS_R.map(p => [...p].reverse().join(''));
function decodeBits(b: string): string | null {
  if (b.slice(0, 3) !== '101' || b.slice(45, 50) !== '01010' || b.slice(92) !== '101') return null;
  const ds: number[] = []; let par = '';
  for (let k = 0; k < 6; k++) {
    const x = b.slice(3 + 7 * k, 10 + 7 * k), l = BITS_L.indexOf(x), g = BITS_G.indexOf(x);
    if (l >= 0) { ds.push(l); par += 'L'; } else if (g >= 0) { ds.push(g); par += 'G'; } else return null;
  }
  for (let k = 0; k < 6; k++) { const r = BITS_R.indexOf(b.slice(50 + 7 * k, 57 + 7 * k)); if (r < 0) return null; ds.push(r); }
  const c = [PAR.indexOf(par), ...ds];
  if (c[0] < 0) return null;
  const s = c.slice(0, 12).reduce((a, v, j) => a + v * (j % 2 ? 3 : 1), 0);
  return (10 - s % 10) % 10 === c[12] ? c.join('') : null;
}
export function gridRow(px: ArrayLike<number>): string | null {
  const n = px.length, W = Math.max(15, n >> 4), sum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + px[i];
  const dark = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - W), b = Math.min(n, i + W); dark[i] = +(px[i] < (sum[b] - sum[a]) / (b - a) - 6); }
  // Mép trái: đầu đoạn tối có ≥ 6 điểm sáng phía trước (vùng trắng). Mép phải: cuối đoạn tối có ≥ 3 điểm sáng phía sau.
  // Chỉ thử đoạn giống mã vạch: 12–32 vạch (EAN có 30, loang thì dính bớt), không có khoảng trắng nào dài quá 5 module.
  const at = (x: number) => { const i = Math.min(n - 2, Math.max(0, Math.floor(x))), f = x - i; return px[i] * (1 - f) + px[i + 1] * f; };
  const v = new Float64Array(95), OFF = [-0.3, -0.15, 0, 0.15, 0.3, 0.45];   // mực loang làm vạch đầu/cuối phình ra
  for (let l = 6; l < n; l++) {
    if (!dark[l] || dark[l - 1] || dark[l - 2] || dark[l - 3] || dark[l - 4] || dark[l - 5] || dark[l - 6]) continue;
    let bars = 0, gap = 0, maxGap = 0;
    for (let i = l; i + 3 < n; i++) {
      if (dark[i]) { if (i === l || !dark[i - 1]) bars++; gap = 0; } else maxGap = Math.max(maxGap, ++gap);
      if (bars > 32 || maxGap > 60 || i - l > 95 * 12) break;
      if (!dark[i] || dark[i + 1] || dark[i + 2] || dark[i + 3]) continue;
      const r = i + 1, m0 = (r - l) / 95;
      if (m0 < 1.5 || bars < 12 || maxGap > 5 * m0) continue;
      for (const dl of OFF) for (const dr of OFF) {
        const x0 = l - dl * m0, m = (r + dr * m0 - x0) / 95;
        for (let k = 0; k < 95; k++) v[k] = at(x0 + (k + 0.5) * m);
        let bits = '';
        for (let k = 0; k < 95; k++) {
          let t = 0; for (let j = k - 3; j <= k + 3; j++) t += v[Math.min(94, Math.max(0, j))];
          bits += v[k] < t / 7 ? '1' : '0';
        }
        const c = decodeBits(bits);
        if (c) return c;
      }
    }
  }
  return null;
}

// Quét nhiều dòng ngang và dọc của ảnh xám (w×h), cả hai chiều đọc.
export function scanGray(g: Uint8Array, w: number, h: number, deep = false): string | null {
  const seen = new Map<string, number>();
  const ok = (code: string | null) => !!code && seen.set(code, (seen.get(code) ?? 0) + 1).get(code)! >= 2;
  const hit = (px: ArrayLike<number>) => {
    const rev = Array.from(px).reverse();
    for (const r of [rowRuns(px), rowRuns(rev)]) { const code = decodeRuns(r); if (ok(code)) return code; }
    if (deep) for (const p of [px, rev]) { const code = gridRow(p); if (ok(code)) return code; }
    return null;
  };
  // Ảnh chụp: mã nhỏ trong khung chỉ trúng vài dòng nên quét dày hơn.
  // Ảnh chụp kỹ: dòng là trung bình ~13 dòng liền nhau (dọc theo vạch) để bớt nhiễu mực in.
  const N = deep ? 96 : 24, R = deep ? Math.max(2, Math.round(Math.min(w, h) / 250)) : 0;
  for (let k = 1; k < N; k++) {
    const y = Math.floor(h * k / N), x = Math.floor(w * k / N);
    const row = new Float32Array(w), col = new Float32Array(h);
    for (let d = -R; d <= R; d++) {
      const yy = Math.min(h - 1, Math.max(0, y + d)), xx = Math.min(w - 1, Math.max(0, x + d));
      for (let j = 0; j < w; j++) row[j] += g[yy * w + j];
      for (let j = 0; j < h; j++) col[j] += g[j * w + xx];
    }
    if (R) { for (let j = 0; j < w; j++) row[j] /= 2 * R + 1; for (let j = 0; j < h; j++) col[j] /= 2 * R + 1; }
    const c1 = hit(row); if (c1) return c1;
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
  return scanGray(g, w, h, !crop);   // ảnh chụp (không cắt khung): quét kỹ
}
