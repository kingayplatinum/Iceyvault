begin;

create table if not exists public.sizzle_services (
  id uuid primary key default gen_random_uuid(),
  external_service_id text not null unique,
  name text not null,
  category text not null default 'Other',
  service_type text not null default 'default',
  product_kind text not null default 'social' check (product_kind in ('social','digital_account')),
  fulfilment_mode text not null default 'supplier_email' check (fulfilment_mode in ('supplier_email','manual_review')),
  rate_per_1000_ngn numeric(16,4) not null check (rate_per_1000_ngn >= 0),
  retail_rate_per_1000_kobo bigint not null default 0 check (retail_rate_per_1000_kobo >= 0),
  min_quantity integer not null default 1 check (min_quantity > 0),
  max_quantity integer not null default 1 check (max_quantity >= min_quantity),
  description text,
  dripfeed_supported boolean not null default false,
  refill_supported boolean not null default false,
  active boolean not null default false,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sizzle_services_active_idx on public.sizzle_services(active,category,name);
alter table public.sizzle_services enable row level security;
revoke all on public.sizzle_services from anon, authenticated;

create table if not exists public.sizzle_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  service_id uuid not null references public.sizzle_services(id) on delete restrict,
  external_service_id text not null,
  provider_order_ref text unique,
  product_kind text not null check (product_kind in ('social','digital_account')),
  status text not null default 'provisioning',
  target_link text,
  destination_email text,
  comments text,
  quantity integer not null check (quantity > 0),
  runs integer,
  interval_minutes integer,
  retail_amount_kobo bigint not null check (retail_amount_kobo > 0),
  supplier_rate_per_1000_ngn numeric(16,4) not null,
  estimated_supplier_cost_ngn numeric(16,4) not null,
  supplier_charge_ngn numeric(16,4),
  start_count bigint,
  remains bigint,
  refill_supported boolean not null default false,
  refill_id text,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,idempotency_key)
);
create index if not exists sizzle_orders_owner_date_idx on public.sizzle_orders(user_id,created_at desc);
create index if not exists sizzle_orders_status_idx on public.sizzle_orders(status,created_at desc);
alter table public.sizzle_orders enable row level security;
revoke all on public.sizzle_orders from anon, authenticated;

create table if not exists public.sizzle_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  sizzle_order_id uuid not null unique references public.sizzle_orders(id) on delete restrict,
  supplier_order_ref text not null,
  supplier_cost_ngn numeric(16,4) not null,
  customer_revenue_ngn_kobo bigint not null,
  gross_profit_ngn_kobo bigint,
  created_at timestamptz not null default now()
);
alter table public.sizzle_cost_ledger enable row level security;
revoke all on public.sizzle_cost_ledger from anon, authenticated;

