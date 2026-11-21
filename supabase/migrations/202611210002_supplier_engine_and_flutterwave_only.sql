begin;

-- IceyVault accepts Flutterwave only for wallet funding.
alter table public.payment_transactions drop constraint if exists payment_transactions_gateway_check;
alter table public.payment_transactions add constraint payment_transactions_gateway_flutterwave_check check (gateway = 'flutterwave');
alter table public.provider_integrations drop constraint if exists provider_integrations_provider_check;
alter table public.provider_integrations add constraint provider_integrations_flutterwave_only_check check (provider = 'flutterwave');
alter table public.payment_webhook_events drop constraint if exists payment_webhook_events_provider_check;
alter table public.payment_webhook_events add constraint payment_webhook_events_flutterwave_only_check check (provider = 'flutterwave');

-- Wallet debits must be initiated by trusted server-side order orchestration only.
-- Customers must never be able to invoke a debit RPC directly from the browser.
create or replace function public.wallet_debit(
  p_user_id uuid,
  p_amount_kobo bigint,
  p_reference text,
  p_transaction_type text default 'purchase',
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb
) returns public.wallet_transactions
language plpgsql security definer set search_path=''
as $$
declare
  v_wallet public.wallets;
  v_tx public.wallet_transactions;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if p_reference is null or length(trim(p_reference)) < 8 then raise exception 'A valid idempotency reference is required'; end if;
  if p_transaction_type not in ('purchase','adjustment','reversal') then raise exception 'Invalid debit transaction type'; end if;
  select * into v_wallet from public.wallets where user_id=p_user_id and currency='NGN' for update;
  if not found then raise exception 'Wallet not found'; end if;
  select * into v_tx from public.wallet_transactions where reference=p_reference;
  if found then
    if v_tx.user_id=p_user_id and v_tx.direction='debit' and v_tx.amount_kobo=p_amount_kobo then return v_tx; end if;
    raise exception 'Reference already used';
  end if;
  if v_wallet.balance_kobo < p_amount_kobo then raise exception 'Insufficient wallet balance' using errcode='P0001'; end if;
  update public.wallets set balance_kobo=balance_kobo-p_amount_kobo where id=v_wallet.id returning * into v_wallet;
  insert into public.wallet_transactions(wallet_id,user_id,direction,amount_kobo,balance_after_kobo,reference,transaction_type,description,metadata)
  values(v_wallet.id,p_user_id,'debit',p_amount_kobo,v_wallet.balance_kobo,p_reference,p_transaction_type,p_description,coalesce(p_metadata,'{}'::jsonb))
  returning * into v_tx;
  return v_tx;
end;
$$;
revoke all on function public.wallet_debit(uuid,bigint,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.wallet_debit(uuid,bigint,text,text,text,jsonb) to service_role;

-- Supplier sync history is operational data, not customer-readable data.
create table if not exists public.provider_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete restrict,
  sync_type text not null check (sync_type in ('catalogue','inventory','health_check')),
  status text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  products_seen integer not null default 0 check (products_seen >= 0),
  products_created integer not null default 0 check (products_created >= 0),
  products_updated integer not null default 0 check (products_updated >= 0),
  products_deactivated integer not null default 0 check (products_deactivated >= 0),
  error_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (completed_at is null or completed_at >= started_at)
);
create index if not exists provider_sync_runs_provider_date_idx
  on public.provider_sync_runs(provider_id, started_at desc);
alter table public.provider_sync_runs enable row level security;
revoke all on public.provider_sync_runs from anon, authenticated;
grant all on public.provider_sync_runs to service_role;

create index if not exists provider_products_verified_idx
  on public.provider_products(active, verified_at desc);
create index if not exists provider_products_available_lookup_idx
  on public.provider_products(country_iso2, service_code, offer_kind)
  where active = true and coalesce(inventory_count, 0) > 0;

commit;