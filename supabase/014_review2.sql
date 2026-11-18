-- Khôi phục dòng đã xóa cũng cần quyền xóa (trước đây chỉ chặn chiều xóa).
create or replace function guard_soft_delete() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is distinct from old.deleted_at and not can_delete(old.store_id) then
    raise exception 'Không có quyền xóa / khôi phục';
  end if;
  return new;
end $$;

-- Cộng dồn gửi lại khi rớt mạng (máy chủ đã cộng nhưng điện thoại không nhận được trả lời): mỗi thao tác chỉ cộng một lần.
create table if not exists applied_ops (op uuid primary key, at timestamptz not null default now());
alter table applied_ops enable row level security;
revoke all on applied_ops from anon, authenticated;

-- Ghi dấu thao tác (chạy quyền chủ để nhân viên không cần quyền trên bảng applied_ops). Trả false nếu đã có.
create or replace function claim_op(p_op uuid) returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into applied_ops(op) values (p_op) on conflict do nothing;
  return found;
end $$;
revoke execute on function claim_op(uuid) from public, anon;
grant execute on function claim_op(uuid) to authenticated;

drop function if exists add_qty(uuid, int);
create or replace function add_qty(p_id uuid, p_n int, p_op uuid default null) returns table(qty int, updated_at timestamptz)
language plpgsql security invoker set search_path = public as $$
begin
  if p_op is not null then
    perform 1 from batches where id = p_id and can_write(store_id);     -- không có quyền thì không ghi dấu
    if not found then return; end if;
    if not claim_op(p_op) then                                                  -- đã cộng lần trước: trả số hiện tại
      return query select b.qty, b.updated_at from batches b where b.id = p_id;
      return;
    end if;
  end if;
  return query update batches set qty = batches.qty + p_n where id = p_id and deleted_at is null and p_n > 0
    returning batches.qty, batches.updated_at;
end $$;
revoke execute on function add_qty(uuid, int, uuid) from public, anon;
grant execute on function add_qty(uuid, int, uuid) to authenticated;
