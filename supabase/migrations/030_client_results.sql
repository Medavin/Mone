-- =====================================================================
-- MBOne — Migration 030: Client & CAM Results (Michelle's page)
-- Run after 029. Paste in FOUR blocks, one at a time.
-- =====================================================================
--
-- Michelle's spec (29 Sep 2026) asks for one page showing every client's
-- results by CAM. Almost all of it reads tables that already exist. This
-- migration adds only the three things that were missing:
--
--   1. CRL dates that answer "how long did the client take to respond"
--   2. CAMs who can be assigned to a clinic WITHOUT a login
--   3. The list of CPT codes Momentum counts as add-on codes
--
-- Nothing here deletes or rewrites existing data.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 4 — CRL: make sure every column exists, add responded_on
-- =====================================================================
-- ⚠ WHY THIS BLOCK LOOKS DEFENSIVE. An early draft migration (from the
-- abandoned Claude Code attempt, 18 Aug) created a crl_entries table with a
-- DIFFERENT shape. Migration 025 used "create table if not exists", which
-- silently does nothing when a table of that name is already there. So the
-- live table may have either shape. Every line below is safe on both: it
-- adds what is missing and leaves what is present alone.

alter table crl_entries add column if not exists entry_date   date;
alter table crl_entries add column if not exists sent_to      text default 'cam';
alter table crl_entries add column if not exists cam_id       uuid references profiles(id) on delete set null;
alter table crl_entries add column if not exists collector_id bigint references collectors(id) on delete set null;
alter table crl_entries add column if not exists party_id     bigint references work_parties(id) on delete set null;
alter table crl_entries add column if not exists patient_name text;
alter table crl_entries add column if not exists chart_no     text;
alter table crl_entries add column if not exists insurance    text;
alter table crl_entries add column if not exists issue        text;
alter table crl_entries add column if not exists amount       numeric(12,2);
alter table crl_entries add column if not exists resolved_on  date;
alter table crl_entries add column if not exists outcome      text;
alter table crl_entries add column if not exists note         text;
alter table crl_entries add column if not exists source_ref   text;
alter table crl_entries add column if not exists created_by   uuid references profiles(id);
alter table crl_entries add column if not exists created_at   timestamptz not null default now();
alter table crl_entries add column if not exists updated_at   timestamptz not null default now();

-- NEW: the day the client answered. Michelle's "average response time" is
-- responded_on minus entry_date. Without it the CRL can count requests
-- but cannot say how quickly anyone replied.
alter table crl_entries add column if not exists responded_on date;

-- The draft shape had two required columns the CRL screen never fills.
-- Adding them first (a no-op if present) makes the next two lines safe
-- whichever shape the table has.
alter table crl_entries add column if not exists requested_from text;
alter table crl_entries add column if not exists detail         text;
alter table crl_entries alter column requested_from drop not null;
alter table crl_entries alter column detail         drop not null;

-- Any row without a request date takes the day it was created.
update crl_entries set entry_date = created_at::date where entry_date is null;
alter table crl_entries alter column entry_date set default current_date;

-- One status list that accepts both shapes' words.
alter table crl_entries drop constraint if exists crl_entries_status_check;
alter table crl_entries add constraint crl_entries_status_check
  check (status in ('open','pending','in_progress','answered','resolved','written_off','closed'));

create index if not exists crl_date   on crl_entries (entry_date desc);
create index if not exists crl_clinic on crl_entries (clinic_id, entry_date desc);


-- =====================================================================
-- BLOCK 2 of 4 — CAMs without a login
-- =====================================================================
-- cam_assignments was written to point at a LOGIN (profiles). The nine
-- CAMs have no logins, so the table has sat empty since August and no
-- screen could say who owns a client. A CAM can now be named as a
-- work_party (the same list the Assignments matrix uses) and given a
-- login later. The date history is unchanged: a client moving to another
-- CAM closes the old row and opens a new one.
--
-- RLS is unaffected: is_cam_of() still matches cam_id = the signed-in
-- user, so a CAM with a login keeps seeing only their own clinics.

alter table cam_assignments alter column cam_id drop not null;
alter table cam_assignments add column if not exists party_id bigint
  references work_parties(id) on delete restrict;
alter table cam_assignments drop constraint if exists cam_assignments_who_check;
alter table cam_assignments add constraint cam_assignments_who_check
  check (cam_id is not null or party_id is not null);

create index if not exists cam_assignments_by_party on cam_assignments (party_id);


-- =====================================================================
-- BLOCK 3 of 4 — load the CAM list from Michelle's template
-- =====================================================================
-- The same 36 pairs as migration 003 (AR_Production_Reporting_Template),
-- written in directly so it works whether or not cam_seed_map still
-- exists. Clinics whose name does not match exactly are skipped, never
-- guessed — the check query at the bottom lists them. Clinics that
-- already have a current CAM are left alone.

insert into work_parties (name, kind, note)
select distinct v.cam_name, 'person', 'Client account manager'
  from (values
  ('ProActive PT'::text, 'Katie'::text),
  ('SoCal PT', 'Gloria'),
  ('Back 2 Health PT', 'Diana'),
  ('Water & Sports', 'Lilly'),
  ('Peak PT', 'Tiffany'),
  ('Ann Steinfeld PT', 'Aya'),
  ('Peninsula PT', 'Katie'),
  ('Jamie''s PT', 'Tiffany'),
  ('Mikita PT', 'Lilly'),
  ('Rapid Rehab', 'Tiffany'),
  ('Covina Hills Sports Medicine', 'Leigh'),
  ('SPORT Clinic', 'Lilly'),
  ('Rancho Del Mar PT', 'Lilly'),
  ('Skypark PT', 'Lilly'),
  ('Physical Therapy West', 'Gloria'),
  ('Catz Physical Therapy', 'Leigh'),
  ('Complete Bal Solutions', 'Aya'),
  ('G3 Physical Therapy', 'Aya'),
  ('RISE PT', 'Bea'),
  ('Aspire PT', 'Bea'),
  ('Longevity PT', 'Tiffany'),
  ('South Pacific PT', 'Bea'),
  ('Silver Strand PT', 'Bea'),
  ('Kara Dodds & Assoc', 'Diana'),
  ('Knight PT', 'Leigh'),
  ('Azusa PT', 'Leigh'),
  ('REPAIR Sports Institute', 'Diana'),
  ('Pegasus PT', 'Gloria'),
  ('SCAR', 'Katie'),
  ('Huntington Ortho', 'Diana'),
  ('Creative Thera', 'Aya'),
  ('Star PT', 'Gloria'),
  ('Think PT', 'Aya'),
  ('Kinetix PT', 'Katie'),
  ('Dynamx PT', 'Michelle'),
  ('HSSN', 'Michelle')
  ) as v(clinic_name, cam_name)
on conflict (name) do nothing;

insert into cam_assignments (clinic_id, party_id, effective_from)
select c.id, p.id, date '2021-01-01'
  from (values
  ('ProActive PT'::text, 'Katie'::text),
  ('SoCal PT', 'Gloria'),
  ('Back 2 Health PT', 'Diana'),
  ('Water & Sports', 'Lilly'),
  ('Peak PT', 'Tiffany'),
  ('Ann Steinfeld PT', 'Aya'),
  ('Peninsula PT', 'Katie'),
  ('Jamie''s PT', 'Tiffany'),
  ('Mikita PT', 'Lilly'),
  ('Rapid Rehab', 'Tiffany'),
  ('Covina Hills Sports Medicine', 'Leigh'),
  ('SPORT Clinic', 'Lilly'),
  ('Rancho Del Mar PT', 'Lilly'),
  ('Skypark PT', 'Lilly'),
  ('Physical Therapy West', 'Gloria'),
  ('Catz Physical Therapy', 'Leigh'),
  ('Complete Bal Solutions', 'Aya'),
  ('G3 Physical Therapy', 'Aya'),
  ('RISE PT', 'Bea'),
  ('Aspire PT', 'Bea'),
  ('Longevity PT', 'Tiffany'),
  ('South Pacific PT', 'Bea'),
  ('Silver Strand PT', 'Bea'),
  ('Kara Dodds & Assoc', 'Diana'),
  ('Knight PT', 'Leigh'),
  ('Azusa PT', 'Leigh'),
  ('REPAIR Sports Institute', 'Diana'),
  ('Pegasus PT', 'Gloria'),
  ('SCAR', 'Katie'),
  ('Huntington Ortho', 'Diana'),
  ('Creative Thera', 'Aya'),
  ('Star PT', 'Gloria'),
  ('Think PT', 'Aya'),
  ('Kinetix PT', 'Katie'),
  ('Dynamx PT', 'Michelle'),
  ('HSSN', 'Michelle')
  ) as v(clinic_name, cam_name)
  join clinics      c on c.name = v.clinic_name
  join work_parties p on p.name = v.cam_name
 where not exists (
   select 1 from cam_assignments a
    where a.clinic_id = c.id and a.effective_to is null
 );


-- =====================================================================
-- BLOCK 4 of 4 — add-on CPT codes
-- =====================================================================
-- Michelle: "maintain a configurable list of CPT codes that Momentum
-- designates as add-on codes". Deliberately NOT pre-filled: the codes in
-- her mockup were placeholders, and the list is hers to approve. It is
-- edited on the Client results page by management.

create table if not exists addon_codes (
  code       text primary key,          -- '97140' — text, leading zeros are real
  label      text,
  is_active  boolean not null default true,
  note       text,
  added_by   uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table addon_codes enable row level security;

drop policy if exists addon_read  on addon_codes;
drop policy if exists addon_write on addon_codes;
create policy addon_read  on addon_codes for select using (auth.uid() is not null);
create policy addon_write on addon_codes for all using (is_admin()) with check (is_admin());


-- =====================================================================
-- CHECK — run separately, read-only
-- =====================================================================
-- 1) every CRL column the page needs (expect 6 rows):
-- select column_name from information_schema.columns
--  where table_name = 'crl_entries'
--    and column_name in ('entry_date','responded_on','resolved_on','sent_to','cam_id','party_id');
--
-- 2) clients per CAM (expect about 36 rows in total across nine CAMs):
-- select p.name as cam, count(*) as clients
--   from cam_assignments a join work_parties p on p.id = a.party_id
--  where a.effective_to is null group by p.name order by p.name;
--
-- 3) active clinics with NO CAM (these need one set on the page):
-- select c.name from clinics c
--  where c.status = 'active'
--    and not exists (select 1 from cam_assignments a
--                     where a.clinic_id = c.id and a.effective_to is null)
--  order by c.name;
