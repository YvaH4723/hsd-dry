-- Sửa theo đánh giá lần 3 (Antigravity).
-- 1. Tồn kho: bỏ số tồn cũ của sản phẩm không còn trong file mới (file đủ, không bị cắt).
create or replace function clear_stock(p_store uuid, p_before timestamptz) returns int
language sql security invoker set search_path = public as $$
  with u as (update products set stock_qty = null, stock_at = null
             where store_id = p_store and stock_at < p_before and deleted_at is null returning 1)
  select count(*)::int from u;
$$;
revoke execute on function clear_stock(uuid, timestamptz) from public, anon;
grant execute on function clear_stock(uuid, timestamptz) to authenticated;

-- 2. Mã vạch: app không bao giờ sửa (chỉ thêm / gỡ), bỏ quyền sửa để nhân viên không tráo mã qua API.
drop policy if exists barcodes_upd on barcodes;

-- 3. Người thêm lô / biển tên: luôn là người đang đăng nhập, không sửa được về sau.
create or replace function stamp_created_by() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); new.created_at := coalesce(new.created_at, now());
  else new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end $$;
drop trigger if exists batches_created_by on batches;
create trigger batches_created_by before insert or update on batches for each row execute function stamp_created_by();
drop trigger if exists labels_created_by on labels;
create trigger labels_created_by before insert or update on labels for each row execute function stamp_created_by();

-- 4. claim_op chỉ dùng bên trong add_qty: không cho gọi thẳng (bơm rác vào applied_ops).
create or replace function add_qty(p_id uuid, p_n int, p_op uuid default null) returns table(qty int, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from batches where id = p_id and can_write(store_id) and deleted_at is null;
  if not found or p_n is null or p_n <= 0 then return; end if;                 -- không có quyền / lô đã xóa: không ghi dấu
  if p_op is not null then
    insert into applied_ops(op) values (p_op) on conflict do nothing;
    if not found then                                                         -- đã cộng lần trước: trả số hiện tại
      return query select b.qty, b.updated_at from batches b where b.id = p_id;
      return;
    end if;
  end if;
  return query update batches set qty = batches.qty + p_n where id = p_id
    returning batches.qty, batches.updated_at;
end $$;
revoke execute on function add_qty(uuid, int, uuid) from public, anon;
grant execute on function add_qty(uuid, int, uuid) to authenticated;
revoke execute on function claim_op(uuid) from public, anon, authenticated;

-- 5. push_export bản đầy đủ (gộp các sửa của 015, 016, 021 để repo có một nguồn chuẩn) + nối sản phẩm cùng cửa hàng.
create or replace function push_export(p_token text) returns json
language plpgsql security definer set search_path = public as $function$
begin
  if not exists (select 1 from push_secret where token = p_token) then raise exception 'denied'; end if;
  delete from push_subs s where not exists (select 1 from members m where m.user_id = s.user_id and m.store_id = s.store_id);
  return json_build_object(
    'vapid', (select vapid_private from push_secret limit 1),
    'subs', (select coalesce(json_agg(s), '[]') from (select endpoint, store_id, p256dh, auth from push_subs) s),
    'stores', (select coalesce(json_agg(t), '[]') from (select id, discount_days, return_buffer_days from stores) t),
    'terms', (select coalesce(json_agg(t), '[]') from (select store_id, vendor_id, brand, product_id, action, days, pct, raw_text, needs_review from terms where deleted_at is null) t),
    'lots', (select coalesce(json_agg(x), '[]') from (
      select b.store_id, b.expiry_date, b.expiry_note, b.status, b.no_return, b.mfg_date,
        json_build_object('id', p.id, 'brand', p.brand, 'vendor_id', p.vendor_id, 'no_return', p.no_return, 'sanh_dieu', p.sanh_dieu, 'category', p.category,
          'vendors', case when v.id is null then null else json_build_object('code', v.code) end) as products
      from batches b join products p on p.id = b.product_id and p.store_id = b.store_id left join vendors v on v.id = p.vendor_id
      where b.deleted_at is null and b.status in ('on_shelf', 'discounted', 'return_notified')) x));
end $function$;
revoke execute on function stamp_created_by() from public, anon, authenticated;
