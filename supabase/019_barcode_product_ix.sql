-- Tải dữ liệu về máy bị quá thời gian: thiếu index cho mã vạch theo sản phẩm.
create index if not exists barcodes_product_ix on barcodes (product_id);
create index if not exists products_store_ix on products (store_id, id) where deleted_at is null;
