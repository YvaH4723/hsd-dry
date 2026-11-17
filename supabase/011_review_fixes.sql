-- Sửa theo bản rà soát 17/11.
-- B2: chỉ duyệt tài khoản đã xác nhận email.
create or replace function pending_users(p_store uuid) returns table(email text, name text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_store) then raise exception 'Chỉ quản trị viên'; end if;
  return query select u.email::text, coalesce(u.raw_user_meta_data->>'name', '')::text, u.created_at from auth.users u
    where u.email is not null and u.email_confirmed_at is not null
      and not exists (select 1 from members m where m.user_id = u.id) order by u.created_at desc;
end $$;
create or replace function add_member(p_store uuid, p_email text, p_name text, p_role member_role default 'staff')
returns text language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not is_admin(p_store) then raise exception 'Chỉ quản trị viên được thêm thành viên'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
  if u is null then return 'chua_dang_ky'; end if;
  if exists (select 1 from members where user_id = u and store_id = p_store) then return 'da_co'; end if;
  insert into members(user_id, store_id, name, email, role, can_write, can_delete)
  values (u, p_store, coalesce(nullif(trim(p_name), ''), split_part(trim(p_email), '@', 1)), lower(trim(p_email)), p_role, p_role <> 'viewer', false);
  return 'ok';
end $$;

-- B3: người đã bị bỏ khỏi cửa hàng không nhận thông báo nữa (và xóa luôn đăng ký của họ).
create or replace function push_export(p_token text) returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from push_secret where token = p_token) then raise exception 'denied'; end if;
  delete from push_subs s where not exists (select 1 from members m where m.user_id = s.user_id and m.store_id = s.store_id);
  return json_build_object(
    'vapid', (select vapid_private from push_secret limit 1),
    'subs', (select coalesce(json_agg(s), '[]') from (select endpoint, store_id, p256dh, auth from push_subs) s),
    'stores', (select coalesce(json_agg(t), '[]') from (select id, discount_days, return_buffer_days from stores) t),
    'terms', (select coalesce(json_agg(t), '[]') from (select store_id, vendor_id, brand, product_id, action, days, raw_text, needs_review from terms where deleted_at is null) t),
    'lots', (select coalesce(json_agg(x), '[]') from (
      select b.store_id, b.expiry_date, b.expiry_note, b.status,
        json_build_object('id', p.id, 'brand', p.brand, 'vendor_id', p.vendor_id, 'no_return', p.no_return, 'sanh_dieu', p.sanh_dieu,
                          'vendors', case when v.id is null then null else json_build_object('code', v.code) end) as products
      from batches b join products p on p.id = b.product_id left join vendors v on v.id = p.vendor_id
      where b.deleted_at is null and b.status in ('on_shelf', 'discounted', 'return_notified')) x));
end $$;

-- Không xóa / hạ quyền được quản trị viên cuối cùng của cửa hàng.
create or replace function guard_last_admin() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (select 1 from members where store_id = old.store_id and role = 'admin' and user_id <> old.user_id) then
    raise exception 'Cửa hàng phải còn ít nhất một quản trị viên';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists members_last_admin on members;
create trigger members_last_admin before update or delete on members for each row execute function guard_last_admin();

-- M8: mã AX luôn viết hoa, không khoảng trắng.
update products set ax_code = upper(trim(ax_code)) where ax_code <> upper(trim(ax_code));

-- T3: tìm theo tên nhanh với 16 nghìn sản phẩm.
create extension if not exists pg_trgm with schema extensions;
create index if not exists products_name_trgm on products using gin (name_search extensions.gin_trgm_ops);

-- T5
alter function touch_updated_at() set search_path = public;

-- Hàm của trigger không cần gọi qua API.
revoke execute on function guard_last_admin() from public, anon, authenticated;
revoke execute on function guard_soft_delete() from public, anon, authenticated;
revoke execute on function rls_auto_enable() from public, anon, authenticated;

-- M2: cộng dồn số lượng ngay trên máy chủ (hai người cùng cộng không mất phần của nhau). Chạy với quyền người gọi (RLS).
create or replace function add_qty(p_id uuid, p_n int) returns table(qty int, updated_at timestamptz)
language sql security invoker set search_path = public as $$
  update batches set qty = batches.qty + p_n where id = p_id and deleted_at is null and p_n > 0
  returning batches.qty, batches.updated_at;
$$;
revoke execute on function add_qty(uuid, int) from public, anon;
grant execute on function add_qty(uuid, int) to authenticated;
