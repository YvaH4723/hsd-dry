-- Sửa theo đánh giá lần 5.
-- 1) Ghi lịch sử theo ngày của file (ô "Số liệu ngày"), không phải luôn là hôm nay. Bỏ lịch sử cũ hơn 120 ngày.
drop function if exists set_stock(uuid, jsonb);
create or replace function set_stock(p_store uuid, p_rows jsonb, p_day date default null) returns int
language plpgsql security invoker set search_path = public as $$
declare n int; d date := coalesce(p_day, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
begin
  update products p set stock_qty = (x->>'q')::numeric, stock_at = now()
  from jsonb_array_elements(p_rows) x
  where p.store_id = p_store and p.ax_code = x->>'ax' and p.deleted_at is null;
  get diagnostics n = row_count;
  insert into stock_history (store_id, product_id, day, qty)
  select p_store, p.id, d, (x->>'q')::numeric
  from products p join jsonb_array_elements(p_rows) x on p.ax_code = x->>'ax'
  where p.store_id = p_store and p.deleted_at is null
  on conflict (product_id, day) do update set qty = excluded.qty;
  delete from stock_history where store_id = p_store and day < d - 120;
  return n;
end $$;
revoke execute on function set_stock(uuid, jsonb, date) from public, anon;
grant execute on function set_stock(uuid, jsonb, date) to authenticated;

-- 2) Không xóa tồn hàng loạt: quá 20% số món đang có tồn (tối thiểu 30 món) thì không làm gì, trả về số âm để app cảnh báo
--    (thường do file lệch kiểu / thiếu dòng; xóa thì toàn bộ tồn cũ bị tính thành "đã bán").
drop function if exists clear_stock(uuid, timestamptz);
create or replace function clear_stock(p_store uuid, p_before timestamptz, p_day date default null) returns int
language plpgsql security invoker set search_path = public as $$
declare n int; m int; d date := coalesce(p_day, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
begin
  select count(*) filter (where stock_at < p_before), count(*) into n, m
  from products where store_id = p_store and stock_at is not null and deleted_at is null;
  if n > greatest(30, m * 0.2) then return -n; end if;
  insert into stock_history (store_id, product_id, day, qty)
  select p_store, id, d, 0
  from products where store_id = p_store and stock_at < p_before and deleted_at is null
  on conflict (product_id, day) do update set qty = 0;
  update products set stock_qty = null, stock_at = null
  where store_id = p_store and stock_at < p_before and deleted_at is null;
  return n;
end $$;
revoke execute on function clear_stock(uuid, timestamptz, date) from public, anon;
grant execute on function clear_stock(uuid, timestamptz, date) to authenticated;

-- 9) Chỉ lấy sản phẩm đúng cửa hàng.
create or replace function sales_report(p_store uuid, p_days int)
returns table (product_id uuid, ax_code text, name text, name_vi text, vendor text, stock numeric, sold numeric, span int)
language sql stable security definer set search_path = public as $$
  select c.product_id, p.ax_code, p.name, p.name_vi, v.name, p.stock_qty, c.sold, c.span
  from sales_calc(p_store, p_days) c join products p on p.id = c.product_id and p.store_id = p_store and p.deleted_at is null
  left join vendors v on v.id = p.vendor_id
  where is_member(p_store) order by c.sold desc, p.ax_code;
$$;

-- 3) Thông báo "bán chạy sắp hết": chỉ tính món bán từ 1 cái/ngày trở lên (trước đây bán 1 cái trong 14 ngày cũng tính → ngày nào cũng báo).
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
          where c.span > 0 and c.sold >= c.span and coalesce(p.stock_qty, 0) < c.sold / c.span * 7) as low
      from stores st) t),
    'terms', (select coalesce(json_agg(t), '[]') from (select store_id, vendor_id, brand, product_id, action, days, pct, raw_text, needs_review from terms where deleted_at is null) t),
    'lots', (select coalesce(json_agg(x), '[]') from (
      select b.store_id, b.expiry_date, b.expiry_note, b.status, b.no_return, b.mfg_date,
        json_build_object('id', p.id, 'brand', p.brand, 'vendor_id', p.vendor_id, 'no_return', p.no_return, 'sanh_dieu', p.sanh_dieu, 'category', p.category,
          'vendors', case when v.id is null then null else json_build_object('code', v.code) end) as products
      from batches b join products p on p.id = b.product_id and p.store_id = b.store_id left join vendors v on v.id = p.vendor_id
      where b.deleted_at is null and b.status in ('on_shelf', 'discounted', 'return_notified')) x));
end $function$;
