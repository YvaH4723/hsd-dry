-- Tồn kho từ file Stock On Hand (D365), nhập mỗi ngày. stock_at: ngày của số liệu.
alter table products add column if not exists stock_qty numeric, add column if not exists stock_at timestamptz;
alter table import_runs drop constraint if exists import_runs_kind_check;
alter table import_runs add constraint import_runs_kind_check check (kind in ('cadencia', 'contact_list', 'stock'));

-- Ghi tồn hàng loạt theo mã AX: [{ax, q}]. Chạy theo quyền người gọi (RLS: chỉ quản lý sửa được sản phẩm).
create or replace function set_stock(p_store uuid, p_rows jsonb) returns int
language sql security invoker set search_path = public as $$
  with u as (
    update products p set stock_qty = (x->>'q')::numeric, stock_at = now()
    from jsonb_array_elements(p_rows) x
    where p.store_id = p_store and p.ax_code = x->>'ax' and p.deleted_at is null
    returning 1)
  select count(*)::int from u;
$$;
revoke execute on function set_stock(uuid, jsonb) from public, anon;
grant execute on function set_stock(uuid, jsonb) to authenticated;
