-- HSD Dry: cấu trúc dữ liệu Supabase (Postgres). Chạy toàn bộ file trong SQL Editor, một lần.
-- Quy ước: mọi bảng có updated_at (tự cập nhật) và deleted_at (xóa mềm) để các máy đồng bộ.

create extension if not exists pgcrypto;

-- ===== Kiểu và hàm dùng chung =====
create type member_role as enum ('admin', 'staff', 'viewer');
create type term_action as enum ('return', 'discount');          -- báo trả NCC / dán giảm giá
create type batch_status as enum ('on_shelf', 'discounted', 'return_notified', 'returned', 'discarded', 'sold_out');

create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ===== Cửa hàng và thành viên =====
create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  discount_days int not null default 45,        -- mốc dán giảm giá, sửa được trong app
  created_at timestamptz not null default now()
);

create table members (
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  email text not null,                          -- chỉ lưu tên, email, vai trò (xem phần rủi ro trong kế hoạch)
  role member_role not null default 'staff',
  can_write boolean not null default true,
  can_delete boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);

-- Hàm kiểm quyền cho RLS (security definer để tránh vòng lặp khi đọc bảng members)
create function is_member(s uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where store_id = s and user_id = auth.uid()) $$;
create function is_admin(s uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where store_id = s and user_id = auth.uid() and role = 'admin') $$;
create function can_write(s uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where store_id = s and user_id = auth.uid()
                 and role <> 'viewer' and (role = 'admin' or can_write)) $$;
create function can_delete(s uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where store_id = s and user_id = auth.uid()
                 and (role = 'admin' or (role <> 'viewer' and can_delete))) $$;

-- ===== NCC và điều khoản =====
create table vendors (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  code text not null,                           -- đã bỏ khoảng trắng: AFF01
  name text not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (store_id, code)
);

