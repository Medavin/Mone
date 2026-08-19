-- =====================================================================
-- MOne — Migration 010: employees
-- Run after 009. Clear the SQL Editor completely before pasting.
-- =====================================================================
--
-- WHY EMPLOYEES ARE NOT JUST PROFILES
--
-- `profiles` is keyed to auth.users -- it is the record of somebody who can
-- sign in. But an employee exists before they have a login and after it is
-- taken away: they are hired, they appear on a rota, they leave.
--
-- Forcing the two together would mean either creating a login for everybody
-- before they can be recorded, or losing the record when access is removed.
-- So an employee is its own row with an OPTIONAL link to a login.
--
-- Consequence, deliberately: an employee with no linked login cannot punch a
-- clock or be assigned a task, because there is nobody to sign in as. The
-- attendance tables still key on profiles.
-- =====================================================================

create table if not exists employees (
  id            bigserial primary key,

  -- Set once a login exists. Null until then.
  profile_id    uuid references profiles(id) on delete set null,

  full_name     text not null,
  email         text,
  job_title     text,
  department    text,

  -- Which screen this person should land on after signing in. Held here
  -- rather than on profiles so it can be decided when the employee is set up,
  -- before any login exists.
  landing_page  text not null default 'dashboard'
                check (landing_page in ('dashboard','operations','cam','clinics','people','guest')),

  -- The role they are intended to have. Applied to profiles when a login is
  -- linked; the profile's own role is what the database actually enforces.
  intended_role text not null default 'agent'
                check (intended_role in ('admin','exec','ops','cam','agent','guest')),

  -- Default for the shift clock. Someone permanently remote should not have
  -- to change it every day.
  default_location text not null default 'office'
                   check (default_location in ('office','home')),

  region        text,                 -- for the multi-region clock display
  manager_id    bigint references employees(id) on delete set null,

  started_on    date,
  ended_on      date,
  status        text not null default 'active'
                check (status in ('active','on_leave','notice','left')),

  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  check (ended_on is null or started_on is null or ended_on >= started_on)
);

-- One employee per login, where a login exists at all.
create unique index if not exists employees_one_per_profile
  on employees (profile_id) where profile_id is not null;

create index if not exists employees_status on employees (status);

alter table employees enable row level security;

-- Everyone can see the team roster -- names, titles, who reports to whom.
-- Only admins change it.
drop policy if exists employees_read on employees;
drop policy if exists employees_write on employees;
create policy employees_read  on employees for select using (auth.uid() is not null);
create policy employees_write on employees for all using (is_admin()) with check (is_admin());

-- Where should the signed-in person land? Falls back to their role when no
-- employee record is linked yet, so a login always goes somewhere sensible.
create or replace function my_landing_page()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select e.landing_page from employees e where e.profile_id = auth.uid()),
    case (select role from profiles where id = auth.uid())
      when 'ops'   then 'operations'
      when 'cam'   then 'cam'
      when 'guest' then 'guest'
      else 'dashboard'
    end
  );
$fn$;

-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select column_name from information_schema.columns
--   where table_name = 'employees' order by ordinal_position;
--
-- select my_landing_page();     -- expect 'dashboard' for an admin
--
-- Then run supabase/VERIFY.sql — tables should now be 30.
