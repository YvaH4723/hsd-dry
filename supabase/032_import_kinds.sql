-- Lịch sử nhập: thêm loại master_vi (tên Việt) và master_price (bảng giá) từ file Master Data.
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'import_runs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%';
  if c is not null then execute format('alter table import_runs drop constraint %I', c); end if;
end $$;
alter table import_runs add constraint import_runs_kind_check check (kind in ('cadencia', 'contact_list', 'stock', 'master_vi', 'master_price'));
