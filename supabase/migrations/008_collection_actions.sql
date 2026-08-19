-- =====================================================================
-- MOne — Migration 008: collection actions
-- Run after 007. Clear the SQL Editor completely before pasting.
-- =====================================================================
--
-- Source: the monthly Collection Action report.
-- Shape: DATE | CLINIC | COLLECTION ACTIONS | NUMBER OF ACTIONS | COLLECTOR
--
-- WHY THIS NEEDS FOUR TABLES RATHER THAN ONE
--
-- The clinic and the action are both FREE TEXT typed by collectors, and they
-- are not typed consistently. In one month's file, 38 different spellings
-- describe 18 actual actions -- "FIXED CLM & REBILLED", "FIXED CLAIM AND
-- REBILLED", and "FIXED CLAIM AND REBILLED " (trailing space) are the same
-- thing, and two variants of another action differ only by an en-dash.
--
-- That is why their own pivot table understates its largest categories: it
-- groups on the raw string. Storing the raw string would reproduce the bug.
--
-- So: the raw label is kept for audit, and every row also points at a
-- canonical action. Mapping is a table, not code, because next month will
-- bring a spelling nobody has seen.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. COLLECTORS
-- ---------------------------------------------------------------------
-- Identified by the login-style name in the report (WILLIAMS, KEVINMEHR).
-- Not linked to profiles: most collectors have no MOne account, and the
-- report is the only place they appear.

create table if not exists collectors (
  id           bigserial primary key,
  code         text not null unique,        -- as it appears in the report
  display_name text,
  is_active    boolean not null default true
);

