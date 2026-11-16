-- Người đã Đăng ký nhưng chưa thuộc cửa hàng nào: quản trị viên thấy trong Thành viên → Chờ duyệt.
create or replace function pending_users(p_store uuid) returns table(email text, name text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_store) then raise exception 'Chỉ quản trị viên'; end if;
  return query select u.email::text, coalesce(u.raw_user_meta_data->>'name', '')::text, u.created_at from auth.users u
    where u.email is not null and not exists (select 1 from members m where m.user_id = u.id) order by u.created_at desc;
end $$;
revoke all on function pending_users(uuid) from public, anon;
grant execute on function pending_users(uuid) to authenticated;
