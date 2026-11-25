-- Prevent duplicate wallet top-ups when clients retry the same initiation request.
create unique index if not exists payment_transactions_user_idempotency_unique
  on public.payment_transactions(user_id,idempotency_key)
  where idempotency_key is not null;
