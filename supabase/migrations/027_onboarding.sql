-- =====================================================================
-- MBOne — Migration 027: bringing a new client on
-- Run after 026. Paste in FOUR blocks.
-- =====================================================================
--
-- ⚠ WHAT THIS DELIBERATELY DOES *NOT* HOLD, AND WHY
--
-- Most of what onboarding needs already exists in MBOne:
--
--   client name, go-live date, address, NPI ....... clinics
--   contact person, office manager, therapists .... clinic_people
--   work distribution (charges, A/R, payments,
--     registration, rejections ...) ............... clinic_function_owners
--   insurance logins .............................. portals
--   agreements, contracts, any document ........... shared_files
--
-- Copying those into an onboarding table would create a second version of
-- every fact, and the day a client goes live the two would disagree — with
-- nobody able to say which was right. So an onboarding record POINTS AT a
-- clinic and holds only what is true about the TRANSITION itself.
--
-- The practical consequence: create the clinic first, then its onboarding.
-- A clinic is not created by this table.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 4 — the onboarding record
-- =====================================================================

create table if not exists client_onboarding (
  id                bigserial primary key,

  -- One onboarding per clinic. A second would mean two people tracking the
  -- same transition from different rows.
  clinic_id         bigint not null unique references clinics(id) on delete cascade,

  stage             text not null default 'prospect'
                    check (stage in ('prospect','agreed','in_transition','live','on_hold','lost')),

  -- Who is bringing them on.
  cam_id            uuid   references profiles(id) on delete set null,
  owner_id          uuid   references profiles(id) on delete set null,

  -- What they are coming FROM. This is the part that exists nowhere else,
  -- and the part everybody asks about six months later.
  old_billing_system text,
  old_billing_agency text,
  old_ar_accounts    integer,
  old_ar_amount      numeric(14,2),
  pending_payments   numeric(14,2),
  transition_note    text,

  -- Size, kept here rather than counted from clinic_people, because during
  -- onboarding you know the number long before you have the names.
  provider_count     integer,

  -- Dates that matter to a transition.
  first_contact_on   date,
  agreement_sent_on  date,
  agreement_signed_on date,
  go_live_on         date,

  terms_note        text,                  -- rate, term, notice period in words
  communications    text,                  -- how they want to be contacted
  note              text,

  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists onboarding_stage on client_onboarding (stage);


-- =====================================================================
-- BLOCK 2 of 4 — the checklist
-- =====================================================================
-- Steps rather than one big "status", because "where are we with Peak PT"
-- is answered by which steps are done, not by a single word. Each row can
-- carry a file, so the signed agreement lives against the step that asked
-- for it instead of in somebody's inbox.

create table if not exists onboarding_steps (
  id             bigserial primary key,
  onboarding_id  bigint not null references client_onboarding(id) on delete cascade,

  label          text not null,
  category       text,                     -- paperwork, access, data, setup, people
  sort_order     integer not null default 100,

  status         text not null default 'todo'
                 check (status in ('todo','in_progress','done','blocked','not_needed')),
  owner_id       uuid   references profiles(id) on delete set null,
  due_on         date,
  done_on        date,

  -- Points at shared_files rather than holding a file, so onboarding
  -- documents live with every other document and inherit its rules.
  file_id        bigint references shared_files(id) on delete set null,

  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists onboarding_steps_ob on onboarding_steps (onboarding_id, sort_order);

-- The standard list, applied to a new client in one go by the app. Held as
-- a table rather than in code so the process can change without a deploy.
create table if not exists onboarding_step_templates (
  id         bigserial primary key,
  label      text not null,
  category   text,
  sort_order integer not null default 100,
  is_active  boolean not null default true
);

insert into onboarding_step_templates (label, category, sort_order) values
  ('Terms agreed',                        'paperwork',  10),
  ('Agreement sent',                      'paperwork',  20),
  ('Agreement signed and filed',          'paperwork',  30),
  ('BAA signed',                          'paperwork',  40),
  ('AdvancedMD office key received',      'access',     50),
  ('Insurance portal logins collected',   'access',     60),
  ('Clearing house access confirmed',     'access',     70),
  ('Old A/R file received',               'data',       80),
  ('Old A/R loaded and reconciled',       'data',       90),
  ('Pending payments listed',             'data',      100),
  ('In-network payer list confirmed',     'data',      110),
  ('Contracts and fee schedules filed',   'data',      120),
  ('Locations recorded',                  'setup',     130),
  ('Providers and NPIs recorded',         'setup',     140),
  ('Work distribution agreed',            'setup',     150),
  ('CAM assigned',                        'people',    160),
  ('Office manager introduced',           'people',    170),
  ('Kick-off call held',                  'people',    180),
  ('First charges posted',                'setup',     190),
  ('Go live confirmed',                   'setup',     200)
on conflict do nothing;


-- =====================================================================
-- BLOCK 3 of 4 — locations and payers
-- =====================================================================
-- A clinic already carries ONE address. A client can have several sites,
-- each with its own NPI and its own front desk, so they get their own rows
-- rather than being crammed into the clinic's address fields.

create table if not exists clinic_locations (
  id            bigserial primary key,
  clinic_id     bigint not null references clinics(id) on delete cascade,
  name          text not null,
  address_line1 text,
  address_line2 text,
  city          text,
  state         text,
  postal_code   text,
  phone         text,
  fax           text,
  location_npi  text,                      -- text: leading zeros are real
  place_of_service text,
  is_primary    boolean not null default false,
  is_active     boolean not null default true,
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists clinic_locations_clinic on clinic_locations (clinic_id);

-- One primary site per clinic. Two would mean two answers to "where is
-- this client", which is the question the field exists to settle.
create unique index if not exists clinic_locations_one_primary
  on clinic_locations (clinic_id) where is_primary;

-- Which payers this client is in network with, and the contract that says
-- so. `in_network` is a three-state on purpose: null means nobody has
-- checked yet, which is different from knowing they are out of network.
create table if not exists clinic_payers (
  id              bigserial primary key,
  clinic_id       bigint not null references clinics(id) on delete cascade,
  payer_name      text not null,
  payer_id        text,                    -- the electronic payer id
  in_network      boolean,
  plan_types      text,
  effective_from  date,
  effective_to    date,
  fee_schedule    text,
  contract_file_id bigint references shared_files(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now(),
  unique (clinic_id, payer_name)
);

create index if not exists clinic_payers_clinic on clinic_payers (clinic_id, in_network);


-- =====================================================================
-- BLOCK 4 of 4 — row level security
-- =====================================================================
-- All four follow the clinic, like every other clinic-bound table.
-- Onboarding is management work, so writing is is_admin().

alter table client_onboarding         enable row level security;
alter table onboarding_steps          enable row level security;
alter table onboarding_step_templates enable row level security;
alter table clinic_locations          enable row level security;
alter table clinic_payers             enable row level security;

drop policy if exists ob_read  on client_onboarding;
drop policy if exists ob_write on client_onboarding;
create policy ob_read  on client_onboarding for select using (can_see_clinic(clinic_id));
create policy ob_write on client_onboarding for all using (is_admin()) with check (is_admin());

drop policy if exists obs_read  on onboarding_steps;
drop policy if exists obs_write on onboarding_steps;
create policy obs_read on onboarding_steps for select
  using (exists (select 1 from client_onboarding o
                  where o.id = onboarding_steps.onboarding_id
                    and can_see_clinic(o.clinic_id)));
create policy obs_write on onboarding_steps for all using (is_admin()) with check (is_admin());

drop policy if exists obt_read  on onboarding_step_templates;
drop policy if exists obt_write on onboarding_step_templates;
create policy obt_read  on onboarding_step_templates for select using (auth.uid() is not null);
create policy obt_write on onboarding_step_templates for all using (is_admin()) with check (is_admin());

drop policy if exists loc_read  on clinic_locations;
drop policy if exists loc_write on clinic_locations;
create policy loc_read  on clinic_locations for select using (can_see_clinic(clinic_id));
create policy loc_write on clinic_locations for all using (is_admin()) with check (is_admin());

drop policy if exists payer_read  on clinic_payers;
drop policy if exists payer_write on clinic_payers;
create policy payer_read  on clinic_payers for select using (can_see_clinic(clinic_id));
create policy payer_write on clinic_payers for all using (is_admin()) with check (is_admin());


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select count(*) from onboarding_step_templates;    -- 20
-- select tablename, policyname from pg_policies
--  where tablename in ('client_onboarding','onboarding_steps',
--                      'onboarding_step_templates','clinic_locations','clinic_payers')
--  order by tablename;                               -- 10 rows
