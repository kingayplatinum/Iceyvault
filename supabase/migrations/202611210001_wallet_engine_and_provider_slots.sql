begin;
alter table public.wallets add column if not exists balance_kobo bigint not null default 0 check(balance_kobo>=0);
create table if not exists public.provider_integrations(
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider in ('paystack','flutterwave')),
 environment text not null default 'test' check(environment in ('test','live')),
 enabled boolean not null default false,
 public_key_secret_id uuid, secret_key_secret_id uuid, webhook_secret_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(provider,environment)
);
create table if not exists public.payment_webhook_events(
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider in ('paystack','flutterwave')),
 event_id text not null,event_type text not null,payload jsonb not null default '{}'::jsonb,
 processed_at timestamptz,processing_error text,received_at timestamptz not null default now(),
 unique(provider,event_id)
);
alter table public.provider_integrations enable row level security;
alter table public.payment_webhook_events enable row level security;
revoke all on public.provider_integrations,public.payment_webhook_events from anon,authenticated;
grant all on public.provider_integrations,public.payment_webhook_events to service_role;
create or replace function public.wallet_debit(p_user_id uuid,p_amount_kobo bigint,p_reference text,p_transaction_type text default 'purchase',p_description text default null,p_metadata jsonb default '{}'::jsonb)
returns public.wallet_transactions language plpgsql security definer set search_path='' as $$
declare v_wallet public.wallets; v_tx public.wallet_transactions;
begin
 if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_amount_kobo is null or p_amount_kobo<=0 then raise exception 'Amount must be greater than zero'; end if;
 if p_reference is null or length(trim(p_reference))<8 then raise exception 'A valid idempotency reference is required'; end if;
 if p_transaction_type not in ('purchase','adjustment','reversal') then raise exception 'Invalid debit transaction type'; end if;
 select * into v_wallet from public.wallets where user_id=p_user_id and currency='NGN' for update;
 if not found then raise exception 'Wallet not found'; end if;
 select * into v_tx from public.wallet_transactions where reference=p_reference;
 if found then if v_tx.user_id=p_user_id and v_tx.direction='debit' and v_tx.amount_kobo=p_amount_kobo then return v_tx; end if; raise exception 'Reference already used'; end if;
 if v_wallet.balance_kobo<p_amount_kobo then raise exception 'Insufficient wallet balance' using errcode='P0001'; end if;
 update public.wallets set balance_kobo=balance_kobo-p_amount_kobo where id=v_wallet.id returning * into v_wallet;
 insert into public.wallet_transactions(wallet_id,user_id,direction,amount_kobo,balance_after_kobo,reference,transaction_type,description,metadata)
 values(v_wallet.id,p_user_id,'debit',p_amount_kobo,v_wallet.balance_kobo,p_reference,p_transaction_type,p_description,coalesce(p_metadata,'{}'::jsonb)) returning * into v_tx;
 return v_tx;
end $$;
create or replace function public.wallet_credit(p_user_id uuid,p_amount_kobo bigint,p_reference text,p_transaction_type text default 'deposit',p_description text default null,p_metadata jsonb default '{}'::jsonb)
returns public.wallet_transactions language plpgsql security definer set search_path='' as $$
declare v_wallet public.wallets; v_tx public.wallet_transactions;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_amount_kobo is null or p_amount_kobo<=0 then raise exception 'Amount must be greater than zero'; end if;
 if p_reference is null or length(trim(p_reference))<8 then raise exception 'A valid idempotency reference is required'; end if;
 if p_transaction_type not in ('deposit','refund','adjustment','reversal') then raise exception 'Invalid credit transaction type'; end if;
 select * into v_wallet from public.wallets where user_id=p_user_id and currency='NGN' for update;
 if not found then raise exception 'Wallet not found'; end if;
 select * into v_tx from public.wallet_transactions where reference=p_reference;
 if found then if v_tx.user_id=p_user_id and v_tx.direction='credit' and v_tx.amount_kobo=p_amount_kobo then return v_tx; end if; raise exception 'Reference already used'; end if;
 update public.wallets set balance_kobo=balance_kobo+p_amount_kobo where id=v_wallet.id returning * into v_wallet;
 insert into public.wallet_transactions(wallet_id,user_id,direction,amount_kobo,balance_after_kobo,reference,transaction_type,description,metadata)
 values(v_wallet.id,p_user_id,'credit',p_amount_kobo,v_wallet.balance_kobo,p_reference,p_transaction_type,p_description,coalesce(p_metadata,'{}'::jsonb)) returning * into v_tx;
 return v_tx;
end $$;
revoke all on function public.wallet_debit(uuid,bigint,text,text,text,jsonb) from public,anon;
revoke all on function public.wallet_credit(uuid,bigint,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.wallet_debit(uuid,bigint,text,text,text,jsonb) to authenticated,service_role;
grant execute on function public.wallet_credit(uuid,bigint,text,text,text,jsonb) to service_role;
commit;
