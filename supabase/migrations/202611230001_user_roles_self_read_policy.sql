-- Allow a signed-in user to read only their own role assignment.
-- This enables workspace routing without exposing other users' role records.
begin;
grant select on table public.user_roles to authenticated;
drop policy if exists "Users can read their own role" on public.user_roles;
create policy "Users can read their own role"
on public.user_roles
for select
to authenticated
using (user_id = (select auth.uid()));
revoke insert, update, delete on table public.user_roles from anon, authenticated;
commit;
