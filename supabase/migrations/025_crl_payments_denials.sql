-- =====================================================================
-- MBOne — Migration 025: CRL, reported payments, denials
-- Run after 024. Paste in FOUR blocks.
-- =====================================================================
--
-- ⚠⚠ READ THIS FIRST. THESE THREE TABLES HOLD PATIENT DATA.
--
-- Everything in MBOne until now has been aggregates: clinic totals, aging
-- buckets, hours worked. None of it identifies a patient.
--
-- These three do. A patient name, against a clinic, with an insurer and a
-- dollar amount, IS protected health information. That changes what the
-- hosting has to be — this application currently runs on infrastructure
-- with no business associate agreement in place, and loading real names
-- into these tables before that is settled would be a reportable breach,
-- not a technical shortcut.
--
-- So: build now, load test data now, and DO NOT put real patient names in
-- until the hosting move is done. Every one of the three screens says so
-- on the page, and `patient_name` is nullable everywhere on purpose —
-- every report below works with the name blank.
--
-- ⚠ ALSO: none of this comes from the monthly workbook. All three arrive
-- with the AdvancedMD feed. Expect the field names to shift once the real
-- reports are seen — that is why every table carries `source_ref` and a
-- free-text `note`, so an unexpected column has somewhere to land instead
-- of forcing a migration.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 4 — the CRL
-- =====================================================================
-- Claims escalated out of the normal queue: sent to a CAM, or sent to a
-- collector. Michelle wants it sliced by collector, by CAM, by clinic and
-- by date, which is four groupings of one table rather than four tables.

create table if not exists crl_entries (
  id            bigserial primary key,

  entry_date    date not null,
  clinic_id     bigint references clinics(id) on delete set null,

  -- Who it went to, and to whom specifically. `sent_to` is the routing;
  -- the two id columns say which person, when known.
  sent_to       text not null default 'cam'
                check (sent_to in ('cam','collector','client','other')),
  cam_id        uuid   references profiles(id) on delete set null,
  collector_id  bigint references collectors(id) on delete set null,
  party_id      bigint references work_parties(id) on delete set null,

  -- ⚠ PHI. Nullable, and every report works without it.
  patient_name  text,
  chart_no      text,

  insurance     text,
  issue         text,
  amount        numeric(12,2),

  status        text not null default 'open'
                check (status in ('open','in_progress','resolved','written_off','closed')),
  resolved_on   date,
  outcome       text,
  note          text,

  source_ref    text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists crl_date   on crl_entries (entry_date desc);
create index if not exists crl_clinic on crl_entries (clinic_id, entry_date desc);
create index if not exists crl_cam    on crl_entries (cam_id);
create index if not exists crl_coll   on crl_entries (collector_id);


-- =====================================================================
-- BLOCK 2 of 4 — reported payments
-- =====================================================================
-- What a clinic says it received, against what has actually been applied.
-- The gap between the two is the whole point of the table: a paper cheque
-- reported on Monday and applied on Friday is money that exists but is not
-- yet in the figures, and somebody is asked about it every week.

create table if not exists reported_payments (
  id            bigserial primary key,

  reported_on   date not null,
  clinic_id     bigint references clinics(id) on delete set null,
  cam_id        uuid   references profiles(id) on delete set null,

  method        text not null default 'check'
                check (method in ('check','eft','era','ehr','card','cash','other')),

  amount        numeric(12,2) not null,
  reference     text,                      -- cheque number, EFT trace, batch id
  payer         text,

  status        text not null default 'pending'
                check (status in ('pending','applied','partial','rejected','returned')),
  applied_on    date,
  applied_amount numeric(12,2),

  -- ⚠ PHI when filled. Usually blank — most reported payments are a batch.
  patient_name  text,
  chart_no      text,

  note          text,
  source_ref    text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- An applied payment must say when and how much. Marking something
  -- applied with neither is how a reconciliation quietly stops meaning
  -- anything.
  check (status <> 'applied' or (applied_on is not null and applied_amount is not null))
);

create index if not exists rp_date   on reported_payments (reported_on desc);
create index if not exists rp_clinic on reported_payments (clinic_id, reported_on desc);
create index if not exists rp_status on reported_payments (status);


-- =====================================================================
-- BLOCK 3 of 4 — denials
-- =====================================================================
-- From AdvancedMD's Denial Module. Michelle's top request is a denial
-- category summary per client per month, which is this table grouped two
-- ways.

create table if not exists denials (
  id            bigserial primary key,

  denial_date   date not null,
  period_month  date,                      -- first of month, for the monthly summary
  clinic_id     bigint references clinics(id) on delete set null,
  cam_id        uuid   references profiles(id) on delete set null,

  denial_code   text,                      -- the payer's code, as given
  denial_type   text,                      -- the category it rolls up to
  carrier       text,

  -- ⚠ PHI. Nullable; the summary Michelle asked for never needs it.
  patient_name  text,
  chart_no      text,

  amount        numeric(12,2),
  claim_no      text,
  service_date  date,

  status        text not null default 'open'
                check (status in ('open','appealed','corrected','paid','written_off','closed')),
  worked_on     date,
  note          text,

  source_ref    text,
  created_at    timestamptz not null default now()
);

create index if not exists den_month  on denials (period_month);
create index if not exists den_clinic on denials (clinic_id, period_month);
create index if not exists den_code   on denials (denial_code);

-- The reference list of codes, so a summary groups by something stable
-- rather than by whatever the payer wrote that day.
create table if not exists denial_codes (
  code        text primary key,
  label       text not null,
  category    text,
  preventable boolean,                     -- can the front desk stop it happening
  note        text
);


-- =====================================================================
-- BLOCK 4 of 4 — row level security
-- =====================================================================
-- Follows the clinic, exactly like every other clinic-bound table: if you
-- can see the clinic, you can see its claims. A CAM sees their own
-- clinics, and nobody else's.

alter table crl_entries       enable row level security;
alter table reported_payments enable row level security;
alter table denials           enable row level security;
alter table denial_codes      enable row level security;

drop policy if exists crl_read  on crl_entries;
drop policy if exists crl_write on crl_entries;
create policy crl_read  on crl_entries for select
  using (clinic_id is null or can_see_clinic(clinic_id));
create policy crl_write on crl_entries for all
  using (is_admin()) with check (is_admin());

drop policy if exists rp_read  on reported_payments;
drop policy if exists rp_write on reported_payments;
create policy rp_read  on reported_payments for select
  using (clinic_id is null or can_see_clinic(clinic_id));
create policy rp_write on reported_payments for all
  using (is_admin()) with check (is_admin());

drop policy if exists den_read  on denials;
drop policy if exists den_write on denials;
create policy den_read  on denials for select
  using (clinic_id is null or can_see_clinic(clinic_id));
create policy den_write on denials for all
  using (is_admin()) with check (is_admin());

drop policy if exists dc_read  on denial_codes;
drop policy if exists dc_write on denial_codes;
create policy dc_read  on denial_codes for select using (auth.uid() is not null);
create policy dc_write on denial_codes for all
  using (is_admin()) with check (is_admin());


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select tablename, policyname from pg_policies
--  where tablename in ('crl_entries','reported_payments','denials','denial_codes')
--  order by tablename;                                            -- 8 rows
