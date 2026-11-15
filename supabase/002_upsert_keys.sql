-- Chạy sau schema.sql. Đổi 2 chỉ mục "partial" thành ràng buộc thường để app nhập Excel dùng upsert được.
-- (NULL vẫn được phép lặp, nên sản phẩm chưa có AX Code không bị ảnh hưởng.)
drop index if exists products_ax_uq;
alter table products add constraint products_ax_uq unique (store_id, ax_code);
drop index if exists barcodes_code_uq;
alter table barcodes add constraint barcodes_code_uq unique (store_id, code);
