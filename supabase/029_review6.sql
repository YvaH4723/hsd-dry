-- Sửa theo đánh giá lần 6.
-- 1.1) Mốc "trước lần nhập" lấy theo giờ máy chủ, không theo đồng hồ điện thoại.
create or replace function server_now() returns timestamptz language sql stable as $$ select now() $$;
revoke execute on function server_now() from public, anon;
grant execute on function server_now() to authenticated;

-- 2.1) Thiếu quyền xóa nên lệnh dọn lịch sử > 120 ngày trong set_stock không xóa được gì.
drop policy if exists stock_history_del on stock_history;
create policy stock_history_del on stock_history for delete using (is_admin(store_id));

-- 2.2) Nạp file ngày cũ: chỉ ghi 0 cho sản phẩm đã có lịch sử TRƯỚC ngày đó (hàng mới về sau không bị ghi 0).
create or replace function stock_history_set(p_store uuid, p_day date, p_rows jsonb, p_full boolean) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  with x as (select x->>'ax' ax, (x->>'q')::numeric q from jsonb_array_elements(p_rows) x)
  insert into stock_history (store_id, product_id, day, qty)
  select p_store, p.id, p_day, coalesce(x.q, 0)
  from products p left join x on x.ax = p.ax_code
  where p.store_id = p_store and p.deleted_at is null
    and (x.ax is not null or (p_full and exists (select 1 from stock_history h where h.product_id = p.id and h.day < p_day)))
  on conflict (product_id, day) do update set qty = excluded.qty;
  get diagnostics n = row_count;
  return n;
end $$;

-- Báo cáo: giới hạn 1–90 ngày, bỏ món không bán mà cũng hết tồn (không tab nào dùng) cho nhẹ, NCC đúng cửa hàng.
-- ponytail: app vẫn gọi theo trang 1000 dòng (mỗi trang tính lại ~0,5 s khi đủ 44 ngày); chậm thì gộp thành một lần trả JSON.
create or replace function sales_report(p_store uuid, p_days int)
returns table (product_id uuid, ax_code text, name text, name_vi text, vendor text, stock numeric, sold numeric, span int)
language sql stable security definer set search_path = public as $$
  select c.product_id, p.ax_code, p.name, p.name_vi, v.name, p.stock_qty, c.sold, c.span
  from sales_calc(p_store, least(greatest(p_days, 1), 90)) c join products p on p.id = c.product_id and p.store_id = p_store and p.deleted_at is null
  left join vendors v on v.id = p.vendor_id and v.store_id = p_store
  where is_member(p_store) and (c.sold > 0 or p.stock_qty > 0) order by c.sold desc, p.ax_code;
$$;

-- 2.8) Thông báo "sắp hết": cần ít nhất 3 ngày số liệu.
create or replace function push_export(p_token text) returns json
language plpgsql security definer set search_path = public as $function$
begin
  if not exists (select 1 from push_secret where token = p_token) then raise exception 'denied'; end if;
  delete from push_subs s where not exists (select 1 from members m where m.user_id = s.user_id and m.store_id = s.store_id);
  return json_build_object(
    'vapid', (select vapid_private from push_secret limit 1),
    'subs', (select coalesce(json_agg(s), '[]') from (select endpoint, store_id, p256dh, auth from push_subs) s),
    'stores', (select coalesce(json_agg(t), '[]') from (select id, discount_days, return_buffer_days,
        (select count(*) from sales_calc(st.id, 14) c join products p on p.id = c.product_id and p.store_id = st.id and p.deleted_at is null
          where c.span >= 3 and c.sold >= c.span and coalesce(p.stock_qty, 0) < c.sold / c.span * 7) as low
      from stores st) t),
    'terms', (select coalesce(json_agg(t), '[]') from (select store_id, vendor_id, brand, product_id, action, days, pct, raw_text, needs_review from terms where deleted_at is null) t),
    'lots', (select coalesce(json_agg(x), '[]') from (
      select b.store_id, b.expiry_date, b.expiry_note, b.status, b.no_return, b.mfg_date,
        json_build_object('id', p.id, 'brand', p.brand, 'vendor_id', p.vendor_id, 'no_return', p.no_return, 'sanh_dieu', p.sanh_dieu, 'category', p.category,
          'vendors', case when v.id is null then null else json_build_object('code', v.code) end) as products
      from batches b join products p on p.id = b.product_id and p.store_id = b.store_id left join vendors v on v.id = p.vendor_id
      where b.deleted_at is null and b.status in ('on_shelf', 'discounted', 'return_notified')) x));
end $function$;
