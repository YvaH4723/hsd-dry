-- Chia quầy thành khu (Bánh kẹo, Mỹ phẩm…). Kệ thuộc một khu; nhân viên phụ trách một hoặc nhiều khu.
-- Chỉ dùng để LỌC danh sách (Hôm nay, Hết hạn), không chặn quyền: ai cũng xem được "Tất cả khu".
create table if not exists zones (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  deleted_at timestamptz
);
alter table zones enable row level security;
drop policy if exists zones_read on zones;
create policy zones_read on zones for select using (is_member(store_id));
drop policy if exists zones_admin on zones;
create policy zones_admin on zones for all using (is_admin(store_id)) with check (is_admin(store_id));
alter table shelves add column if not exists zone_id uuid references zones(id);
alter table members add column if not exists zones uuid[] not null default '{}';
