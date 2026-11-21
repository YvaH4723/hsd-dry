-- Điều khoản theo % hạn dùng: NCC nhận trả khi lô còn pct% thời gian từ NSX đến HSD.
-- Ngày báo trả = HSD − ceil(pct% × (HSD − NSX)) − số ngày an toàn. Lô thiếu NSX: app nhắc nhập NSX.
alter table terms add column if not exists pct smallint check (pct between 1 and 99);
-- push_export: thêm t.pct vào terms và b.mfg_date vào lots (xem bản đang chạy trên máy chủ).
