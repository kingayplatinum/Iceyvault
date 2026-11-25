-- Atomic IceyVault wallet settlement and SMSCode fulfilment.
-- Reuses the live wallet_credit/wallet_debit and settle_flutterwave_payment routines.

alter table public.orders
  add column if not exists fulfilled_at timestamptz,
  add column if not exists smscode_tier_id uuid references public.smscode_product_tiers(id) on delete restrict;

alter table public.payment_transactions
  add column if not exists idempotency_key text,
  add column if not exists checkout_url text;

alter table public.provider_orders
  add column if not exists supplier_product_id text,
  add column if not exists supplier_cost_usd numeric(14,6),
  add column if not exists supplier_cost_idr bigint,
  add column if not exists supplier_fx_rate numeric(18,8);

create unique index if not exists payment_transactions_user_idempotency_unique
  on public.payment_transactions(user_id,idempotency_key)
  where idempotency_key is not null;

create or replace function public.reserve_smscode_order(
  p_user_id uuid,
  p_tier_id uuid,
  p_idempotency_key text
) returns table(
  order_id uuid,
  retail_amount_kobo bigint,
  supplier_cap_usd numeric,
  supplier_product_id text,
  catalog_product_id text,
  service_code text,
  wallet_balance_kobo bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier public.smscode_product_tiers%rowtype;
  v_service public.smscode_service_catalogue%rowtype;
  v_existing public.orders%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 or length(p_idempotency_key) > 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select * into v_existing
  from public.orders o
  where o.user_id = p_user_id and o.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.status in ('refunded','failed','cancelled','expired','completed') then raise exception 'ORDER_ALREADY_TERMINAL'; end if;
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
  if v_tier.smscode_product_id is null or v_tier.smscode_catalog_product_id is null then raise exception 'SUPPLIER_PRODUCT_NOT_MAPPED'; end if;
  if v_tier.last_verified_at is null or v_tier.last_verified_at < now() - interval '10 minutes' then raise exception 'SUPPLIER_PRODUCT_STALE'; end if;
  if coalesce(v_tier.last_inventory_count,0) < 1 then raise exception 'OUT_OF_STOCK'; end if;
  if v_tier.last_supplier_price_usd is null or v_tier.last_supplier_price_usd > v_tier.max_supplier_price_usd then raise exception 'SUPPLIER_PRICE_CAP_EXCEEDED'; end if;
  if v_tier.retail_price_kobo <= 0 then raise exception 'INVALID_RETAIL_PRICE'; end if;

  insert into public.orders(user_id,offer_kind,status,retail_amount_kobo,currency,idempotency_key,smscode_tier_id)
  values (p_user_id,'sms_activation','provisioning',v_tier.retail_price_kobo,'NGN',p_idempotency_key,v_tier.id)
  returning id into order_id;

  perform public.wallet_debit(
    p_user_id,
    v_tier.retail_price_kobo,
    'smscode-order:' || order_id::text,
    'purchase',
    'SMSCode number purchase',
    jsonb_build_object('order_id',order_id,'tier_id',v_tier.id)
  );

  select w.balance_kobo into wallet_balance_kobo from public.wallets w where w.user_id = p_user_id;
  retail_amount_kobo := v_tier.retail_price_kobo;
  supplier_cap_usd := v_tier.max_supplier_price_usd;
  supplier_product_id := v_tier.smscode_product_id;
  catalog_product_id := v_tier.smscode_catalog_product_id;
  service_code := v_service.sms_code_service_code;
  return next;
end;
$$;

create or replace function public.refund_failed_smscode_order(p_order_id uuid,p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.orders%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'refunded' then return false; end if;
  if v_order.status not in ('provisioning','paid','active','waiting_message','failed','review_required') then raise exception 'ORDER_NOT_REFUNDABLE'; end if;

  perform public.wallet_credit(
    v_order.user_id,
    v_order.retail_amount_kobo,
    'smscode-refund:' || v_order.id::text,
    'refund',
    'Refund for unsuccessful SMSCode fulfilment',
    jsonb_build_object('order_id',v_order.id,'reason',left(coalesce(p_reason,'Supplier fulfilment failed'),500))
  );
  update public.orders set status = 'refunded', updated_at = now() where id = v_order.id;
  return true;
end;
$$;

revoke all on function public.reserve_smscode_order(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.refund_failed_smscode_order(uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_smscode_order(uuid,uuid,text) to service_role;
grant execute on function public.refund_failed_smscode_order(uuid,text) to service_role;
