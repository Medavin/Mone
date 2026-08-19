-- =====================================================================
-- MOne — Migration 007: the rest of the referral figures
-- Run after 006. Clear the SQL Editor completely before pasting.
-- =====================================================================
--
-- The referring-provider sheet carries year-to-date visits and year-to-date
-- charges as well as the month figures. Charges per referrer is the number
-- that says which relationships are actually worth anything, so it is worth
-- storing rather than recomputing.

alter table referrals_monthly add column if not exists visits_ytd integer;
alter table referrals_monthly add column if not exists ytd_charges numeric(14,2);

-- Referring providers are keyed on name + zip. A NULL zip would defeat that,
-- because Postgres treats NULLs as distinct and the same provider would be
-- inserted again on every import. Blank rather than NULL keeps the key solid.
update referring_providers set zip = '' where zip is null;
alter table referring_providers alter column zip set default '';
alter table referring_providers alter column zip set not null;

-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select column_name from information_schema.columns
--   where table_name = 'referrals_monthly' order by column_name;
--   expect visits_ytd and ytd_charges present
