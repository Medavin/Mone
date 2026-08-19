-- =====================================================================
-- MOne — Migration 016: clinic profile and the people at each clinic
-- Run after 015. Paste in TWO blocks, clearing the editor between them.
-- =====================================================================
--
-- WHY
-- A clinic in MOne has been nothing but a name, a code and a pile of
-- figures. But the question asked in a meeting is rarely "what is the
-- 120+ balance" on its own — it is "who do I call about it", and that has
-- lived in somebody's inbox.
--
-- Two shapes, deliberately separate:
--
--   * the clinic's OWN details (address, phone, portal, EIN, NPI) go on
--     `clinics`, because there is exactly one of each; and
--
--   * PEOPLE go in their own table, because a clinic has several — an
--     office manager, a billing contact, and a list of treating providers
--     — and that list changes without the clinic changing.
--
-- Providers are held here as people, NOT as the `referring_providers` the
-- imports create. Those are whoever REFERRED a patient, which is a
-- different thing from who works at the clinic, and merging the two would
-- quietly corrupt the referral report.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 2 — the clinic's own details
-- =====================================================================

alter table clinics add column if not exists address_line1 text;
alter table clinics add column if not exists address_line2 text;
alter table clinics add column if not exists city          text;
alter table clinics add column if not exists state         text;
alter table clinics add column if not exists postal_code   text;
alter table clinics add column if not exists phone         text;
alter table clinics add column if not exists fax           text;
alter table clinics add column if not exists email         text;
alter table clinics add column if not exists website       text;

-- Identifiers a biller actually needs to hand: the group NPI and the tax
-- id. Text, not numbers -- leading zeros are real and must survive.
alter table clinics add column if not exists group_npi     text;
alter table clinics add column if not exists tax_id        text;

-- Which AdvancedMD office this clinic is, so the ODBC work has something
-- to key on later. Chris's folder names looked like AMD office keys.
alter table clinics add column if not exists amd_office_key text;

alter table clinics add column if not exists specialty     text;
alter table clinics add column if not exists timezone      text;
alter table clinics add column if not exists profile_note  text;


-- =====================================================================
-- BLOCK 2 of 2 — the people at the clinic
-- =====================================================================

create table if not exists clinic_people (
  id          bigserial primary key,
  clinic_id   bigint not null references clinics(id) on delete cascade,

  -- 'contact' is who you ring; 'provider' is who treats. Kept in one table
  -- because both are "a person at this clinic" and both need the same
  -- fields -- separating them would mean two screens for one idea.
  kind        text not null default 'contact'
              check (kind in ('contact','provider','owner','front_desk','billing','other')),

  full_name   text not null,
  title       text,
  credential  text,               -- PT, DPT, OT, MD ...
  npi         text,               -- individual NPI, text so leading zeros survive
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  is_active   boolean not null default true,
  note        text,
  sort_order  integer not null default 100,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists clinic_people_clinic on clinic_people (clinic_id, kind, sort_order);

-- One primary contact per clinic per kind. A second "primary" billing
-- contact is not a preference, it is a mistake, and it should be refused
-- rather than shown twice on the page.
create unique index if not exists clinic_people_one_primary
  on clinic_people (clinic_id, kind) where is_primary;

alter table clinic_people enable row level security;

-- Read follows the clinic: if you can see the clinic, you can see who to
-- ring about it. Only management edits.
drop policy if exists clinic_people_read  on clinic_people;
drop policy if exists clinic_people_write on clinic_people;

create policy clinic_people_read on clinic_people for select
  using (can_see_clinic(clinic_id));

create policy clinic_people_write on clinic_people for all
  using (is_admin()) with check (is_admin());


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select column_name from information_schema.columns
--  where table_name = 'clinics' and column_name in
--    ('address_line1','city','phone','group_npi','amd_office_key')
--  order by column_name;                 -- expect 5 rows
--
-- select tablename, policyname from pg_policies
--  where tablename = 'clinic_people';    -- expect 2 rows
