-- Lịch sử tồn kho theo ngày (giờ VN), để ước lượng hàng bán chạy: tồn giảm giữa 2 lần nhập ≈ đã bán.
create table if not exists stock_history (
  store_id uuid not null references stores(id),
  product_id uuid not null references products(id),
  day date not null,
  qty numeric not null,
  primary key (product_id, day)
);
create index if not exists stock_history_store_day_ix on stock_history (store_id, day);
alter table stock_history enable row level security;
drop policy if exists stock_history_sel on stock_history;
create policy stock_history_sel on stock_history for select using (is_member(store_id));
drop policy if exists stock_history_ins on stock_history;
create policy stock_history_ins on stock_history for insert with check (is_admin(store_id));
drop policy if exists stock_history_upd on stock_history;
create policy stock_history_upd on stock_history for update using (is_admin(store_id)) with check (is_admin(store_id));

-- Ghi tồn cũng ghi lịch sử của ngày hôm nay (nhập lại trong ngày thì đè).
create or replace function set_stock(p_store uuid, p_rows jsonb) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  update products p set stock_qty = (x->>'q')::numeric, stock_at = now()
  from jsonb_array_elements(p_rows) x
  where p.store_id = p_store and p.ax_code = x->>'ax' and p.deleted_at is null;
  get diagnostics n = row_count;
  insert into stock_history (store_id, product_id, day, qty)
  select p_store, p.id, (now() at time zone 'Asia/Ho_Chi_Minh')::date, (x->>'q')::numeric
  from products p join jsonb_array_elements(p_rows) x on p.ax_code = x->>'ax'
  where p.store_id = p_store and p.deleted_at is null
  on conflict (product_id, day) do update set qty = excluded.qty;
  return n;
end $$;

-- Hàng không còn trong file = hết hàng: ghi 0 vào lịch sử.
create or replace function clear_stock(p_store uuid, p_before timestamptz) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  insert into stock_history (store_id, product_id, day, qty)
  select p_store, id, (now() at time zone 'Asia/Ho_Chi_Minh')::date, 0
  from products where store_id = p_store and stock_at < p_before and deleted_at is null
  on conflict (product_id, day) do update set qty = 0;
  with u as (update products set stock_qty = null, stock_at = null
             where store_id = p_store and stock_at < p_before and deleted_at is null returning 1)
  select count(*)::int into n from u;
  return n;
end $$;

-- Lấy số tồn đang có làm mốc đầu tiên.
insert into stock_history (store_id, product_id, day, qty)
select store_id, id, (stock_at at time zone 'Asia/Ho_Chi_Minh')::date, stock_qty
from products where stock_qty is not null and stock_at is not null and deleted_at is null
on conflict do nothing;
