-- =====================================================================
-- MBOne — Migration 033: patients over 25 visits (Michelle's card)
-- Run after 032. ONE block.
-- =====================================================================
--
-- Two numbers per client per year: patients seen, and patients with more
-- than 25 completed visits. NO patient identifiers — the counting happens
-- in the browser while the Prompt file is read, and only the two counts
-- are saved. `as_of` says how far into the year the count goes.

create table if not exists patient_visit_counts (
  id              bigserial primary key,
  clinic_id       bigint not null references clinics(id) on delete cascade,
  year            integer not null,
  as_of           date not null,
  patients        integer not null,
  over_threshold  integer not null,
  threshold       integer not null default 25,
  source          text,
  source_batch_id bigint,
  updated_at      timestamptz not null default now(),
  unique (clinic_id, year)
);

alter table patient_visit_counts enable row level security;
drop policy if exists pvc_read  on patient_visit_counts;
drop policy if exists pvc_write on patient_visit_counts;
create policy pvc_read  on patient_visit_counts for select using (can_see_clinic(clinic_id));
create policy pvc_write on patient_visit_counts for all using (is_admin()) with check (is_admin());

-- CHECK — expect 2 rows:
-- select policyname from pg_policies where tablename = 'patient_visit_counts';
