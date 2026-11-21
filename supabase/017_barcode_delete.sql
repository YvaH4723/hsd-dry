-- Quản lý gỡ được mã vạch gắn nhầm (xóa hẳn để mã gắn lại được cho đúng sản phẩm).
create policy barcodes_del on barcodes for delete using (is_admin(store_id));
