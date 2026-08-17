-- =====================================================================
-- MOne — VERIFY.sql
-- Run this after EVERY migration. Two pastes, about thirty seconds.
-- Nothing here changes anything; it only reads.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PASTE 1 — counts
-- ---------------------------------------------------------------------
select 'tables'            as check_name,
       count(*)::text      as found,
       '15'                as expected_after_003
  from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE'
union all
select 'functions', count(*)::text, '5'
  from information_schema.routines
 where routine_schema = 'public' and routine_type = 'FUNCTION'
union all
select 'views', count(*)::text, '1'
  from information_schema.views
 where table_schema = 'public'
union all
select 'clinics', count(*)::text, '38' from clinics
union all
select 'cam_seed_map', count(*)::text, '36' from cam_seed_map
union all
select 'financial_classes', count(*)::text, '5' from financial_classes
union all
select 'profiles (your login)', count(*)::text, '1 or more' from profiles;

-- Every row should match. If a count is short, the migration that creates
-- those objects did not fully apply -- tell me which row is wrong.


-- ---------------------------------------------------------------------
-- PASTE 2 — row-level security coverage
-- ---------------------------------------------------------------------
-- This is the one that matters. A table with RLS switched off, or with
-- no policies, is a table anyone signed in can read in full.
-- Worst offenders sort to the top.

select c.relname            as table_name,
       c.relrowsecurity     as rls_enabled,
       count(p.polname)     as policy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy p on p.polrelid = c.oid
 where n.nspname = 'public'
   and c.relkind = 'r'
 group by c.relname, c.relrowsecurity
 order by c.relrowsecurity asc, count(p.polname) asc, c.relname;

-- PASS  = every row shows rls_enabled = true and policy_count >= 1.
-- FAIL  = any row with rls_enabled = false, or policy_count = 0.
