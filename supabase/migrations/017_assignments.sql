-- =====================================================================
-- MOne — Migration 017: the assignment matrix
-- Run after 016. Paste in THREE blocks, clearing the editor between them.
-- =====================================================================
--
-- WHAT THE SAMPLE ACTUALLY SHOWS
-- Pravin's sheet is one row per clinic against twelve columns of work --
-- Charges, Payments, AR, CRL, Unapplied, Patient Calls, Mails, Client
-- calls, Day End, Reg. Checks, Rejections, Other -- with a name in each
-- cell. For Back to Health PT: Diana on charges, MTI on payments, Medavin
-- on A/R, Michelle on unapplied, and so on.
--
-- ⚠ SO THIS IS STANDING OWNERSHIP, NOT A DAILY TASK LIST. It answers
-- "who owns rejections for this clinic", which stays true for months.
-- That is a different question from "what is Diana doing today", and
-- modelling it as daily rows would mean re-stating the same twelve facts
-- every morning and losing them the moment nobody did.
--
-- ⚠ AND THE ASSIGNEE IS NOT ALWAYS A PERSON. "Diana" and "Michelle" are
-- people; "Medavin" and "MTI" are organisations. A foreign key to
-- profiles would be wrong for two of the four, and inventing logins for
-- companies would be worse. So the assignee is a PARTY, which may or may
-- not have a login behind it.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 3 — the columns of work, and who can hold one
-- =====================================================================

create table if not exists work_functions (
  id         bigserial primary key,
  code       text not null unique,
  label      text not null,
  sort_order integer not null default 100,
  note       text,
  is_active  boolean not null default true
);

-- The twelve from his sheet, in his order. `Other` is kept because his
-- sheet has it: a column that is usually blank still means "anything not
-- covered above", and dropping it would lose that.
insert into work_functions (code, label, sort_order) values
  ('charges',       'Charges',        10),
  ('payments',      'Payments',       20),
  ('ar',            'A/R',            30),
  ('crl',           'CRL',            40),
  ('unapplied',     'Unapplied',      50),
  ('patient_calls', 'Patient Calls',  60),
  ('mails',         'Mails',          70),
  ('client_calls',  'Client calls',   80),
  ('day_end',       'Day End',        90),
  ('reg_checks',    'Reg. Checks',   100),
  ('rejections',    'Rejections',    110),
  ('other',         'Other',         120)
on conflict (code) do nothing;

-- Whoever can be named in a cell. A person, a team, or an outside company.
create table if not exists work_parties (
  id         bigserial primary key,
  name       text not null unique,
  kind       text not null default 'person'
             check (kind in ('person','team','vendor','client')),
  -- Set when this party is somebody with a login here, so their own page
  -- can show what they own. Null for an outside company, which is fine.
  profile_id uuid references profiles(id) on delete set null,
  colour     text,
  is_active  boolean not null default true,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists work_parties_profile on work_parties (profile_id);

insert into work_parties (name, kind, note) values
  ('Medavin', 'vendor', 'Pravin''s own team.'),
  ('MTI',     'vendor', 'Outside vendor named in the assignment sheet.')
on conflict (name) do nothing;


-- =====================================================================
-- BLOCK 2 of 3 — the matrix itself
-- =====================================================================
-- One owner per clinic per function. Enforced, because two owners of
-- "Rejections" at one clinic is not a richer answer, it is an argument
-- waiting to happen.

create table if not exists clinic_function_owners (
  id          bigserial primary key,
  clinic_id   bigint not null references clinics(id) on delete cascade,
  function_id bigint not null references work_functions(id) on delete cascade,
  party_id    bigint not null references work_parties(id) on delete cascade,
  note        text,
  set_by      uuid references profiles(id),
  updated_at  timestamptz not null default now(),
  unique (clinic_id, function_id)
);

create index if not exists cfo_clinic on clinic_function_owners (clinic_id);
create index if not exists cfo_party  on clinic_function_owners (party_id);

-- Daily assignments, kept SEPARATE from the standing matrix above. The
-- matrix says who owns rejections at a clinic in general; this says what
-- somebody has actually been asked to do today. Conflating them would
-- mean either re-entering the matrix every morning or having no record of
-- a one-off.
create table if not exists daily_assignments (
  id          bigserial primary key,
  work_date   date not null,
  party_id    bigint references work_parties(id) on delete set null,
  assignee_id uuid references profiles(id) on delete set null,
  clinic_id   bigint references clinics(id) on delete cascade,
  function_id bigint references work_functions(id) on delete set null,
  detail      text,
  status      text not null default 'open'
              check (status in ('open','in_progress','done','dropped')),
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists daily_assignments_day on daily_assignments (work_date);
create index if not exists daily_assignments_who on daily_assignments (assignee_id, work_date);


-- =====================================================================
-- BLOCK 3 of 3 — row level security
-- =====================================================================

alter table work_functions         enable row level security;
alter table work_parties           enable row level security;
alter table clinic_function_owners enable row level security;
alter table daily_assignments      enable row level security;

drop policy if exists wf_read  on work_functions;
drop policy if exists wf_write on work_functions;
create policy wf_read  on work_functions for select using (auth.uid() is not null);
create policy wf_write on work_functions for all using (is_admin()) with check (is_admin());

drop policy if exists wp_read  on work_parties;
drop policy if exists wp_write on work_parties;
create policy wp_read  on work_parties for select using (auth.uid() is not null);
create policy wp_write on work_parties for all using (is_admin()) with check (is_admin());

-- Who owns what follows the clinic: if you can see the clinic, you can see
-- who is responsible for it.
drop policy if exists cfo_read  on clinic_function_owners;
drop policy if exists cfo_write on clinic_function_owners;
create policy cfo_read  on clinic_function_owners for select using (can_see_clinic(clinic_id));
create policy cfo_write on clinic_function_owners for all using (is_admin()) with check (is_admin());

-- You always see what you have been asked to do; management sees everyone's.
drop policy if exists da_read  on daily_assignments;
drop policy if exists da_write on daily_assignments;
create policy da_read on daily_assignments for select
  using (manages_people() or assignee_id = auth.uid());
create policy da_write on daily_assignments for all
  using (is_admin() or assignee_id = auth.uid())
  with check (is_admin() or assignee_id = auth.uid());


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select code, label from work_functions order by sort_order;   -- 12 rows
-- select name, kind from work_parties order by name;            -- Medavin, MTI
-- select tablename, policyname from pg_policies
--  where tablename in ('work_functions','work_parties',
--                      'clinic_function_owners','daily_assignments')
--  order by tablename;                                          -- 8 rows
