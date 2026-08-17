-- AR production reporting.
--
-- DRAFT — review before applying. Nothing here has been run.
--
-- Two artefacts drive this today, both spreadsheets:
--
--   Productionsheet_<date>_<NAME>.xlsx  one row per account worked, per person,
--                                       per day — the daily work log
--   AR Production Reporting Template     clinic x CAM with actions taken,
--                                       actions due, and DOS in the AR module
--
-- The second is a roll-up of the first, so it is a view here rather than a
-- table anyone types into.

begin;

-- ---------------------------------------------------------------------------
-- 1. Daily production entries
--
-- One row per action taken against an account. Free-text columns are kept as
-- typed rather than forced into lookups: the sheets use an unsettled
-- vocabulary ("REJECTION", "TASK", "TEAMS", "5"), and normalising it before
-- that vocabulary is agreed would lose information.
-- ---------------------------------------------------------------------------

create table if not exists public.production_entries (
  id              bigint generated always as identity primary key,
  entry_date      date   not null,
  clinic_id       bigint references public.clinics (id) on delete cascade,
  clinic_label    text,            -- clinic as written on the sheet, unmatched
  worked_by       uuid   references public.profiles (id),
  worked_by_label text,            -- the name in the filename, e.g. "VEEJAY"

  insurance       text,
  carrier_id      bigint references public.carriers (id),
  patient_name    text,            -- PHI
  chart_number    text,            -- PHI
  dos_from        date,
  dos_to          date,
  dos_count       integer,
  amount          numeric(14,2),

  module_project  text,
  denial_reason   text,
  action          text,
  next_action     text,
  next_followup   date,
  collector_notes text,

  source_file     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists production_entries_clinic_date_idx
  on public.production_entries (clinic_id, entry_date desc);

create index if not exists production_entries_worker_date_idx
  on public.production_entries (worked_by, entry_date desc);

-- Outstanding follow-ups are the "actions due" figure, so index for it.
create index if not exists production_entries_followup_idx
  on public.production_entries (next_followup)
  where next_followup is not null;

comment on column public.production_entries.clinic_label is
  'Clinic name exactly as it appeared on the sheet. Kept so an import that '
  'cannot match a clinic is still visible rather than silently dropped.';


-- ---------------------------------------------------------------------------
-- 2. Row-level security
--
-- Production entries name patients, so they follow clinic visibility like
-- every other clinical table. Rows with no clinic matched are admin-only:
-- failing closed is the right default for unclassified PHI.
-- ---------------------------------------------------------------------------

alter table public.production_entries enable row level security;

create policy production_entries_select on public.production_entries
  for select to authenticated using (
    (clinic_id is not null and public.can_see_clinic(clinic_id))
    or public.is_admin()
  );

create policy production_entries_write on public.production_entries
  for all to authenticated using (
    (clinic_id is not null and public.can_see_clinic(clinic_id))
    or public.is_admin()
  ) with check (
    (clinic_id is not null and public.can_see_clinic(clinic_id))
    or public.is_admin()
  );


-- ---------------------------------------------------------------------------
-- 3. AR productivity tracker
--
-- The clinic x CAM roll-up, derived rather than maintained by hand. Left join
-- from clinics so a clinic with no production that day still appears with
-- zeroes — an absent row and a quiet day look identical otherwise, and the
-- whole point of the tracker is spotting the quiet ones.
-- ---------------------------------------------------------------------------

create or replace view public.ar_productivity as
select
  c.id                                        as clinic_id,
  c.name                                      as clinic_name,
  c.status,
  cam.full_name                               as cam_name,
  count(pe.id)                                as actions_taken,
  count(pe.id) filter (
    where pe.next_followup is not null
      and pe.next_followup <= current_date
  )                                           as actions_due,
  coalesce(sum(pe.dos_count), 0)              as dos_in_ar_module,
  coalesce(sum(pe.amount), 0)                 as amount_worked,
  max(pe.entry_date)                          as last_worked_on
from public.clinics c
left join public.cam_assignments ca
  on ca.clinic_id = c.id and ca.effective_to is null
left join public.profiles cam
  on cam.id = ca.cam_id
left join public.production_entries pe
  on pe.clinic_id = c.id
group by c.id, c.name, c.status, cam.full_name;

commit;