-- Điều khoản 3 cấp, cấp dưới đè cấp trên: NCC -> nhãn hàng -> sản phẩm.
-- brand null + product_id null = cấp NCC; brand có = cấp nhãn; product_id có = cấp sản phẩm.
create table terms (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  vendor_id uuid not null references vendors(id) on delete cascade,
  brand text,
  product_id uuid,                              -- khóa ngoại thêm sau khi có bảng products
  action term_action not null,
  days int,                                     -- null = chưa chọn cách tính (câu gốc dạng "65% remaining"...)
  raw_text text,                                -- câu gốc trong file, luôn hiện cho người dùng
  needs_review boolean not null default false,  -- vào danh sách "Cần xem"
  source text not null default 'file' check (source in ('file', 'manual')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index terms_level_uq on terms (store_id, vendor_id, coalesce(brand, ''), coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where deleted_at is null;

-- ===== Sản phẩm và mã vạch =====
create table products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  ax_code text,                                 -- không giả định chữ cái đầu (có F..., hàng nước có B...)
  name text not null,
  name_search text not null default '',         -- tên không dấu, app tự tính để gõ "bot mi" ra "Bột mì"
  brand text,
  vendor_id uuid references vendors(id),
  price numeric(14,2),
  dept_group text check (dept_group in ('sweet', 'salty')),
  category text,
  photo_path text,                              -- đường dẫn trong Supabase Storage
  active boolean not null default true,         -- không còn trong file Cadencia thì ẩn, không xóa
  no_return boolean not null default false,     -- đánh dấu mặt hàng không đổi trả
  sanh_dieu boolean not null default false,     -- hàng Sành Điệu (tích tay hoặc theo danh sách mã AX)
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index products_ax_uq on products (store_id, ax_code) where ax_code is not null and deleted_at is null;
create index products_vendor_ix on products (store_id, vendor_id);

alter table terms add constraint terms_product_fk foreign key (product_id) references products(id) on delete cascade;

create table barcodes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  code text not null,                           -- mã 12 số lưu thêm bản có số 0 đầu thành dòng riêng
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index barcodes_code_uq on barcodes (store_id, code) where deleted_at is null;
-- Quy tắc "sản phẩm có ít nhất AX Code hoặc một mã vạch" kiểm trong app lúc nhập.

-- ===== Kệ, lô, nhật ký =====
create table shelves (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  qr_code text not null default encode(gen_random_bytes(6), 'hex'),
  sort_order int not null default 0,            -- thứ tự đi kiểm kệ
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (store_id, qr_code)
);

create table batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id),
  shelf_id uuid references shelves(id),
  qty int not null default 1 check (qty >= 0),
  expiry_date date not null,                    -- nhập HSD, hoặc NSX + hạn dùng thì app tính ra đây
  mfg_date date,
  shelf_life_days int,
  status batch_status not null default 'on_shelf',   -- lô quá HSD chỉ gắn cờ đỏ, không tự trừ tồn
  last_checked_at timestamptz,
  last_checked_by uuid references auth.users(id),
  created_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index batches_expiry_ix on batches (store_id, expiry_date) where deleted_at is null;
create index batches_product_ix on batches (product_id);

create table audit_log (
  id bigint generated always as identity primary key,
  store_id uuid not null references stores(id) on delete cascade,
  user_id uuid references auth.users(id) default auth.uid(),
  batch_id uuid,
  action text not null,                         -- add / edit / delete / status ...
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create table import_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  user_id uuid references auth.users(id) default auth.uid(),
  kind text not null check (kind in ('cadencia', 'contact_list')),
  column_map jsonb,                             -- app nhớ cách ghép cột cho lần sau
  added int not null default 0,
  updated int not null default 0,
  unchanged int not null default 0,
  errors int not null default 0,
  hidden int not null default 0,
  at timestamptz not null default now()
);

-- ===== Tự cập nhật updated_at =====
do $$ declare t text; begin
  foreach t in array array['vendors','terms','products','barcodes','shelves','batches'] loop
    execute format('create trigger %I before update on %I for each row execute function touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- Xóa mềm lô cần quyền Xóa
create function guard_soft_delete() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null and not can_delete(new.store_id) then
    raise exception 'Không có quyền xóa';
  end if;
  return new;
end $$;
create trigger batches_guard before update on batches for each row execute function guard_soft_delete();

-- ===== Phân quyền theo dòng (RLS) =====
alter table stores enable row level security;
alter table members enable row level security;
alter table audit_log enable row level security;
alter table import_runs enable row level security;

create policy stores_read on stores for select using (is_member(id));
create policy stores_admin on stores for update using (is_admin(id)) with check (is_admin(id));

create policy members_read on members for select using (is_member(store_id));
create policy members_admin on members for all using (is_admin(store_id)) with check (is_admin(store_id));

create policy audit_read on audit_log for select using (is_member(store_id));
create policy audit_insert on audit_log for insert with check (can_write(store_id) and user_id = auth.uid());

create policy import_read on import_runs for select using (is_member(store_id));
create policy import_insert on import_runs for insert with check (is_admin(store_id));

-- Các bảng dữ liệu: thành viên đọc; người có quyền Ghi thêm/sửa. Danh mục NCC, điều khoản, sản phẩm,
-- mã vạch do admin nhập Excel; nhân viên được gắn mã vạch và sửa ảnh/tích cờ (xem ghi chú dưới).
do $$ declare t text; begin
  foreach t in array array['vendors','terms','products','barcodes','shelves','batches'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (is_member(store_id))', t || '_read', t);
    execute format('create policy %I on %I for insert with check (can_write(store_id))', t || '_ins', t);
    execute format('create policy %I on %I for update using (can_write(store_id)) with check (can_write(store_id))', t || '_upd', t);
  end loop;
end $$;
-- Không có policy DELETE: không ai xóa cứng được, chỉ xóa mềm bằng deleted_at.
-- ponytail: nhân viên có quyền Ghi sửa được cả sản phẩm/điều khoản. Siết lại (chỉ admin) nếu cần.

-- ===== Tạo cửa hàng và quản trị viên đầu tiên =====
-- Sau khi đăng ký tài khoản của bạn trong app (hoặc Authentication > Users), chạy riêng đoạn này, thay EMAIL:
--   with s as (insert into stores(name) values ('An Nam Gourmet HN Central (Tiến Bộ Plaza)') returning id)
--   insert into members(user_id, store_id, name, email, role, can_write, can_delete)
--   select u.id, s.id, 'YvaH', u.email, 'admin', true, true from s, auth.users u where u.email = 'EMAIL';
