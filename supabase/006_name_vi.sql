-- Tên tiếng Việt cho sản phẩm. Tìm kiếm theo cả tên Việt và tên gốc (không dấu). Nhập Cadencia không ghi đè name_vi.
alter table products add column if not exists name_vi text;
create extension if not exists unaccent;
create or replace function products_search() returns trigger language plpgsql set search_path = public, extensions as $$
begin new.name_search := lower(unaccent(coalesce(new.name_vi, '') || ' ' || new.name)); return new; end $$;
drop trigger if exists products_search on products;
create trigger products_search before insert or update on products for each row execute function products_search();
