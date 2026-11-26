-- Ước lượng hàng đã bán từ lịch sử tồn: cộng các lần tồn GIẢM giữa 2 mốc liền nhau (tồn tăng = nhập hàng, bỏ qua).
-- ponytail: ngày vừa nhập hàng vừa bán thì phần bán bị tính thiếu; có số bán thật từ POS thì thay bằng số đó.
create or replace function sales_calc(p_store uuid, p_days int) returns table (product_id uuid, sold numeric, span int)
language sql stable set search_path = public as $$
  with t as (select (now() at time zone 'Asia/Ho_Chi_Minh')::date d),
  h as (select s.product_id, s.day, s.qty, lag(s.qty) over w pq, lag(s.day) over w pd
        from stock_history s, t where s.store_id = p_store and s.day >= t.d - p_days - 14
        window w as (partition by s.product_id order by s.day))
  select h.product_id, sum(greatest(h.pq - h.qty, 0)), (max(h.day) - min(h.pd))::int
  from h, t where h.pd is not null and h.day > t.d - p_days group by h.product_id;
$$;
revoke execute on function sales_calc(uuid, int) from public, anon, authenticated;

create or replace function sales_report(p_store uuid, p_days int)
returns table (product_id uuid, ax_code text, name text, name_vi text, vendor text, stock numeric, sold numeric, span int)
language sql stable security definer set search_path = public as $$
  select c.product_id, p.ax_code, p.name, p.name_vi, v.name, p.stock_qty, c.sold, c.span
  from sales_calc(p_store, p_days) c join products p on p.id = c.product_id and p.deleted_at is null
  left join vendors v on v.id = p.vendor_id
  where is_member(p_store) order by c.sold desc, p.ax_code;
$$;
revoke execute on function sales_report(uuid, int) from public, anon;
grant execute on function sales_report(uuid, int) to authenticated;

-- Thông báo: số món bán chạy (14 ngày) mà tồn chỉ đủ dưới 7 ngày.
create or replace function push_export(p_token text) returns json
language plpgsql security definer set search_path = public as $function$
begin
  if not exists (select 1 from push_secret where token = p_token) then raise exception 'denied'; end if;
  delete from push_subs s where not exists (select 1 from members m where m.user_id = s.user_id and m.store_id = s.store_id);
  return json_build_object(
    'vapid', (select vapid_private from push_secret limit 1),
    'subs', (select coalesce(json_agg(s), '[]') from (select endpoint, store_id, p256dh, auth from push_subs) s),
    'stores', (select coalesce(json_agg(t), '[]') from (select id, discount_days, return_buffer_days,
        (select count(*) from sales_calc(st.id, 14) c join products p on p.id = c.product_id and p.deleted_at is null
          where c.sold > 0 and c.span > 0 and coalesce(p.stock_qty, 0) < c.sold / c.span * 7) as low
      from stores st) t),
    'terms', (select coalesce(json_agg(t), '[]') from (select store_id, vendor_id, brand, product_id, action, days, pct, raw_text, needs_review from terms where deleted_at is null) t),
    'lots', (select coalesce(json_agg(x), '[]') from (
      select b.store_id, b.expiry_date, b.expiry_note, b.status, b.no_return, b.mfg_date,
        json_build_object('id', p.id, 'brand', p.brand, 'vendor_id', p.vendor_id, 'no_return', p.no_return, 'sanh_dieu', p.sanh_dieu, 'category', p.category,
          'vendors', case when v.id is null then null else json_build_object('code', v.code) end) as products
      from batches b join products p on p.id = b.product_id and p.store_id = b.store_id left join vendors v on v.id = p.vendor_id
      where b.deleted_at is null and b.status in ('on_shelf', 'discounted', 'return_notified')) x));
end $function$;
