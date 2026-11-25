alter table public.smscode_product_tiers
  add column if not exists smscode_operator_id bigint;
