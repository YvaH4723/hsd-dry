-- Báo trả sớm thêm N ngày cho an toàn (mặc định 5). Lô chuyển từ ExpiryDay loại báo trả: cộng 5 vào HSD ước tính để ngày nhắc vẫn trùng ngày cũ.
-- Chỉ chạy một lần: lần hai sẽ báo lỗi "already exists" và không cộng thêm gì.
alter table stores add column return_buffer_days int not null default 5;
update batches b set expiry_date = b.expiry_date + 5
from products p join vendors v on v.id = p.vendor_id
where b.product_id = p.id and b.created_by is null and b.expiry_note = 'estimated'
  and v.code not in ('AFF01', 'SG99') and not p.no_return and not p.sanh_dieu
  and coalesce((select t.action = 'return' and t.days is not null and not t.needs_review from terms t
    where t.vendor_id = p.vendor_id and t.deleted_at is null and (t.product_id = p.id
      or (t.product_id is null and (t.brand is null or lower(trim(t.brand)) = lower(trim(p.brand)))))
    order by (t.product_id is not null) desc, (t.brand is not null) desc limit 1), false);