-- =====================================================================
-- MOne — Migration 012: per-clinic-per-month roll-up views
-- Run after 011. Clear the SQL Editor completely before pasting.
-- =====================================================================
--
-- WHY
-- Every fact table is grained clinic x month x FINANCIAL CLASS, so one
-- clinic with a decade of history is already 1,214 rows in
-- activity_monthly alone. The dashboard was reading those rows raw and
-- summing them in JavaScript, which means:
--
--   * it pulls twelve times more data than it needs, and
--   * Supabase caps a REST response at a fixed number of rows (1,000 by
--     default, in Project Settings -> API -> Max rows). Past that the
--     query does NOT error. It silently returns a truncated set, and the
--     months that fall off the end read as zero rather than as missing.
--
-- These views do the summing in Postgres, cutting the row count by 12x,
-- and the dashboard now also asks only for the months it is showing.
--
-- security_invoker = on is REQUIRED on both. A view has no policies of
-- its own and by default runs as its creator, so without this line these
-- would read straight past the RLS on the underlying tables and hand a
-- CAM every clinic's figures. Same lesson as migration 004.
-- =====================================================================

create or replace view activity_clinic_month as
select clinic_id,
       period_month,
       sum(units)        as units,
       sum(charges)      as charges,
       sum(payments)     as payments,
       sum(adjustments)  as adjustments,
       sum(visits)       as visits,
       sum(new_patients) as new_patients
  from activity_monthly
 group by clinic_id, period_month;

alter view activity_clinic_month set (security_invoker = on);


create or replace view ar_clinic_month as
select clinic_id,
       period_month,
       sum(closing_ar)      as closing_ar,
       sum(opening_ar)      as opening_ar,
       sum(bucket_120_plus) as bucket_120_plus
  from ar_monthly
 group by clinic_id, period_month;

alter view ar_clinic_month set (security_invoker = on);


-- The month picker needs the list of months that have figures at all.
-- Distinct months is at most a few hundred rows no matter how many
-- clinics are loaded, where clinic x month would be tens of thousands.

create or replace view activity_month_list as
select distinct period_month from activity_monthly;

alter view activity_month_list set (security_invoker = on);


create or replace view ar_month_list as
select distinct period_month from ar_monthly;

alter view ar_month_list set (security_invoker = on);


-- ---------------------------------------------------------------------
-- VERIFY — run separately
-- ---------------------------------------------------------------------
-- select c.relname as view_name, c.reloptions as options
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relkind = 'v'
--  order by c.relname;
--
-- Expect FIVE views, and every one of them carrying
-- {security_invoker=on}:
--   activity_clinic_month
--   activity_month_list
--   ar_clinic_month
--   ar_month_list
--   ar_monthly_clinic_total
--
-- Then, to see the roll-up agreeing with the raw table for one month:
--
-- select v.clinic_id, v.charges as view_charges, r.charges as raw_charges
--   from activity_clinic_month v
--   join (select clinic_id, period_month, sum(charges) as charges
--           from activity_monthly group by 1,2) r
--     on r.clinic_id = v.clinic_id and r.period_month = v.period_month
--  where v.period_month = date '2021-07-01';
