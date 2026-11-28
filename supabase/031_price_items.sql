-- Tra giá cả cửa hàng (trừ hàng tươi): bảng riêng, không lẫn vào danh mục quầy Dry (products).
-- Nguồn: file Master Data of Product (giá bán Hà Nội). Nhập lại file thì ghi đè, món không còn trong file thì xóa.
create table if not exists price_items (
  store_id uuid not null references stores(id),
  ax_code text not null,
  name text not null,
  name_vi text,
  name_search text not null default '',
  price numeric not null,
  unit text,
  category text,
  codes text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (store_id, ax_code)
);
create index if not exists price_items_codes on price_items using gin (codes);
create index if not exists price_items_name on price_items using gin (name_search extensions.gin_trgm_ops);
alter table price_items enable row level security;
drop policy if exists price_items_read on price_items;
create policy price_items_read on price_items for select using (is_member(store_id));
drop policy if exists price_items_write on price_items;
create policy price_items_write on price_items for all using (is_admin(store_id)) with check (is_admin(store_id));
grant select, insert, update, delete on price_items to authenticated;
revoke all on price_items from anon;
