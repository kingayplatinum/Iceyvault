select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname;
select schemaname,tablename,policyname,roles,cmd from pg_policies where schemaname='public' order by tablename,policyname;
