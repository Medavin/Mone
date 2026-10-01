-- =====================================================================
-- MBOne — Migration 034: allowed and paid on CPT lines
-- Run after 033. ONE block.
-- =====================================================================
--
-- AdvancedMD's Service Details sheet gives units and charges only. Prompt's
-- Revenue by CPT Code report also gives what was ALLOWED and what was
-- actually PAID for each code — which answers Michelle's open question on
-- the add-on card ("charges or payments?"): show both. Nullable, because
-- the AdvancedMD packs do not carry them; NULL means "not reported", not 0.

alter table service_monthly add column if not exists allowed numeric(14,2);
alter table service_monthly add column if not exists paid    numeric(14,2);

-- CHECK — expect 2 rows:
-- select column_name from information_schema.columns
--  where table_name = 'service_monthly' and column_name in ('allowed','paid');
