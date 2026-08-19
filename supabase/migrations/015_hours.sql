-- =====================================================================
-- MOne — Migration 015: billable hours
-- Run after 014b. Paste in FOUR blocks, clearing the editor between each
-- (the SQL editor truncates long pastes).
-- =====================================================================
--
-- WHY THIS EXISTS
-- "Momentum teams works on Hours." So these figures are a billing
-- instrument, not an HR nicety, and a wrong number here is as serious as a
-- wrong A/R figure. Four things follow from that:
--
--   1. A MEETING IS PRODUCTION, not a break. It always was in the model;
--      now it is stated in the policy table rather than assumed in code.
--
--   2. THERE ARE TWO KINDS OF BREAK. A personal break and an unavoidable
--      one -- a network outage, a system failure -- are not the same
--      event, and the difference has to survive into the report or nobody
--      can argue about it later.
--
--   3. WHETHER EACH KIND IS BILLABLE IS A DECISION, NOT A CONSTANT. The
--      admin sets it. Hard-coding "breaks are unpaid" would mean a
--      developer is needed the day that policy changes, and the policy
--      belongs to whoever runs the business.
--
--   4. RATES CHANGE. A rate stored as one column on the employee would
--      silently re-price every month already invoiced. So rates are a
--      history keyed by the date they take effect.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 4 — the two break kinds
-- =====================================================================
-- 'break' keeps its meaning (the employee's own break) so existing rows
-- stay correct; 'outage' is the new unavoidable kind.

alter table shift_events drop constraint if exists shift_events_kind_check;

alter table shift_events
  add constraint shift_events_kind_check
  check (kind in ('break','outage','meeting'));


-- =====================================================================
-- BLOCK 2 of 4 — what counts as billable, and clinic spans
-- =====================================================================

-- One row per kind of time. The admin toggles `billable`; nothing in the
-- app decides it. `productive` is separate on purpose: an outage may be
-- billable to the client while still not being production, and those two
-- questions get asked by different people.
create table if not exists time_policy (
  kind       text primary key check (kind in ('work','break','outage','meeting')),
  label      text not null,
  billable   boolean not null default true,
  productive boolean not null default true,
  note       text,
  updated_at timestamptz not null default now()
);

insert into time_policy (kind, label, billable, productive, note) values
  ('work',    'Working',            true,  true,  'Time on shift that is not a break, an outage or a meeting.'),
  ('meeting', 'Meeting',            true,  true,  'Counted as production.'),
  ('outage',  'Unavoidable break',  true,  false, 'Network outage, system failure. Billable by default -- change it here if the client disagrees.'),
  ('break',   'Personal break',     false, false, 'The employee''s own break.')
on conflict (kind) do nothing;

-- Which clinic somebody was working on, and when. A span rather than a
-- column on the shift, because a person switches clinics during the day --
-- the same start/switch behaviour MedaOne has.
create table if not exists shift_clinic_spans (
  id         bigserial primary key,
  shift_id   bigint not null references work_shifts(id) on delete cascade,
  clinic_id  bigint not null references clinics(id),
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  note       text
);

create index if not exists shift_clinic_spans_shift on shift_clinic_spans (shift_id);
create index if not exists shift_clinic_spans_clinic on shift_clinic_spans (clinic_id, started_at);

-- You can only be working on one clinic at a time.
create unique index if not exists shift_clinic_one_open
  on shift_clinic_spans (shift_id) where ended_at is null;

-- Rates, as a history. `effective_from` is the date the rate starts; the
-- rate in force on any day is the latest row on or before it, so a report
-- for March still prices at March's rate after a raise in April.
create table if not exists employee_rates (
  id             bigserial primary key,
  employee_id    bigint not null references employees(id) on delete cascade,
  hourly_rate    numeric(12,2) not null check (hourly_rate >= 0),
  currency       text not null default 'USD',
  effective_from date not null,
  note           text,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  unique (employee_id, effective_from)
);

create index if not exists employee_rates_emp on employee_rates (employee_id, effective_from desc);


-- =====================================================================
-- BLOCK 3 of 4 — the role hierarchy
-- =====================================================================
-- ⚠ THIS CHANGES WHO CAN DO WHAT ACROSS THE WHOLE APP. READ IT.
--
-- Migration 001 assumed `admin` was the top of the tree. That is wrong for
-- this business: ops and exec sit ABOVE admin and have full rights to
-- everything. Rather than edit forty policies one at a time, is_admin() is
-- redefined once, and every policy that calls it follows.
--
-- The name is now slightly misleading and that is the trade: one correct
-- change beats forty chances to miss one. `agent`, `cam` and `guest` are
-- entirely unaffected -- this widens nothing below the management line.

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid()
       and p.is_active
       and p.role in ('admin','ops','exec')
  );
$fn$;

-- Kept as a separate name for the places where "can see the whole team's
-- hours" is the question being asked, so that intent stays readable.
create or replace function manages_people()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid()
       and p.is_active
       and p.role in ('admin','ops','exec')
  );
$fn$;


-- =====================================================================
-- BLOCK 4 of 4 — row level security
-- =====================================================================
-- The rule he stated: management sees everyone; everybody else sees only
-- their own hours. Pay rates are management-only, full stop.

alter table time_policy        enable row level security;
alter table shift_clinic_spans enable row level security;
alter table employee_rates     enable row level security;

drop policy if exists time_policy_read  on time_policy;
drop policy if exists time_policy_write on time_policy;
create policy time_policy_read  on time_policy for select using (auth.uid() is not null);
create policy time_policy_write on time_policy for all using (is_admin()) with check (is_admin());

drop policy if exists spans_read  on shift_clinic_spans;
drop policy if exists spans_write on shift_clinic_spans;

create policy spans_read on shift_clinic_spans for select
  using (
    manages_people()
    or exists (select 1 from work_shifts w
                where w.id = shift_clinic_spans.shift_id and w.user_id = auth.uid())
  );

create policy spans_write on shift_clinic_spans for all
  using (
    manages_people()
    or exists (select 1 from work_shifts w
                where w.id = shift_clinic_spans.shift_id and w.user_id = auth.uid())
  )
  with check (
    manages_people()
    or exists (select 1 from work_shifts w
                where w.id = shift_clinic_spans.shift_id and w.user_id = auth.uid())
  );

-- Pay is not roster information. Only management reads it, including your
-- own -- an employee seeing their own rate here would be a decision for
-- Momentum to make deliberately, not a side effect of a policy.
drop policy if exists rates_read  on employee_rates;
drop policy if exists rates_write on employee_rates;
create policy rates_read  on employee_rates for select using (manages_people());
create policy rates_write on employee_rates for all using (is_admin()) with check (is_admin());


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select kind, label, billable, productive from time_policy order by kind;
--   -> 4 rows: break(false,false) meeting(true,true) outage(true,false) work(true,true)
--
-- select is_admin(), manages_people();      -- both true for you
--
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'shift_events'::regclass and conname like '%kind%';
--   -> must list break, outage, meeting
