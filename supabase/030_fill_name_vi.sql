-- Điền tên tiếng Việt từ file Master Data: chỉ ghi vào sản phẩm đang trống tên Việt (không đè tên đã có / đã sửa tay).
-- name_search tự tính lại nhờ trigger products_search. Chạy với quyền người gọi: chỉ admin sửa được (RLS products_upd).
create or replace function fill_name_vi(p_store uuid, p_rows jsonb) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  update products p set name_vi = x->>'vi', updated_at = now()
  from jsonb_array_elements(p_rows) x
  where p.store_id = p_store and p.ax_code = x->>'ax' and p.deleted_at is null and coalesce(p.name_vi, '') = '';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function fill_name_vi(uuid, jsonb) from public, anon;
grant execute on function fill_name_vi(uuid, jsonb) to authenticated;
