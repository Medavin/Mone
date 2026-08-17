-- =====================================================================
-- MOne — Migration 004: make the clinic-total view respect RLS
-- Run after 003. Clear the SQL Editor completely before pasting.
-- =====================================================================
--
-- THE PROBLEM
-- A Postgres view has no policies of its own. By default it executes with
-- the permissions of the role that CREATED it, not the role querying it.
-- So ar_monthly_clinic_total was reading past the RLS on ar_monthly: a CAM
-- who is only allowed to see their own clinics could query the view and
-- get every clinic's AR. Supabase flags exactly this as UNRESTRICTED in
-- the Table Editor.
--
-- THE FIX
-- security_invoker = on makes the view run as the person querying it, so
-- ar_monthly's own policies apply. One line, no data change.
--
-- WORTH REMEMBERING: this applies to EVERY view added from here on.
-- Locking down a table does not lock down a view built on top of it.
-- =====================================================================

alter view ar_monthly_clinic_total set (security_invoker = on);


-- ---------------------------------------------------------------------
-- VERIFY — run separately
-- ---------------------------------------------------------------------
-- select c.relname          as view_name,
--        c.reloptions       as options
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public'
--    and c.relkind = 'v';
--
-- Expect ar_monthly_clinic_total with options {security_invoker=on}.
--
-- Then reload the Table Editor. The red UNRESTRICTED badge should be gone.
