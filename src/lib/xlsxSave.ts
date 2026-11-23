// Lưu file Excel. iPhone (app trên màn hình chính): mở bảng Chia sẻ (Lưu vào Tệp, Zalo, Mail) vì kiểu tải
// bằng <a download> hay bị chặn hoặc mở trang xem trước không có nút quay lại. Máy khác: tải về như thường.
export async function saveXlsx(wb: unknown, name: string) {
  const XLSX = await import('xlsx');
  const file = new File([XLSX.write(wb as any, { bookType: 'xlsx', type: 'array' })], name,
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e: any) { if (e?.name === 'AbortError') return; }               // bấm Hủy trên bảng Chia sẻ
  }
  XLSX.writeFile(wb as any, name);
}
