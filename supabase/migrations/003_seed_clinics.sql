-- =====================================================================
-- MOne — Migration 003: seed clinics, stage the CAM mapping
-- Run AFTER 001 and 002. Clear the SQL Editor completely before pasting.
-- =====================================================================
--
-- Source: AR_Production_Reporting_Template.xlsx
-- 36 clinics with a CAM, plus MPS and Stan Ortho which sit BELOW the
-- TOTALS row on that sheet and have no CAM against them. They are loaded
-- but marked, because "below the totals row" usually means a different
-- category, and guessing which would be worse than flagging it.
--
-- No patient data here. Clinic names only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CLINICS
-- ---------------------------------------------------------------------
insert into clinics (name, status, notes) values
  ('ProActive PT'::text,                'active'::text, null::text),
  ('SoCal PT',                          'active', null),
  ('Back 2 Health PT',                  'active', null),
  ('Water & Sports',                    'active', null),
  ('Peak PT',                           'active', null),
  ('Ann Steinfeld PT',                  'active', null),
  ('Peninsula PT',                      'active', null),
  ('Jamie''s PT',                       'active', null),
  ('Mikita PT',                         'active', null),
  ('Rapid Rehab',                       'active', null),
  ('Covina Hills Sports Medicine',      'active', null),
  ('SPORT Clinic',                      'active', null),
  ('Rancho Del Mar PT',                 'active', null),
  ('Skypark PT',                        'active', null),
  ('Physical Therapy West',             'active', null),
  ('Catz Physical Therapy',             'active', null),
  ('Complete Bal Solutions',            'active', null),
  ('G3 Physical Therapy',               'active', null),
  ('RISE PT',                           'active', null),
  ('Aspire PT',                         'active', null),
  ('Longevity PT',                      'active', null),
  ('South Pacific PT',                  'active', null),
  ('Silver Strand PT',                  'active', null),
  ('Kara Dodds & Assoc',                'active', null),
  ('Knight PT',                         'active', null),
  ('Azusa PT',                          'active', null),
  ('REPAIR Sports Institute',           'active', null),
  ('Pegasus PT',                        'active', null),
  ('SCAR',                              'active', null),
  ('Huntington Ortho',                  'active', null),
  ('Creative Thera',                    'active', null),
  ('Star PT',                           'active', null),
  ('Think PT',                          'active', null),
  ('Kinetix PT',                        'active', null),
  ('Dynamx PT',                         'active', null),
  ('HSSN',                              'active', null),
  ('MPS',                               'active', 'Listed below the TOTALS row on the production template with no CAM. Category unconfirmed.'),
  ('Stan Ortho',                        'active', 'Listed below the TOTALS row on the production template with no CAM. Category unconfirmed.')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- 2. CAM MAPPING — staged, not yet assigned
-- ---------------------------------------------------------------------
-- cam_assignments.cam_id points at profiles, which points at auth.users.
-- The nine CAMs have no logins yet, so the mapping cannot be written
-- there today. Rather than lose it, park it here and resolve it in one
-- statement once the logins exist.
--
-- This table is TEMPORARY. Drop it after section 4 has been run.

create table if not exists cam_seed_map (
  clinic_name  text primary key,
  cam_name     text not null
);

alter table cam_seed_map enable row level security;

drop policy if exists cam_seed_map_admin on cam_seed_map;
create policy cam_seed_map_admin on cam_seed_map
  for all using (is_admin()) with check (is_admin());

insert into cam_seed_map (clinic_name, cam_name) values
  ('ProActive PT'::text,           'Katie'::text),
  ('SoCal PT',                     'Gloria'),
  ('Back 2 Health PT',             'Diana'),
  ('Water & Sports',               'Lilly'),
  ('Peak PT',                      'Tiffany'),
  ('Ann Steinfeld PT',             'Aya'),
  ('Peninsula PT',                 'Katie'),
  ('Jamie''s PT',                  'Tiffany'),
  ('Mikita PT',                    'Lilly'),
  ('Rapid Rehab',                  'Tiffany'),
  ('Covina Hills Sports Medicine', 'Leigh'),
  ('SPORT Clinic',                 'Lilly'),
  ('Rancho Del Mar PT',            'Lilly'),
  ('Skypark PT',                   'Lilly'),
  ('Physical Therapy West',        'Gloria'),
  ('Catz Physical Therapy',        'Leigh'),
  ('Complete Bal Solutions',       'Aya'),
  ('G3 Physical Therapy',          'Aya'),
  ('RISE PT',                      'Bea'),
  ('Aspire PT',                    'Bea'),
  ('Longevity PT',                 'Tiffany'),
  ('South Pacific PT',             'Bea'),
  ('Silver Strand PT',             'Bea'),
  ('Kara Dodds & Assoc',           'Diana'),
  ('Knight PT',                    'Leigh'),
  ('Azusa PT',                     'Leigh'),
  ('REPAIR Sports Institute',      'Diana'),
  ('Pegasus PT',                   'Gloria'),
  ('SCAR',                         'Katie'),
  ('Huntington Ortho',             'Diana'),
  ('Creative Thera',               'Aya'),
  ('Star PT',                      'Gloria'),
  ('Think PT',                     'Aya'),
  ('Kinetix PT',                   'Katie'),
  ('Dynamx PT',                    'Michelle'),
  ('HSSN',                         'Michelle')
on conflict (clinic_name) do nothing;

-- ---------------------------------------------------------------------
-- 3. VERIFY — run separately after the migration
-- ---------------------------------------------------------------------
-- select count(*) from clinics;        -- expect 38
-- select count(*) from cam_seed_map;   -- expect 36
--
-- select cam_name, count(*) as clinics
--   from cam_seed_map group by cam_name order by clinics desc, cam_name;
-- expect: Aya 5, Lilly 5, Bea 4, Diana 4, Gloria 4, Katie 4,
--         Leigh 4, Tiffany 4, Michelle 2

-- ---------------------------------------------------------------------
-- 4. LATER — resolve the mapping once the CAMs have logins
-- ---------------------------------------------------------------------
-- Do NOT run this yet. Run it after the nine CAM users exist in
-- profiles with role='cam' and full_name matching the first names above.
-- Set the date to the day the assignments actually take effect.
--
-- insert into cam_assignments (clinic_id, cam_id, effective_from)
-- select c.id, p.id, date '2026-09-01'
--   from cam_seed_map m
--   join clinics  c on c.name = m.clinic_name
--   join profiles p on p.full_name = m.cam_name and p.role = 'cam'
-- on conflict do nothing;
--
-- Then check nothing was silently skipped -- a CAM whose profile name
-- does not match will just not join, with no error:
--
-- select m.clinic_name, m.cam_name
--   from cam_seed_map m
--   left join clinics c on c.name = m.clinic_name
--   left join cam_assignments a on a.clinic_id = c.id and a.effective_to is null
--  where a.id is null;
-- -- expect zero rows
--
-- Once that returns nothing:  drop table cam_seed_map;
