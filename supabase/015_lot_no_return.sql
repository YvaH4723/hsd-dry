-- Riêng từng lô không đổi trả (ít hàng, NCC không nhận lại): chỉ dán giảm giá (HSD − mốc giảm giá), bất kể điều khoản NCC.
alter table batches add column if not exists no_return boolean not null default false;
-- push_export: thêm b.no_return vào lots để thông báo đẩy tính đúng (xem bản đang chạy trên máy chủ).
