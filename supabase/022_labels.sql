-- Danh sách in biển tên (kiểu máy PDA): quét sản phẩm cần in, cả nhóm cùng thấy, xuất Excel cho phần mềm in.
create table if not exists labels (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  qty int not null default 1 check (qty between 1 and 999),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, product_id)
);
alter table labels enable row level security;
create policy labels_read on labels for select using (is_member(store_id));
create policy labels_ins on labels for insert with check (can_write(store_id));
create policy labels_upd on labels for update using (can_write(store_id)) with check (can_write(store_id));
create policy labels_del on labels for delete using (can_write(store_id));
create trigger labels_touch before update on labels for each row execute function touch_updated_at();

-- Quét thêm: chưa có thì thêm 1 biển, đã có thì cộng 1. Chạy theo quyền người gọi (RLS).
create or replace function label_add(p_store uuid, p_product uuid) returns labels
language sql security invoker set search_path = public as $$
  insert into labels (store_id, product_id) values (p_store, p_product)
  on conflict (store_id, product_id) do update set qty = least(labels.qty + 1, 999)
  returning *;
$$;
revoke execute on function label_add(uuid, uuid) from public, anon;
grant execute on function label_add(uuid, uuid) to authenticated;
