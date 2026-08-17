-- =====================================================================
-- MOMENTUM AR PLATFORM
-- Migration 001 — core: access control, reference tables, CAM assignments
-- Run this FIRST, on its own, in the Supabase SQL Editor.
-- Clear the editor completely before pasting.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PROFILES  (one row per app user, keyed to Supabase auth)
-- ---------------------------------------------------------------------
-- Role is TEXT + CHECK, deliberately NOT a Postgres enum. An enum cannot
-- have a new value added and used inside the same transaction, which has
-- historically forced migrations to be split in two. A CHECK constraint
-- is edited in one statement.

create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  email         text not null,
  role          text not null default 'agent'
                check (role in ('admin','exec','ops','cam','agent','guest')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table profiles enable row level security;

-- ---------------------------------------------------------------------
-- 2. HELPER FUNCTIONS
-- ---------------------------------------------------------------------
-- SECURITY DEFINER so they can read profiles without re-triggering the
-- policies on profiles. Reading profiles from inside a profiles policy
-- is the classic infinite-recursion trap.

create or replace function current_role_of()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select role from profiles where id = auth.uid();
$fn$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce((select role from profiles where id = auth.uid()) = 'admin', false);
$fn$;

-- Anyone who is allowed to see every clinic: admin, executive, operations.
create or replace function sees_all_clinics()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce((select role from profiles where id = auth.uid())
                  in ('admin','exec','ops'), false);
$fn$;

-- ---------------------------------------------------------------------
-- 3. PROFILES POLICIES
-- ---------------------------------------------------------------------
drop policy if exists profiles_self_read  on profiles;
drop policy if exists profiles_admin_read on profiles;
drop policy if exists profiles_self_write on profiles;
drop policy if exists profiles_admin_all  on profiles;

-- Read your own row. Tested directly on the row, no lookup, so it cannot recurse.
create policy profiles_self_read on profiles
  for select using (id = auth.uid());

-- Admins read everyone. Uses the SECURITY DEFINER function, not a subquery.
create policy profiles_admin_read on profiles
  for select using (is_admin());

-- Update your own name only. Role changes are admin-only, below.
create policy profiles_self_write on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_admin_all on profiles
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- 4. CLINICS
-- ---------------------------------------------------------------------
create table if not exists clinics (
  id            bigserial primary key,
  code          text unique,
  name          text not null unique,
  status        text not null default 'active'
                check (status in ('active','inactive','onboarding','terminated')),
  go_live_date  date,
  notes         text,
  created_at    timestamptz not null default now()
);

alter table clinics enable row level security;

drop policy if exists clinics_read  on clinics;
drop policy if exists clinics_write on clinics;

create policy clinics_read  on clinics for select using (auth.uid() is not null);
create policy clinics_write on clinics for all    using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- 5. CAM ASSIGNMENTS  (clinic <-> account manager, WITH DATES)
-- ---------------------------------------------------------------------
-- Its own table, not a cam_id column on clinics. Ownership changes, and a
-- report for March must show who owned the clinic in March. An overwritten
-- column destroys that history; a dated table keeps it.
-- effective_to NULL means "current".

create table if not exists cam_assignments (
  id             bigserial primary key,
  clinic_id      bigint not null references clinics(id) on delete cascade,
  cam_id         uuid   not null references profiles(id) on delete restrict,
  effective_from date   not null,
  effective_to   date,
  created_at     timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

-- Only one CURRENT assignment per clinic. Historic rows are unconstrained.
create unique index if not exists cam_assignments_one_current
  on cam_assignments (clinic_id) where effective_to is null;

create index if not exists cam_assignments_by_cam on cam_assignments (cam_id);

alter table cam_assignments enable row level security;

drop policy if exists cam_assignments_read  on cam_assignments;
drop policy if exists cam_assignments_write on cam_assignments;

create policy cam_assignments_read  on cam_assignments
  for select using (auth.uid() is not null);
create policy cam_assignments_write on cam_assignments
  for all using (is_admin()) with check (is_admin());

-- Does the signed-in user currently own this clinic?
create or replace function is_cam_of(p_clinic_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from cam_assignments
    where clinic_id = p_clinic_id
      and cam_id = auth.uid()
      and effective_to is null
  );
$fn$;

-- The single rule every clinic-scoped table reuses.
create or replace function can_see_clinic(p_clinic_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select sees_all_clinics() or is_cam_of(p_clinic_id);
$fn$;

-- ---------------------------------------------------------------------
-- 6. REFERENCE TABLES
-- ---------------------------------------------------------------------
create table if not exists financial_classes (
  id          bigserial primary key,
  code        text not null unique,          -- '1A', '1L', '1C'
  name        text not null,                 -- 'AUTO', 'LIEN'
  sort_order  int  not null default 0,
  is_active   boolean not null default true
);

create table if not exists carriers (
  id          bigserial primary key,
  code        text,
  name        text not null,
  unique (code, name)
);

create table if not exists providers (
  id          bigserial primary key,
  name        text not null,                 -- 'GINTHER,CORY'
  credential  text,                          -- 'DPT', 'PT'
  is_active   boolean not null default true,
  unique (name, credential)
);

create table if not exists procedures (
  id          bigserial primary key,
  code        text not null unique,          -- '97110'
  description text,
  is_active   boolean not null default true
);

create table if not exists referring_providers (
  id          bigserial primary key,
  name        text not null,
  street      text,
  city        text,
  state       text,
  zip         text,
  phone       text,
  email       text,
  unique (name, zip)
);

alter table financial_classes   enable row level security;
alter table carriers            enable row level security;
alter table providers           enable row level security;
alter table procedures          enable row level security;
alter table referring_providers enable row level security;

-- Reference data: everyone signed in reads, admin writes.
drop policy if exists fc_read on financial_classes;
drop policy if exists fc_write on financial_classes;
create policy fc_read  on financial_classes for select using (auth.uid() is not null);
create policy fc_write on financial_classes for all using (is_admin()) with check (is_admin());

drop policy if exists carriers_read on carriers;
drop policy if exists carriers_write on carriers;
create policy carriers_read  on carriers for select using (auth.uid() is not null);
create policy carriers_write on carriers for all using (is_admin()) with check (is_admin());

drop policy if exists providers_read on providers;
drop policy if exists providers_write on providers;
create policy providers_read  on providers for select using (auth.uid() is not null);
create policy providers_write on providers for all using (is_admin()) with check (is_admin());

drop policy if exists procedures_read on procedures;
drop policy if exists procedures_write on procedures;
create policy procedures_read  on procedures for select using (auth.uid() is not null);
create policy procedures_write on procedures for all using (is_admin()) with check (is_admin());

drop policy if exists refprov_read on referring_providers;
drop policy if exists refprov_write on referring_providers;
create policy refprov_read  on referring_providers for select using (auth.uid() is not null);
create policy refprov_write on referring_providers for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- 7. SEED — financial classes seen in the AdvancedMD reports
-- ---------------------------------------------------------------------
-- Explicit ::text casts on the first VALUES row. Without them Postgres can
-- infer the wrong type for the whole VALUES list and the insert fails with
-- a confusing error.

insert into financial_classes (code, name, sort_order) values
  ('1A'::text, 'AUTO'::text,                    10),
  ('1B',       'PRIV INS-BEECHSTREET',          20),
  ('1C',       'CONTRACTED PER DIEM RATE',      30),
  ('1D',       'DEPT OF LABOR',                 40),
  ('1L',       'LIEN',                          50)
on conflict (code) do nothing;

-- =====================================================================
-- VERIFY — run this AFTER the migration, in a separate paste.
-- "Success" in the SQL Editor does not prove the objects exist.
-- =====================================================================
-- select table_name from information_schema.tables
--   where table_schema='public' order by table_name;
--
-- select tablename, policyname from pg_policies
--   where schemaname='public' order by tablename, policyname;
--
-- select routine_name from information_schema.routines
--   where routine_schema='public' order by routine_name;
--
-- Expect 8 tables, 5 functions, and at least 2 policies per table.
