-- Nạp file tồn của NGÀY CŨ (nhập muộn): chỉ ghi lịch sử, không đụng số tồn hiện tại.
-- p_full: file đủ (không bị cắt) thì sản phẩm đã từng có lịch sử mà không có trong file = 0.
create or replace function stock_history_set(p_store uuid, p_day date, p_rows jsonb, p_full boolean) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  with x as (select x->>'ax' ax, (x->>'q')::numeric q from jsonb_array_elements(p_rows) x)
  insert into stock_history (store_id, product_id, day, qty)
  select p_store, p.id, p_day, coalesce(x.q, 0)
  from products p left join x on x.ax = p.ax_code
  where p.store_id = p_store and p.deleted_at is null
    and (x.ax is not null or (p_full and exists (select 1 from stock_history h where h.product_id = p.id)))
  on conflict (product_id, day) do update set qty = excluded.qty;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function stock_history_set(uuid, date, jsonb, boolean) from public, anon;
grant execute on function stock_history_set(uuid, date, jsonb, boolean) to authenticated;
