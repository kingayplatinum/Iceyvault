-- Keep supplier catalogue writes server-side only. The admin API uses the
-- service_role key after verifying the signed-in administrator.
grant select, insert, update, delete on table public.smscode_service_catalogue to service_role;
grant select, insert, update, delete on table public.smscode_product_tiers to service_role;
grant insert on table public.audit_logs to service_role;

-- Persist the human-readable country name alongside the ISO-2 code so the
-- admin product selector can offer country dropdowns without hardcoding them.
alter table public.smscode_product_tiers
  add column if not exists country_name text;
