-- Sửa theo đánh giá lần 4.
-- 1. Cộng dồn chỉ vào lô còn trên kệ: lô người khác vừa bán hết / hủy / báo trả thì từ chối, app báo để lưu lô mới.
create or replace function add_qty(p_id uuid, p_n int, p_op uuid default null) returns table(qty int, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if p_op is not null and exists (select 1 from applied_ops where op = p_op) then    -- đã cộng lần trước: trả số hiện tại
    return query select b.qty, b.updated_at from batches b where b.id = p_id and can_write(b.store_id);
    return;
  end if;
  perform 1 from batches where id = p_id and can_write(store_id) and deleted_at is null and status = 'on_shelf';
  if not found or p_n is null or p_n <= 0 then return; end if;
  if p_op is not null then insert into applied_ops(op) values (p_op) on conflict do nothing; end if;
  return query update batches set qty = batches.qty + p_n where id = p_id
    returning batches.qty, batches.updated_at;
end $$;
revoke execute on function add_qty(uuid, int, uuid) from public, anon;
grant execute on function add_qty(uuid, int, uuid) to authenticated;

-- 2. Biển tên: +/− cộng trừ trên máy chủ (hai máy cùng bấm không mất phần nhau).
create or replace function label_bump(p_id uuid, p_n int) returns labels
language sql security invoker set search_path = public as $$
  update labels set qty = greatest(1, least(999, qty + p_n)) where id = p_id returning *;
$$;
revoke execute on function label_bump(uuid, int) from public, anon;
grant execute on function label_bump(uuid, int) to authenticated;
