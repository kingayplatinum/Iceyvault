begin;

-- Customers may acknowledge a notification, but cannot rewrite its contents.
revoke update on table public.notifications from anon, authenticated;
grant update (read_at) on table public.notifications to authenticated;

-- Expose only customer-safe catalogue fields through the public Supabase API.
-- Supplier wholesale pricing and raw provider metadata remain server-side.
revoke select on table public.provider_products from anon, authenticated;
grant select (
  id,
  country_iso2,
  country_name,
  service_code,
  service_name,
  channel,
  offer_kind,
  number_class,
  term_minutes,
  currency,
  retail_amount_kobo,
  inventory_count,
  verified_at,
  active
) on table public.provider_products to anon, authenticated;

commit;