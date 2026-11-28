create or replace function public.settle_flutterwave_payment(
  p_tx_ref text,
  p_gateway_transaction_id text,
  p_verified_amount_kobo bigint,
  p_currency text,
  p_gateway_status text,
  p_raw_event jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payment public.payment_transactions;
  v_wallet_tx public.wallet_transactions;
  v_order public.orders;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if p_gateway_status <> 'successful' or p_currency <> 'NGN'
     or p_verified_amount_kobo is null or p_verified_amount_kobo <= 0 then
    raise exception 'Payment verification details are invalid';
  end if;

  select * into v_payment
  from public.payment_transactions
  where gateway='flutterwave' and gateway_reference=p_tx_ref
  for update;

  if not found then raise exception 'Payment reference not found'; end if;
  if v_payment.status='successful' then
    return jsonb_build_object('status','already_settled','purpose',v_payment.purpose);
  end if;
  if v_payment.currency <> p_currency or p_verified_amount_kobo <> v_payment.amount_kobo then
    raise exception 'Verified amount or currency does not exactly match expected payment';
  end if;

  update public.payment_transactions
  set status='successful',
      gateway_transaction_id=p_gateway_transaction_id,
      verified_at=now(),
      verified_amount_kobo=p_verified_amount_kobo,
      raw_event=coalesce(p_raw_event,'{}'::jsonb),
      updated_at=now()
  where id=v_payment.id;

  if v_payment.purpose='wallet_funding' then
    -- Assign the composite return value directly. SELECT ... INTO expands
    -- composite-returning functions into columns and can cause UUID cast errors.
    v_wallet_tx := public.wallet_credit(
      v_payment.user_id,
      v_payment.amount_kobo,
      'flw:' || v_payment.gateway_reference,
      'deposit',
      'Flutterwave wallet funding',
      jsonb_build_object(
        'payment_transaction_id',v_payment.id,
        'gateway_transaction_id',p_gateway_transaction_id
      )
    );
    return jsonb_build_object(
      'status','settled',
      'purpose','wallet_funding',
      'wallet_transaction_id',v_wallet_tx.id
    );
  elsif v_payment.purpose='order_payment' then
    select * into v_order from public.orders where id=v_payment.order_id for update;
    if not found or v_order.user_id <> v_payment.user_id then
      raise exception 'Associated order not found for payment owner';
    end if;
    if v_order.retail_amount_kobo <> v_payment.amount_kobo then
      raise exception 'Order amount changed after checkout initialization';
    end if;
    update public.orders set status='paid',updated_at=now()
    where id=v_order.id and status='pending_payment';
    return jsonb_build_object(
      'status','settled',
      'purpose','order_payment',
      'order_id',v_order.id,
      'order_status','paid'
    );
  end if;
  raise exception 'Unsupported payment purpose';
end;
$function$;
