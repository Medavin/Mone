-- =====================================================================
-- MOne — Migration 013: repair the `collectors` table
-- Run after 012. Clear the SQL Editor completely before pasting.
-- APPLIED AND VERIFIED 19 Aug 2026.
-- =====================================================================
--
-- WHY THIS EXISTS
-- An earlier abandoned scaffold (supabase/migrations/20260818120000_*.sql,
-- since moved out of the app but already applied to the database) created
-- its own `collectors` table:
--
--     (id, name NOT NULL, email, phone, is_active)
--
-- Migration 008 then declared:
--
--     (id, code NOT NULL UNIQUE, display_name, is_active)
--
-- but it used `create table if not exists`, so it found a table already
-- there and did NOTHING. No error. The mismatch stayed invisible until the
-- collection-action import tried to write `code` to a table without one.
--
-- ⚠ THE GENERAL TRAP, worth remembering: `create table if not exists`
-- checks the NAME, not the SHAPE. A table with the wrong columns silently
-- survives the migration and fails much later, somewhere unrelated.
-- After any migration that might touch an existing table, check
-- information_schema.columns rather than trusting that it "ran fine".
--
-- WHAT THIS DOES
-- Brings the existing table up to what 008 expects, without dropping it:
--   * adds `code` and `display_name`
--   * backfills `code` from whatever `name` already holds
--   * DROPS NOT NULL ON `name` -- the importer only ever supplies `code`
--     and `display_name`, so leaving it required would reject every insert
--   * makes `code` NOT NULL and unique, which is what the importer upserts on
--
-- `name`, `email` and `phone` are left in place rather than dropped. An
-- unused column costs nothing, and dropping one fails if anything still
-- references it.
-- =====================================================================

alter table public.collectors add column if not exists code text;
alter table public.collectors add column if not exists display_name text;

update public.collectors set code = upper(trim(name)) where code is null;
update public.collectors set display_name = name where display_name is null;

alter table public.collectors alter column name drop not null;
alter table public.collectors alter column code set not null;

create unique index if not exists collectors_code_key on public.collectors (code);


-- ---------------------------------------------------------------------
-- VERIFY — run separately
-- ---------------------------------------------------------------------
-- select column_name, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'collectors'
--  order by ordinal_position;
--
-- Expect `code` = NO and `name` = YES.
-- Confirmed 19 Aug 2026: id NO, name YES, email YES, phone YES,
-- is_active NO, code NO, display_name YES.