create or replace function public.reserve_sizzle_order(
  p_user_id uuid,
  p_service_id uuid,
  p_idempotency_key text,
  p_quantity integer,
  p_target_link text,
  p_destination_email text,
  p_comments text default null,
  p_runs integer default null,
  p_interval_minutes integer default null
) returns table(
  order_id uuid,
  retail_amount_kobo bigint,
  external_service_id text,
  product_kind text,
  service_type text,
  rate_per_1000_ngn numeric,
  estimated_supplier_cost_ngn numeric,
  refill_supported boolean,
  is_new boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.sizzle_services%rowtype;
  v_existing public.sizzle_orders%rowtype;
  v_retail bigint;
  v_estimated numeric(16,4);
begin
  if coalesce(current_setting('request.jwt.claim.role', true),'') <> 'service_role' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 or length(p_idempotency_key) > 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'INVALID_QUANTITY'; end if;

  select * into v_existing from public.sizzle_orders
    where user_id = p_user_id and idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.service_id <> p_service_id or v_existing.quantity <> p_quantity or v_existing.target_link is distinct from nullif(p_target_link,'') or v_existing.destination_email is distinct from nullif(p_destination_email,'') or v_existing.comments is distinct from nullif(p_comments,'') then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    select v_existing.id,v_existing.retail_amount_kobo,v_existing.external_service_id,
      v_existing.product_kind,s.service_type,v_existing.supplier_rate_per_1000_ngn,
      v_existing.estimated_supplier_cost_ngn,v_existing.refill_supported,false
    into order_id,retail_amount_kobo,external_service_id,product_kind,service_type,
      rate_per_1000_ngn,estimated_supplier_cost_ngn,refill_supported,is_new
    from public.sizzle_services s where s.id = v_existing.service_id;
    return next; return;
  end if;

  select * into v_service from public.sizzle_services where id = p_service_id for update;
  if not found or not v_service.active then raise exception 'SERVICE_NOT_AVAILABLE'; end if;
  if v_service.last_synced_at is null or v_service.last_synced_at < now() - interval '24 hours' then raise exception 'SERVICE_CATALOGUE_STALE'; end if;
  if p_quantity < v_service.min_quantity or p_quantity > v_service.max_quantity then raise exception 'QUANTITY_OUT_OF_RANGE'; end if;
  if v_service.retail_rate_per_1000_kobo <= 0 then raise exception 'SERVICE_NOT_PRICED'; end if;
  if v_service.product_kind = 'digital_account' and coalesce(p_destination_email,'') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'DESTINATION_EMAIL_REQUIRED'; end if;
  if v_service.product_kind = 'social' and coalesce(p_target_link,'') !~* '^https?://' then raise exception 'TARGET_LINK_REQUIRED'; end if;
  if v_service.service_type = 'custom_comments' and coalesce(length(trim(p_comments)),0) = 0 then raise exception 'COMMENTS_REQUIRED'; end if;
  if v_service.service_type = 'custom_comments' and (
    select count(*) from regexp_split_to_table(coalesce(p_comments,''), E'\\r?\\n') as comment_line
    where length(trim(comment_line)) > 0
  ) <> p_quantity then raise exception 'COMMENT_QUANTITY_MISMATCH'; end if;
  if p_runs is not null and (not v_service.dripfeed_supported or p_runs < 1 or p_runs > 1000 or p_interval_minutes not in (0,5,10,15,30,60,90)) then raise exception 'INVALID_DRIPFEED'; end if;

  v_retail := greatest(1,ceil(v_service.retail_rate_per_1000_kobo::numeric * p_quantity / 1000)::bigint);
  v_estimated := v_service.rate_per_1000_ngn * p_quantity / 1000;

  insert into public.sizzle_orders(
    user_id,service_id,external_service_id,product_kind,status,target_link,destination_email,
    comments,quantity,runs,interval_minutes,retail_amount_kobo,supplier_rate_per_1000_ngn,
    estimated_supplier_cost_ngn,refill_supported,idempotency_key
  ) values (
    p_user_id,p_service_id,v_service.external_service_id,v_service.product_kind,'provisioning',
    nullif(p_target_link,''),nullif(p_destination_email,''),nullif(p_comments,''),p_quantity,
    p_runs,p_interval_minutes,v_retail,v_service.rate_per_1000_ngn,v_estimated,
    v_service.refill_supported,p_idempotency_key
  ) returning id into order_id;

  perform public.wallet_debit(
    p_user_id,v_retail,'sizzle-order:' || order_id::text,'purchase',
    case when v_service.product_kind='digital_account' then 'Sizzle digital account purchase' else 'Sizzle social media service' end,
    jsonb_build_object('sizzle_order_id',order_id,'service_id',v_service.id,'external_service_id',v_service.external_service_id)
  );

  retail_amount_kobo := v_retail;
  external_service_id := v_service.external_service_id;
  product_kind := v_service.product_kind;
  service_type := v_service.service_type;
  rate_per_1000_ngn := v_service.rate_per_1000_ngn;
  estimated_supplier_cost_ngn := v_estimated;
  refill_supported := v_service.refill_supported;
  is_new := true;
  return next;
end;
$$;

create or replace function public.refund_failed_sizzle_order(p_order_id uuid,p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.sizzle_orders%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true),'') <> 'service_role' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_order from public.sizzle_orders where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status='refunded' then return false; end if;
  if v_order.status not in ('provisioning','failed','error','rejected') then raise exception 'ORDER_NOT_REFUNDABLE'; end if;
  perform public.wallet_credit(
    v_order.user_id,v_order.retail_amount_kobo,'sizzle-refund:' || v_order.id::text,
    'refund','Refund for unsuccessful Sizzle Social order',
    jsonb_build_object('sizzle_order_id',v_order.id,'reason',left(coalesce(p_reason,'Supplier fulfilment failed'),500))
  );
  update public.sizzle_orders set status='refunded',updated_at=now() where id=v_order.id;
  return true;
end;
$$;

revoke all on function public.reserve_sizzle_order(uuid,uuid,text,integer,text,text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.refund_failed_sizzle_order(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_sizzle_order(uuid,uuid,text,integer,text,text,text,integer,integer) to service_role;
grant execute on function public.refund_failed_sizzle_order(uuid,text) to service_role;

commit;
