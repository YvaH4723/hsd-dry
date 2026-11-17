-- Thông báo hằng ngày (7:00 và 15:00). Máy nào bấm "Bật thông báo" thì lưu đăng ký vào push_subs.
-- GitHub Actions gọi push_export bằng mã bí mật để lấy lô + đăng ký, tự tính việc cần làm rồi gửi.
create table if not exists push_subs (
  endpoint text primary key,
  store_id uuid not null references stores(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table push_subs enable row level security;
drop policy if exists push_own on push_subs;
create policy push_own on push_subs for all using (user_id = auth.uid()) with check (user_id = auth.uid() and is_member(store_id));

-- Bảng bí mật: bật RLS, không có policy nào => app không đọc được.
create table if not exists push_secret (token text not null, vapid_private text not null);
alter table push_secret enable row level security;
delete from push_secret;
insert into push_secret select '__TOKEN__', '__PRIV__' where left('__TOKEN__', 2) <> '__';   -- quên thay mã thì không ghi gì

create or replace function push_export(p_token text) returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from push_secret where token = p_token) then raise exception 'denied'; end if;
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
create or replace function push_remove(p_token text, p_endpoint text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from push_secret where token = p_token) then raise exception 'denied'; end if;
  delete from push_subs where endpoint = p_endpoint;
end $$;
revoke all on function push_export(text) from public;
revoke all on function push_remove(text, text) from public;
grant execute on function push_export(text) to anon, authenticated;
grant execute on function push_remove(text, text) to anon, authenticated;
