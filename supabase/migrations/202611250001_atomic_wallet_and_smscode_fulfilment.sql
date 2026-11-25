-- IceyVault: atomic wallet funding and SMSCode order accounting.
-- Apply to the IceyVault Supabase project before enabling the new API routes.

alter table public.wallets
  add column if not exists balance_kobo bigint not null default 0
  check (balance_kobo >= 0);

alter table public.orders
  add column if not exists idempotency_key text,
  add column if not exists fulfilled_at timestamptz;

create unique index if not exists orders_user_idempotency_unique
  on public.orders(user_id, idempotency_key)
  where idempotency_key is not null;

alter table public.provider_orders
  add column if not exists supplier_product_id text,
  add column if not exists supplier_cost_usd numeric(14,6),
  add column if not exists supplier_cost_idr bigint,
  add column if not exists supplier_fx_rate numeric(18,8);

alter table public.payment_transactions
  add column if not exists checkout_url text,
  add column if not exists idempotency_key text;

create unique index if not exists payment_transactions_gateway_idempotency_unique
  on public.payment_transactions(gateway, gateway_reference);

-- A verified payment is credited exactly once under a row lock.
create or replace function private.credit_wallet_from_verified_payment(
  p_payment_id uuid,
  p_gateway_transaction_id text,
  p_verified_amount_kobo bigint,
  p_currency text,
  p_verified_payload jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payment_transactions%rowtype;
  v_balance bigint;
begin
  select * into v_payment
  from public.payment_transactions
  where id = p_payment_id
  for update;

  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_payment.gateway <> 'flutterwave' then raise exception 'INVALID_GATEWAY'; end if;
  if v_payment.currency <> 'NGN' or p_currency <> 'NGN' then raise exception 'CURRENCY_MISMATCH'; end if;
  if p_verified_amount_kobo <> v_payment.amount_kobo then raise exception 'AMOUNT_MISMATCH'; end if;

  if v_payment.status = 'successful' then return false; end if;
  if v_payment.status <> 'pending' then raise exception 'PAYMENT_NOT_PENDING'; end if;

  update public.wallets
  set balance_kobo = balance_kobo + v_payment.amount_kobo
  where id = v_payment.wallet_id and user_id = v_payment.user_id
  returning balance_kobo into v_balance;

  if not found then raise exception 'WALLET_NOT_FOUND'; end if;

  insert into public.wallet_transactions(
    wallet_id,user_id,direction,amount_kobo,balance_after_kobo,reference,
    transaction_type,description,metadata
  ) values (
    v_payment.wallet_id,v_payment.user_id,'credit',v_payment.amount_kobo,v_balance,
    'flutterwave:' || v_payment.gateway_reference,'deposit',
    'Flutterwave wallet funding',
    jsonb_build_object('payment_id',v_payment.id,'gateway_transaction_id',p_gateway_transaction_id)
  );

  update public.payment_transactions
  set status = 'successful',
      gateway_transaction_id = p_gateway_transaction_id,
      verified_at = now(),
      raw_event = coalesce(p_verified_payload,'{}'::jsonb),
      updated_at = now()
  where id = v_payment.id;

  return true;
end;
$$;

-- Debit and create the local order in one database transaction before supplier fulfilment.
create or replace function private.reserve_smscode_order(
  p_user_id uuid,
  p_tier_id uuid,
  p_idempotency_key text
) returns table(order_id uuid, retail_amount_kobo bigint, supplier_cap_usd numeric, supplier_product_id text, catalog_product_id text, service_code text, wallet_balance_kobo bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier public.smscode_product_tiers%rowtype;
  v_service public.smscode_service_catalogue%rowtype;
  v_wallet public.wallets%rowtype;
  v_order_id uuid;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 16 or length(p_idempotency_key) > 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select o.id, o.retail_amount_kobo into v_order_id, retail_amount_kobo
  from public.orders o
  where o.user_id = p_user_id and o.idempotency_key = p_idempotency_key;
  if found then
    select t.max_supplier_price_usd, t.smscode_product_id, t.smscode_catalog_product_id,
           s.sms_code_service_code, w.balance_kobo
      into supplier_cap_usd, supplier_product_id, catalog_product_id, service_code, wallet_balance_kobo
    from public.smscode_product_tiers t
    join public.smscode_service_catalogue s on s.id = t.service_id
    join public.wallets w on w.user_id = p_user_id
    where t.id = p_tier_id;
    order_id := v_order_id;
    return next;
    return;
  end if;

  select * into v_tier
  from public.smscode_product_tiers
  where id = p_tier_id
  for update;
  if not found or not v_tier.active then raise exception 'TIER_NOT_AVAILABLE'; end if;

  select * into v_service
  from public.smscode_service_catalogue
  where id = v_tier.service_id;
  if not found or not v_service.active or not v_service.supported then raise exception 'SERVICE_NOT_AVAILABLE'; end if;
  if v_tier.smscode_product_id is null then raise exception 'SUPPLIER_PRODUCT_NOT_MAPPED'; end if;
  if v_tier.last_verified_at is null or v_tier.last_verified_at < now() - interval '10 minutes' then raise exception 'SUPPLIER_PRODUCT_STALE'; end if;
  if coalesce(v_tier.last_inventory_count,0) < 1 then raise exception 'OUT_OF_STOCK'; end if;
  if v_tier.last_supplier_price_usd is null or v_tier.last_supplier_price_usd > v_tier.max_supplier_price_usd then raise exception 'SUPPLIER_PRICE_CAP_EXCEEDED'; end if;
  if v_tier.retail_price_kobo <= 0 then raise exception 'INVALID_RETAIL_PRICE'; end if;

  select * into v_wallet from public.wallets where user_id = p_user_id for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_wallet.balance_kobo < v_tier.retail_price_kobo then raise exception 'INSUFFICIENT_WALLET_BALANCE'; end if;

  insert into public.orders(user_id,offer_kind,status,retail_amount_kobo,currency,idempotency_key)
  values (p_user_id,'sms_activation','provisioning',v_tier.retail_price_kobo,'NGN',p_idempotency_key)
  returning id into v_order_id;

  update public.wallets set balance_kobo = balance_kobo - v_tier.retail_price_kobo
  where id = v_wallet.id
  returning balance_kobo into wallet_balance_kobo;

  insert into public.wallet_transactions(
    wallet_id,user_id,direction,amount_kobo,balance_after_kobo,reference,
    transaction_type,description,metadata
  ) values (
    v_wallet.id,p_user_id,'debit',v_tier.retail_price_kobo,wallet_balance_kobo,
    'smscode-order:' || v_order_id,'purchase','SMSCode number purchase',
    jsonb_build_object('order_id',v_order_id,'tier_id',v_tier.id)
  );

  order_id := v_order_id;
  retail_amount_kobo := v_tier.retail_price_kobo;
  supplier_cap_usd := v_tier.max_supplier_price_usd;
  supplier_product_id := v_tier.smscode_product_id;
  catalog_product_id := v_tier.smscode_catalog_product_id;
  service_code := v_service.sms_code_service_code;
  return next;
end;
$$;

-- Refund only an order that has not already been refunded.
create or replace function private.refund_failed_smscode_order(
  p_order_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_wallet_id uuid;
  v_balance bigint;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'refunded' then return false; end if;
  if v_order.status not in ('provisioning','paid','failed') then raise exception 'ORDER_NOT_REFUNDABLE'; end if;

  select id into v_wallet_id from public.wallets where user_id = v_order.user_id for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;

  update public.wallets set balance_kobo = balance_kobo + v_order.retail_amount_kobo
  where id = v_wallet_id returning balance_kobo into v_balance;

  insert into public.wallet_transactions(
    wallet_id,user_id,direction,amount_kobo,balance_after_kobo,reference,
    transaction_type,description,metadata
  ) values (
    v_wallet_id,v_order.user_id,'credit',v_order.retail_amount_kobo,v_balance,
    'smscode-refund:' || v_order.id,'refund','Refund for unsuccessful SMSCode fulfilment',
    jsonb_build_object('order_id',v_order.id,'reason',left(coalesce(p_reason,'Supplier fulfilment failed'),500))
  );

  update public.orders set status = 'refunded', updated_at = now() where id = v_order.id;
  return true;
end;
$$;

revoke all on function private.credit_wallet_from_verified_payment(uuid,text,bigint,text,jsonb) from public, anon, authenticated;
revoke all on function private.reserve_smscode_order(uuid,uuid,text) from public, anon, authenticated;
revoke all on function private.refund_failed_smscode_order(uuid,text) from public, anon, authenticated;
grant execute on function private.credit_wallet_from_verified_payment(uuid,text,bigint,text,jsonb) to service_role;
grant execute on function private.reserve_smscode_order(uuid,uuid,text) to service_role;
grant execute on function private.refund_failed_smscode_order(uuid,text) to service_role;


-- Bind an idempotent order to the exact tier requested.
alter table public.orders
  add column if not exists smscode_tier_id uuid references public.smscode_product_tiers(id) on delete restrict;

create or replace function private.reserve_smscode_order(
  p_user_id uuid,
  p_tier_id uuid,
  p_idempotency_key text
) returns table(order_id uuid, retail_amount_kobo bigint, supplier_cap_usd numeric, supplier_product_id text, catalog_product_id text, service_code text, wallet_balance_kobo bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier public.smscode_product_tiers%rowtype;
  v_service public.smscode_service_catalogue%rowtype;
  v_wallet public.wallets%rowtype;
  v_existing public.orders%rowtype;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 16 or length(p_idempotency_key) > 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select * into v_existing
  from public.orders o
  where o.user_id = p_user_id and o.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.smscode_tier_id is distinct from p_tier_id then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    select t.max_supplier_price_usd, t.smscode_product_id, t.smscode_catalog_product_id,
           s.sms_code_service_code, w.balance_kobo
      into supplier_cap_usd, supplier_product_id, catalog_product_id, service_code, wallet_balance_kobo
    from public.smscode_product_tiers t
    join public.smscode_service_catalogue s on s.id = t.service_id
    join public.wallets w on w.user_id = p_user_id
    where t.id = p_tier_id;
    order_id := v_existing.id;
    retail_amount_kobo := v_existing.retail_amount_kobo;
    return next;
    return;
  end if;

  select * into v_tier from public.smscode_product_tiers where id = p_tier_id for update;
  if not found or not v_tier.active then raise exception 'TIER_NOT_AVAILABLE'; end if;
  select * into v_service from public.smscode_service_catalogue where id = v_tier.service_id;
  if not found or not v_service.active or not v_service.supported then raise exception 'SERVICE_NOT_AVAILABLE'; end if;
  if v_tier.smscode_product_id is null then raise exception 'SUPPLIER_PRODUCT_NOT_MAPPED'; end if;
  if v_tier.last_verified_at is null or v_tier.last_verified_at < now() - interval '10 minutes' then raise exception 'SUPPLIER_PRODUCT_STALE'; end if;
  if coalesce(v_tier.last_inventory_count,0) < 1 then raise exception 'OUT_OF_STOCK'; end if;
  if v_tier.last_supplier_price_usd is null or v_tier.last_supplier_price_usd > v_tier.max_supplier_price_usd then raise exception 'SUPPLIER_PRICE_CAP_EXCEEDED'; end if;
  if v_tier.retail_price_kobo <= 0 then raise exception 'INVALID_RETAIL_PRICE'; end if;

  select * into v_wallet from public.wallets where user_id = p_user_id for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_wallet.balance_kobo < v_tier.retail_price_kobo then raise exception 'INSUFFICIENT_WALLET_BALANCE'; end if;

  insert into public.orders(user_id,offer_kind,status,retail_amount_kobo,currency,idempotency_key,smscode_tier_id)
  values (p_user_id,'sms_activation','provisioning',v_tier.retail_price_kobo,'NGN',p_idempotency_key,v_tier.id)
  returning id into order_id;

  update public.wallets set balance_kobo = balance_kobo - v_tier.retail_price_kobo
  where id = v_wallet.id returning balance_kobo into wallet_balance_kobo;

  insert into public.wallet_transactions(
    wallet_id,user_id,direction,amount_kobo,balance_after_kobo,reference,
    transaction_type,description,metadata
  ) values (
    v_wallet.id,p_user_id,'debit',v_tier.retail_price_kobo,wallet_balance_kobo,
    'smscode-order:' || order_id,'purchase','SMSCode number purchase',
    jsonb_build_object('order_id',order_id,'tier_id',v_tier.id)
  );

  retail_amount_kobo := v_tier.retail_price_kobo;
  supplier_cap_usd := v_tier.max_supplier_price_usd;
  supplier_product_id := v_tier.smscode_product_id;
  catalog_product_id := v_tier.smscode_catalog_product_id;
  service_code := v_service.sms_code_service_code;
  return next;
end;
$$;

revoke all on function private.reserve_smscode_order(uuid,uuid,text) from public, anon, authenticated;
grant execute on function private.reserve_smscode_order(uuid,uuid,text) to service_role;


-- Supplier cancellation/expiry may happen after a number has already been assigned.
create or replace function private.refund_failed_smscode_order(
  p_order_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_wallet_id uuid;
  v_balance bigint;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'refunded' then return false; end if;
  if v_order.status not in ('provisioning','paid','active','waiting_message','failed') then
    raise exception 'ORDER_NOT_REFUNDABLE';
  end if;

  select id into v_wallet_id from public.wallets where user_id = v_order.user_id for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;

  update public.wallets set balance_kobo = balance_kobo + v_order.retail_amount_kobo
  where id = v_wallet_id returning balance_kobo into v_balance;

  insert into public.wallet_transactions(
    wallet_id,user_id,direction,amount_kobo,balance_after_kobo,reference,
    transaction_type,description,metadata
  ) values (
    v_wallet_id,v_order.user_id,'credit',v_order.retail_amount_kobo,v_balance,
    'smscode-refund:' || v_order.id,'refund','Refund for unsuccessful SMSCode fulfilment',
    jsonb_build_object('order_id',v_order.id,'reason',left(coalesce(p_reason,'Supplier fulfilment failed'),500))
  );

  update public.orders set status = 'refunded', updated_at = now() where id = v_order.id;
  return true;
end;
$$;
revoke all on function private.refund_failed_smscode_order(uuid,text) from public, anon, authenticated;
grant execute on function private.refund_failed_smscode_order(uuid,text) to service_role;
