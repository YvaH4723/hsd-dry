-- Hiện ai thêm lô, ai sửa gần nhất: "Lan thêm 18/11 · Hùng sửa 19/11".
-- created_by đã có (mặc định người gửi). Thêm created_at và updated_by (trigger tự ghi người sửa).
alter table batches add column if not exists created_at timestamptz not null default now();
alter table batches add column if not exists updated_by uuid references auth.users(id);

-- Lô cũ: ngày thêm lấy theo nhật ký (không đụng updated_at nên tắt trigger tự cập nhật lúc điền).
alter table batches disable trigger batches_touch;
update batches b set created_at = coalesce((select min(a.at) from audit_log a where a.batch_id = b.id), b.updated_at);
alter table batches enable trigger batches_touch;

create or replace function batches_stamp_by() returns trigger language plpgsql set search_path = public as $$
begin new.updated_by := coalesce(auth.uid(), new.updated_by); return new; end $$;
drop trigger if exists batches_by on batches;
create trigger batches_by before update on batches for each row execute function batches_stamp_by();
revoke execute on function batches_stamp_by() from public, anon, authenticated;
