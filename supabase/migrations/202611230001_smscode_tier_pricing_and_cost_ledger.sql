-- SMSCode-only supplier configuration and tier-level NGN retail pricing.
-- All supplier controls and financial records are server-side only.
create table if not exists public.smscode_service_catalogue (
 id uuid primary key default gen_random_uuid(), service_key text not null unique, display_name text not null,
 sms_code_service_code text, supported boolean not null default false, active boolean not null default false,
 last_verified_at timestamptz, verification_note text, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), constraint smscode_service_catalogue_key_chk check (service_key ~ '^[a-z0-9_]+$')
);
create table if not exists public.smscode_product_tiers (
 id uuid primary key default gen_random_uuid(), service_id uuid not null references public.smscode_service_catalogue(id) on delete cascade,
 tier_key text not null, tier_label text not null, country_iso2 char(2) not null default 'NG',
 smscode_product_id text, smscode_catalog_product_id text,
 max_supplier_price_usd numeric(12,4) not null check (max_supplier_price_usd >= 0),
 retail_price_kobo bigint not null check (retail_price_kobo >= 0), active boolean not null default false,
 last_supplier_price_usd numeric(12,4), last_supplier_price_idr bigint, last_supplier_fx_rate numeric(18,8),
 last_inventory_count integer, last_verified_at timestamptz, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), unique(service_id,tier_key,country_iso2)
);
create table if not exists public.supplier_cost_ledger (
 id uuid primary key default gen_random_uuid(), order_id uuid references public.orders(id) on delete set null,
 provider_order_id uuid references public.provider_orders(id) on delete set null,
 supplier_code text not null default 'smscode', supplier_product_id text, supplier_currency char(3) not null,
 supplier_amount_minor bigint not null, supplier_amount_usd numeric(14,6), supplier_amount_ngn_kobo bigint,
 fx_rate_usd_to_idr numeric(18,8), fx_rate_usd_to_ngn numeric(18,8), customer_revenue_ngn_kobo bigint,
 payment_fee_ngn_kobo bigint not null default 0, supplier_fee_minor bigint not null default 0,
 gross_profit_ngn_kobo bigint, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
alter table public.smscode_service_catalogue enable row level security;
alter table public.smscode_product_tiers enable row level security;
alter table public.supplier_cost_ledger enable row level security;
revoke all on public.smscode_service_catalogue from anon, authenticated;
revoke all on public.smscode_product_tiers from anon, authenticated;
revoke all on public.supplier_cost_ledger from anon, authenticated;
insert into public.providers (code,display_name,status,supports_sms,supports_voice,supports_rentals,supports_webhooks,documentation_url)
values ('smscode','SMSCode','draft',true,false,false,true,'https://smscode.gg/docs')
on conflict (code) do update set display_name=excluded.display_name,supports_sms=true,supports_webhooks=true,documentation_url=excluded.documentation_url,updated_at=now();
insert into public.smscode_service_catalogue (service_key,display_name,sms_code_service_code,supported,active,verification_note) values
('whatsapp','WhatsApp','whatsapp',false,false,'Awaiting SMSCode catalogue verification'),
('telegram','Telegram','telegram',false,false,'Awaiting SMSCode catalogue verification'),
('facebook','Facebook','facebook',false,false,'Awaiting SMSCode catalogue verification'),
('google','Google','google',false,false,'Awaiting SMSCode catalogue verification'),
('signal','Signal','signal',false,false,'Awaiting SMSCode catalogue verification'),
('textfree','TextFree','textfree',false,false,'Awaiting SMSCode catalogue verification'),
('google_voice','Google Voice','google_voice',false,false,'Awaiting SMSCode catalogue verification')
on conflict (service_key) do update set display_name=excluded.display_name,updated_at=now();
