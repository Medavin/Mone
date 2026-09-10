-- =====================================================================
-- MBOne — Migration 028: the import engine's memory
-- Run after 027. Paste in TWO blocks.
-- =====================================================================
--
-- WHAT THIS IS FOR
-- The monthly AdvancedMD pack has its own parser, because it is a
-- multi-sheet workbook read by position and label. Everything else — a
-- denial export, a CRL list, a payment report, a payer list — is a flat
-- table with a header row, and those all want the same treatment:
--
--   read the headers → recognise the file → map its columns to ours →
--   show what will land → load it.
--
-- ⚠ THE POINT OF SAVING THE MAPPING is that the second file of the same
-- shape needs no work at all. A person maps "Denial Cd" to denial_code
-- once; every later export from the same report recognises itself and
-- loads. Without that, an import tool is just a slower version of typing.
--
-- ⚠ AND IT IS WHAT THE ODBC FEED WILL USE. A query result is a header row
-- and some rows — the same shape as a spreadsheet. Building this now means
-- the feed has somewhere to arrive rather than needing its own path.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 2 — the profiles
-- =====================================================================

create table if not exists import_profiles (
  id             bigserial primary key,

  name           text not null,
  target_table   text not null,          -- which of our tables it fills
  description    text,

  -- HOW A FILE IS RECOGNISED. Two signals, deliberately both weak on their
  -- own: a filename can be renamed, and headers can be reordered, so the
  -- detector scores them together rather than trusting either.
  filename_hint  text,                   -- matched case-insensitively as a substring
  header_signature text[],               -- the headers this report is known to have

  -- source header -> our column. jsonb because the shape differs per
  -- target, and a mapping table would mean a join for every row read.
  mapping        jsonb not null default '{}'::jsonb,

  -- Fixed values applied to every row: a clinic when the file does not name
  -- one, a period when it is only in the filename.
  defaults       jsonb not null default '{}'::jsonb,

  date_format    text,                   -- when a date arrives as text
  is_active      boolean not null default true,

  -- Kept so the list can be ordered by what is actually used, and so a
  -- profile nobody has touched in a year is visible as such.
  times_used     integer not null default 0,
  last_used_at   timestamptz,

  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (name)
);

create index if not exists import_profiles_target on import_profiles (target_table, is_active);


-- =====================================================================
-- BLOCK 2 of 2 — row level security
-- =====================================================================
-- Anybody signed in may READ a profile — the import screen needs them to
-- recognise a file. Only management changes one, because a wrong mapping
-- silently loads wrong figures, which is worse than a failed import.

alter table import_profiles enable row level security;

drop policy if exists ip_read  on import_profiles;
drop policy if exists ip_write on import_profiles;
create policy ip_read  on import_profiles for select using (auth.uid() is not null);
create policy ip_write on import_profiles for all using (is_admin()) with check (is_admin());


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select tablename, policyname from pg_policies
--  where tablename = 'import_profiles';         -- 2 rows
