-- Lô chuyển từ ExpiryDay: 'estimated' = HSD cộng ngược theo điều khoản NCC; 'action_date' = mới có ngày báo trả.
-- Sửa HSD trong app sẽ xóa ghi chú này.
alter table batches add column if not exists expiry_note text check (expiry_note in ('estimated', 'action_date'));