-- ---------------------------------------------------------------------
-- 2. CANONICAL ACTION TYPES
-- ---------------------------------------------------------------------
create table if not exists action_types (
  id          bigserial primary key,
  name        text not null unique,         -- the canonical form
  category    text,                         -- grouping for reporting
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

-- Every raw spelling ever seen maps to one canonical action. `normalised` is
-- the upper-cased, whitespace-collapsed form the importer looks up, so a
-- trailing space or a stray dash cannot create a new action.
create table if not exists action_type_aliases (
  id             bigserial primary key,
  normalised     text not null unique,
  action_type_id bigint not null references action_types(id) on delete cascade,
  raw_example    text,
  first_seen     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. CLINIC ALIASES
-- ---------------------------------------------------------------------
-- The action report writes "PRO ACTIVE" where the clinic list says
-- "ProActive PT", and "WSPT" for something spelled out elsewhere. Only 17 of
-- 32 names matched automatically, so this cannot be inferred -- it has to be
-- recorded once and reused.

create table if not exists clinic_aliases (
  id          bigserial primary key,
  normalised  text not null unique,
  clinic_id   bigint not null references clinics(id) on delete cascade,
  raw_example text,
  source      text,                         -- which report the alias came from
  first_seen  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. THE FACTS
-- ---------------------------------------------------------------------
-- Grain: clinic x month x action type x collector.
--
-- `raw_action` and `raw_clinic` are kept alongside the resolved ids. When
-- somebody asks why a figure differs from the spreadsheet, the answer is in
-- the row rather than in a parser somebody has to read.

create table if not exists collection_actions_monthly (
  id              bigserial primary key,
  clinic_id       bigint not null references clinics(id) on delete cascade,
  period_month    date   not null,
  action_type_id  bigint not null references action_types(id),
  collector_id    bigint not null references collectors(id),

  action_count    integer not null default 0,
  is_ot           boolean not null default false,   -- "OT " prefix in the source

  raw_action      text,
  raw_clinic      text,
  source_batch_id bigint,
  updated_at      timestamptz not null default now(),

  unique (clinic_id, period_month, action_type_id, collector_id, is_ot),
  check (extract(day from period_month) = 1)
);

create index if not exists cam_actions_clinic_period
  on collection_actions_monthly (clinic_id, period_month);
create index if not exists cam_actions_collector
  on collection_actions_monthly (collector_id, period_month);

-- Rows the importer could not resolve. Nothing is silently dropped: an
-- unmapped clinic or action lands here and shows up as work to do.
create table if not exists unmapped_action_rows (
  id              bigserial primary key,
  period_month    date,
  raw_clinic      text,
  raw_action      text,
  raw_collector   text,
  action_count    integer,
  reason          text not null,
  source_batch_id bigint,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
alter table collectors                enable row level security;
alter table action_types              enable row level security;
alter table action_type_aliases       enable row level security;
alter table clinic_aliases            enable row level security;
alter table collection_actions_monthly enable row level security;
alter table unmapped_action_rows      enable row level security;

drop policy if exists collectors_read on collectors;
drop policy if exists collectors_write on collectors;
create policy collectors_read  on collectors for select using (auth.uid() is not null);
create policy collectors_write on collectors for all using (is_admin()) with check (is_admin());

drop policy if exists action_types_read on action_types;
drop policy if exists action_types_write on action_types;
create policy action_types_read  on action_types for select using (auth.uid() is not null);
create policy action_types_write on action_types for all using (is_admin()) with check (is_admin());

drop policy if exists ata_read on action_type_aliases;
drop policy if exists ata_write on action_type_aliases;
create policy ata_read  on action_type_aliases for select using (auth.uid() is not null);
create policy ata_write on action_type_aliases for all using (is_admin()) with check (is_admin());

drop policy if exists clinic_aliases_read on clinic_aliases;
drop policy if exists clinic_aliases_write on clinic_aliases;
create policy clinic_aliases_read  on clinic_aliases for select using (auth.uid() is not null);
create policy clinic_aliases_write on clinic_aliases for all using (is_admin()) with check (is_admin());

drop policy if exists cam_actions_read on collection_actions_monthly;
drop policy if exists cam_actions_write on collection_actions_monthly;
create policy cam_actions_read  on collection_actions_monthly
  for select using (can_see_clinic(clinic_id));
create policy cam_actions_write on collection_actions_monthly
  for all using (is_admin()) with check (is_admin());

drop policy if exists unmapped_read on unmapped_action_rows;
drop policy if exists unmapped_write on unmapped_action_rows;
create policy unmapped_read  on unmapped_action_rows for select using (sees_all_clinics());
create policy unmapped_write on unmapped_action_rows for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- 6. SEED — the 18 real actions found in the June 2021 file
-- ---------------------------------------------------------------------
insert into action_types (name, category, sort_order) values
  ('Claim reprocessed'::text,            'Rework'::text,      10),
  ('Fixed claim & rebilled',             'Rework',            20),
  ('Fixed registration & rebilled',      'Rework',            30),
  ('NCOF & rebilled',                    'Rework',            40),
  ('Claim paid - payment not posted',    'Posting',           50),
  ('Claim paid - under review',          'Posting',           60),
  ('Appealed claim',                     'Appeal',            70),
  ('Appeal follow up',                   'Appeal',            80),
  ('Follow up on claim',                 'Follow up',         90),
  ('Claim in process',                   'Follow up',        100),
  ('Faxed claim to adjuster',            'Follow up',        110),
  ('Insurance requested info from billco','Follow up',        120),
  ('Sent to CAM',                        'Escalation',       130),
  ('Item on communication log',          'Escalation',       140),
  ('Insurance denied - write-off',       'Closed',           150),
  ('Insurance denied - no auth',         'Closed',           160),
  ('Moved balance to patient & statement','Patient',          170),
  ('Secondary balance',                  'Patient',          180)
on conflict (name) do nothing;

-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select count(*) from action_types;            -- expect 18
-- select name, category from action_types order by sort_order;
--
-- select table_name from information_schema.tables
--   where table_schema='public' and table_name in
--   ('collectors','action_types','action_type_aliases','clinic_aliases',
--    'collection_actions_monthly','unmapped_action_rows')
--   order by table_name;                        -- expect 6 rows
--
-- Then run supabase/VERIFY.sql — tables should now be 23.
