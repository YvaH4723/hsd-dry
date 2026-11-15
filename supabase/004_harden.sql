-- Sau kiểm tra độc lập: (1) xóa mềm ở mọi bảng đều cần quyền Xóa; (2) NCC, điều khoản, sản phẩm chỉ quản trị viên sửa;
-- (3) tên không dấu cho sản phẩm tạo từ ExpiryDay để tìm được.
do $$ declare t text; begin
  foreach t in array array['vendors','terms','products','barcodes','shelves'] loop
    execute format('drop trigger if exists %I on %I', t || '_guard', t);
    execute format('create trigger %I before update on %I for each row execute function guard_soft_delete()', t || '_guard', t);
  end loop;
  foreach t in array array['vendors','terms','products'] loop
    execute format('drop policy if exists %I on %I', t || '_ins', t);
    execute format('drop policy if exists %I on %I', t || '_upd', t);
    execute format('create policy %I on %I for insert with check (is_admin(store_id))', t || '_ins', t);
    execute format('create policy %I on %I for update using (is_admin(store_id)) with check (is_admin(store_id))', t || '_upd', t);
  end loop;
end $$;
create extension if not exists unaccent;
update products set name_search = lower(unaccent(name)) where category = 'Từ ExpiryDay';
