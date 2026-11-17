-- Mỗi tài khoản chỉ thuộc một cửa hàng: quản trị cửa hàng khác không kéo được tài khoản đang ở cửa hàng này.
create or replace function add_member(p_store uuid, p_email text, p_name text, p_role member_role default 'staff')
returns text language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not is_admin(p_store) then raise exception 'Chỉ quản trị viên được thêm thành viên'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
  if u is null then return 'chua_dang_ky'; end if;
  if exists (select 1 from members where user_id = u and store_id = p_store) then return 'da_co'; end if;
  if exists (select 1 from members where user_id = u) then return 'cua_hang_khac'; end if;
  insert into members(user_id, store_id, name, email, role, can_write, can_delete)
  values (u, p_store, coalesce(nullif(trim(p_name), ''), split_part(trim(p_email), '@', 1)), lower(trim(p_email)), p_role, p_role <> 'viewer', false);
  return 'ok';
end $$;
