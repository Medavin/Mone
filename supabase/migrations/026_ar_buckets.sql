-- =====================================================================
-- MBOne — Migration 026: the rest of the aging buckets
-- Run after 025. One paste.
-- =====================================================================
--
-- Michelle asked to watch money moving out of Current into 30, because a
-- claim slipping out of Current is an early warning weeks before it
-- becomes a denial.
--
-- `ar_clinic_month` only summed closing A/R and the 120+ bucket, since
-- that was all the dashboard needed. The other buckets were always in
-- `ar_monthly`; they simply were not rolled up. This adds them.
--
-- ⚠ `security_invoker = on` has to be set again. `create or replace view`
-- keeps the definition but a fresh view does not inherit it, and without
-- it this view reads straight past the row level security on ar_monthly —
-- the migration-004 bug, which has already cost this project once.
--
-- ⚠ AND A LIMIT WORTH STATING: the monthly packs give a month-end
-- snapshot, so this shows movement MONTH to MONTH. Michelle asked for
-- daily. Chris has since confirmed a WEEKLY cadence is achievable over
-- ODBC, so weekly is what this becomes once the feed exists — the
-- arithmetic below does not change, only how often the rows arrive.
-- =====================================================================

create or replace view ar_clinic_month as
select clinic_id,
       period_month,
       sum(closing_ar)      as closing_ar,
       sum(opening_ar)      as opening_ar,
       sum(bucket_current)  as bucket_current,
       sum(bucket_30)       as bucket_30,
       sum(bucket_60)       as bucket_60,
       sum(bucket_90)       as bucket_90,
       sum(bucket_120_plus) as bucket_120_plus
  from ar_monthly
 group by clinic_id, period_month;

alter view ar_clinic_month set (security_invoker = on);


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select column_name from information_schema.columns
--  where table_name = 'ar_clinic_month' order by ordinal_position;
--   -> 9 columns, including bucket_current and bucket_30.
--
-- select c.relname, c.reloptions from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relname = 'ar_clinic_month';
--   -> reloptions must show {security_invoker=on}.
