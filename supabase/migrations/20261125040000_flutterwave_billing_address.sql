alter table public.profiles
  add column if not exists billing_address_line1 text,
  add column if not exists billing_city text,
  add column if not exists billing_state text,
  add column if not exists billing_postal_code text,
  add column if not exists billing_country text not null default 'NG';

alter table public.profiles
  drop constraint if exists profiles_billing_country_iso2_check;

alter table public.profiles
  add constraint profiles_billing_country_iso2_check
  check (billing_country ~ '^[A-Z]{2}$');

alter table public.profiles
  drop constraint if exists profiles_billing_postal_code_length_check;

alter table public.profiles
  add constraint profiles_billing_postal_code_length_check
  check (billing_postal_code is null or char_length(billing_postal_code) between 2 and 20);
