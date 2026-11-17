// Bộ giải mã: dùng BarcodeDetector có sẵn (Android Chrome), không có thì dùng WASM tự host (iPhone).
// Dùng lại đúng thư viện đã thử ở trang thử quét (public/thu-quet/lib).
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
const LIB = import.meta.env.BASE_URL + 'thu-quet/lib/';
export interface Detector { detect(src: CanvasImageSource | ImageBitmap): Promise<{ rawValue: string; format: string }[]> }

let lib: Promise<any> | null = null;
const loadLib = () => lib ??= new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = LIB + 'barcode-detector.js';
  s.onload = () => {
    const api = (window as any).BarcodeDetectionAPI;
    api.prepareZXingModule({ overrides: { locateFile: (p: string, pre: string) => p.endsWith('.wasm') ? LIB + p : pre + p } });
    ok(api);
  };
  s.onerror = () => { lib = null; fail(new Error('Không tải được bộ quét mã')); };
  document.head.appendChild(s);
});

let det: Promise<Detector> | null = null;
export const getDetector = () => det ??= (async () => {
  const N = (window as any).BarcodeDetector;
  if (N) try {
    const sup: string[] = await N.getSupportedFormats();
    const f = FORMATS.filter(x => sup.includes(x));
    if (f.length) return new N({ formats: f }) as Detector;
  } catch { /* rơi xuống WASM */ }
  return new (await loadLib()).BarcodeDetector({ formats: FORMATS }) as Detector;
})().catch(e => { det = null; throw e; });
