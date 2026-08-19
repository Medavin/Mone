-- =====================================================================
-- MOne — Migration 009: daily and weekly figures, shift clock, leave
-- Run after 008. Clear the SQL Editor completely before pasting.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. DAILY AND WEEKLY FIGURES
-- ---------------------------------------------------------------------
-- Not everything arrives monthly. Some reports come daily and some weekly,
-- and they get their own tables rather than being forced into the monthly
-- grain.
--
-- Weekly is NOT derived from daily on purpose. When a weekly report arrives
-- with its own totals, those totals are what the client was shown -- if they
-- disagree with the sum of the days, that disagreement is a fact worth
-- keeping rather than one to smooth over.

create table if not exists clinic_daily (
  id              bigserial primary key,
  clinic_id       bigint not null references clinics(id) on delete cascade,
  activity_date   date   not null,

  charges         numeric(14,2),
  payments        numeric(14,2),
  adjustments     numeric(14,2),
  visits          integer,
  new_patients    integer,
  closing_ar      numeric(14,2),

  source_batch_id bigint,
  updated_at      timestamptz not null default now(),
  unique (clinic_id, activity_date)
);

create index if not exists clinic_daily_date on clinic_daily (activity_date desc);

create table if not exists clinic_weekly (
  id              bigserial primary key,
  clinic_id       bigint not null references clinics(id) on delete cascade,
  week_start      date   not null,          -- Monday of the week

  charges         numeric(14,2),
  payments        numeric(14,2),
  adjustments     numeric(14,2),
  visits          integer,
  new_patients    integer,
  closing_ar      numeric(14,2),

  source_batch_id bigint,
  updated_at      timestamptz not null default now(),
  unique (clinic_id, week_start),
  check (extract(isodow from week_start) = 1)
);

-- ---------------------------------------------------------------------
-- 2. SHIFT CLOCK
-- ---------------------------------------------------------------------
-- business_date is NOT derived from the server clock or the browser's.
--
-- The lesson from the previous project: a night shift in India spans two UTC
-- dates, and UTC rolls over at 05:30 IST -- near the END of a shift -- so one
-- shift was split across two "days" in every report. The business date is
-- anchored to the CLIENT timezone and written by the application, which knows
-- which working day a punch belongs to.
--
-- Clock TIMES stay as timestamptz and display in each viewer's own zone. Only
-- the DATE is anchored.

create table if not exists work_shifts (
  id             bigserial primary key,
  user_id        uuid not null references profiles(id) on delete cascade,
  business_date  date not null,

  punched_in_at  timestamptz not null default now(),
  punched_out_at timestamptz,

  -- The new requirement: where the shift was worked.
  work_location  text not null default 'office' check (work_location in ('office','home')),

  note           text,
  created_at     timestamptz not null default now(),

  unique (user_id, business_date)
);

create index if not exists work_shifts_date on work_shifts (business_date desc);

-- Breaks and meetings, as spans inside a shift. Modelled as events rather
-- than counters so that "on a break right now" is answerable, and so total
-- break time is a sum rather than something someone has to maintain.
create table if not exists shift_events (
  id         bigserial primary key,
  shift_id   bigint not null references work_shifts(id) on delete cascade,
  kind       text not null check (kind in ('break','meeting')),
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  note       text
);

create index if not exists shift_events_shift on shift_events (shift_id);

-- Only one open event per shift: you cannot be on a break and in a meeting
-- at the same time, and the interface should not have to police that.
create unique index if not exists shift_events_one_open
  on shift_events (shift_id) where ended_at is null;

-- ---------------------------------------------------------------------
-- 3. LEAVE
-- ---------------------------------------------------------------------
-- One row per person per day off. Balances and accrual are deliberately not
-- here yet -- they are a policy question, and policy that has not been
-- decided should not be guessed at in a schema.

create table if not exists leave_days (
  id          bigserial primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  leave_date  date not null,
  kind        text not null default 'leave'
              check (kind in ('leave','sick','holiday','unpaid','half_day')),
  status      text not null default 'approved'
              check (status in ('requested','approved','declined','cancelled')),
  note        text,
  requested_by uuid references profiles(id),
  decided_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  unique (user_id, leave_date)
);

create index if not exists leave_days_date on leave_days (leave_date desc);

create table if not exists company_holidays (
  id           bigserial primary key,
  holiday_date date not null unique,
  name         text not null
);

-- ---------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------
alter table clinic_daily      enable row level security;
alter table clinic_weekly     enable row level security;
alter table work_shifts       enable row level security;
alter table shift_events      enable row level security;
alter table leave_days        enable row level security;
alter table company_holidays  enable row level security;

drop policy if exists clinic_daily_read on clinic_daily;
drop policy if exists clinic_daily_write on clinic_daily;
create policy clinic_daily_read  on clinic_daily for select using (can_see_clinic(clinic_id));
create policy clinic_daily_write on clinic_daily for all using (is_admin()) with check (is_admin());

drop policy if exists clinic_weekly_read on clinic_weekly;
drop policy if exists clinic_weekly_write on clinic_weekly;
create policy clinic_weekly_read  on clinic_weekly for select using (can_see_clinic(clinic_id));
create policy clinic_weekly_write on clinic_weekly for all using (is_admin()) with check (is_admin());

-- Everyone punches their own clock. Operations and above see the team, which
-- is what the attendance view needs.
drop policy if exists shifts_own on work_shifts;
drop policy if exists shifts_team_read on work_shifts;
drop policy if exists shifts_admin on work_shifts;
create policy shifts_own on work_shifts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy shifts_team_read on work_shifts for select using (sees_all_clinics());
create policy shifts_admin on work_shifts
  for all using (is_admin()) with check (is_admin());

-- Events are reachable through the shift they belong to.
drop policy if exists events_own on shift_events;
drop policy if exists events_team_read on shift_events;
create policy events_own on shift_events
  for all using (exists (select 1 from work_shifts s where s.id = shift_id and s.user_id = auth.uid()))
  with check (exists (select 1 from work_shifts s where s.id = shift_id and s.user_id = auth.uid()));
create policy events_team_read on shift_events for select using (sees_all_clinics());

drop policy if exists leave_own_read on leave_days;
drop policy if exists leave_request on leave_days;
drop policy if exists leave_team_read on leave_days;
drop policy if exists leave_admin on leave_days;
create policy leave_own_read on leave_days for select using (user_id = auth.uid());
create policy leave_request  on leave_days for insert with check (user_id = auth.uid());
create policy leave_team_read on leave_days for select using (sees_all_clinics());
create policy leave_admin    on leave_days for all using (is_admin()) with check (is_admin());

drop policy if exists holidays_read on company_holidays;
drop policy if exists holidays_write on company_holidays;
create policy holidays_read  on company_holidays for select using (auth.uid() is not null);
create policy holidays_write on company_holidays for all using (is_admin()) with check (is_admin());

-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select table_name from information_schema.tables
--   where table_schema='public' and table_name in
--   ('clinic_daily','clinic_weekly','work_shifts','shift_events',
--    'leave_days','company_holidays')
--   order by table_name;            -- expect 6 rows
--
-- Then run supabase/VERIFY.sql — tables should now be 29.
