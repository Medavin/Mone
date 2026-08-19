-- =====================================================================
-- MOne — Migration 006: carrier A/R at carrier level
-- Run after 005. Clear the SQL Editor completely before pasting.
-- =====================================================================
--
-- WHY THIS CHANGES
-- carrier_ar_monthly was specified as clinic x month x carrier x provider.
-- Reading the real report, two things became clear:
--
-- 1. The provider breakdown is not worth holding. Underneath each provider
--    the sheet descends into chart number, visit ID and CPT — patient-level
--    detail. Stopping at carrier level keeps the useful answer ("which payers
--    owe us, and how old is it") well clear of anything identifiable.
--
-- 2. A nullable provider_id inside a UNIQUE constraint is a trap. Postgres
--    treats NULLs as distinct, so every re-import would insert a duplicate
--    row instead of replacing the old one, and the totals would silently
--    double.
--
-- The table is empty, so this is a clean change.
-- =====================================================================

alter table carrier_ar_monthly drop constraint if exists
  carrier_ar_monthly_clinic_id_period_month_carrier_id_provider_key;

alter table carrier_ar_monthly drop column if exists provider_id;

-- One row per carrier per clinic per month. Re-importing replaces.
alter table carrier_ar_monthly
  add constraint carrier_ar_monthly_unique
  unique (clinic_id, period_month, carrier_id);

-- ---------------------------------------------------------------------
-- Carriers are identified by code. Where the report leaves the code blank
-- (the "NOT BILLED YET" bucket), the importer uses the name as the code,
-- so every carrier has a stable key.
-- ---------------------------------------------------------------------
alter table carriers alter column code set not null;

alter table carriers drop constraint if exists carriers_code_name_key;

create unique index if not exists carriers_code_unique on carriers (code);

-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select column_name from information_schema.columns
--   where table_name = 'carrier_ar_monthly' order by column_name;
--   expect NO provider_id
--
-- select conname from pg_constraint
--   where conrelid = 'carrier_ar_monthly'::regclass and contype = 'u';
--   expect carrier_ar_monthly_unique
