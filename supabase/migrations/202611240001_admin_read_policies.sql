-- Allow authenticated administrators to read operational records through the normal Supabase session.
-- Writes remain governed by existing policies and server-side workflows.
do $$
declare t text;
begin
  foreach t in array array['profiles','wallets','wallet_transactions','payment_transactions','orders','provider_orders','messages','refunds','notifications','audit_logs','providers','provider_products','smscode_service_catalogue','smscode_product_tiers']
  loop
    execute format('drop policy if exists %I on public.%I', 'admins_read_all_'||t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role in (''admin'',''super_admin'')))',
      'admins_read_all_'||t, t
    );
  end loop;
end $$;
