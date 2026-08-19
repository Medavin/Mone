-- =====================================================================
-- MOne — Migration 005: complete the financial classes, add the
--                       clinic-level monthly tables
-- Run after 004. Clear the SQL Editor completely before pasting.
-- =====================================================================
--
-- WHY THIS EXISTS
-- Reading the Rapid Rehab report properly turned up two things:
--
-- 1. There are TWELVE financial classes, not the five that were seeded
--    from a partial view of the file.
--
-- 2. Some figures in the monthly pack exist only at CLINIC level and
--    cannot be split by financial class. Opening A/R, unapplied payments
--    and the patient-balance figures all come from the Management
--    Summary sheet, which has no financial-class breakdown at all.
--    Storing them per financial class would mean inventing a split that
--    the source does not contain.
--
--    So they get their own table at their own grain. A table should hold
--    figures at the grain they actually exist at, not at the grain that
--    happens to be convenient.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE SEVEN MISSING FINANCIAL CLASSES
-- ---------------------------------------------------------------------
insert into financial_classes (code, name, sort_order) values
  ('1M'::text, 'MEDICARE'::text,               60),
  ('1O',       'PRIV INS-OUT OF NETWORK',      70),
  ('1P',       'PRIVATE INSURANCE',            80),
  ('1S',       'SELF PAY',                     90),
  ('1U',       'URS',                         100),
  ('1W',       'WORKCOMP',                    110),
  ('XX',       'UNCLASSIFIED',                999)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 2. CLINIC-LEVEL MONTHLY FIGURES  (the Management Summary sheet)
-- ---------------------------------------------------------------------
-- One row per clinic per month. Everything here is reported for the
-- clinic as a whole.
--
-- Opening and closing A/R are both stored. The report also gives the
-- change between them, and it is stored rather than derived, because
-- when it does NOT equal closing minus opening that discrepancy is
-- itself worth seeing rather than silently smoothing over.
--
-- Year-to-date figures are deliberately NOT stored. They are the sum of
-- the months already in the table, and a stored YTD goes stale the
-- moment an earlier month is corrected.

create table if not exists clinic_monthly (
  id                       bigserial primary key,
  clinic_id                bigint not null references clinics(id) on delete cascade,
  period_month             date   not null,

  opening_ar               numeric(14,2),
  closing_ar               numeric(14,2),
  ar_change                numeric(14,2),

  charges                  numeric(14,2),
  adjustments              numeric(14,2),
  payments_patient         numeric(14,2),
  payments_insurance       numeric(14,2),

  patients_with_balance    integer,
  average_patient_balance  numeric(14,2),

  source_batch_id          bigint,
  note                     text,
  updated_at               timestamptz not null default now(),

  unique (clinic_id, period_month),
  check (extract(day from period_month) = 1)
);

create index if not exists clinic_monthly_period on clinic_monthly (period_month);

-- ---------------------------------------------------------------------
-- 3. A/R SPLIT BY INSURANCE vs PATIENT  (Current A/R block)
-- ---------------------------------------------------------------------
-- The report ages A/R twice over: once by financial class, and once by
-- who owes the money. They are different cuts of the same total, not a
-- hierarchy, so this is its own table rather than more columns bolted
-- onto ar_monthly.
--
-- payer_type is text + CHECK for the same reason role is: an enum cannot
-- gain a value and use it inside one transaction.
--
-- Unapplied payments live here because the report splits them the same
-- way, insurance and patient. They arrive NEGATIVE in the source and are
-- stored exactly as reported -- money received but not yet posted, which
-- reduces the net balance.

create table if not exists ar_split_monthly (
  id                bigserial primary key,
  clinic_id         bigint not null references clinics(id) on delete cascade,
  period_month      date   not null,
  payer_type        text   not null check (payer_type in ('insurance','patient')),

  bucket_current    numeric(14,2),
  bucket_30         numeric(14,2),
  bucket_60         numeric(14,2),
  bucket_90         numeric(14,2),
  bucket_120_plus   numeric(14,2),
  total_ar          numeric(14,2),
  unapplied         numeric(14,2),
  net_ar            numeric(14,2),

  source_batch_id   bigint,
  unique (clinic_id, period_month, payer_type),
  check (extract(day from period_month) = 1)
);

create index if not exists ar_split_period on ar_split_monthly (clinic_id, period_month);

-- ---------------------------------------------------------------------
-- 4. REMOVE THE COLUMN THAT CANNOT BE FILLED
-- ---------------------------------------------------------------------
-- activity_monthly.unapplied_payments was specified at clinic x month x
-- financial class. The source reports unapplied at clinic level only.
-- Keeping a column that can never be populated is worse than not having
-- it: someone eventually reads the NULLs as zero.
--
-- The table is empty, so nothing is lost.

alter table activity_monthly drop column if exists unapplied_payments;

-- NOTE on ar_monthly.opening_ar: it stays, and stays NULL on file
-- import, because the Financial Class A/R sheet reports closing balances
-- only. Clinic-level opening A/R comes from clinic_monthly. If the ODBC
-- feed can produce opening balances per financial class later, the
-- column is already there to receive them.

-- ---------------------------------------------------------------------
-- 5. RLS — same rule as every other clinic-scoped table
-- ---------------------------------------------------------------------
alter table clinic_monthly   enable row level security;
alter table ar_split_monthly enable row level security;

drop policy if exists clinic_monthly_read  on clinic_monthly;
drop policy if exists clinic_monthly_write on clinic_monthly;
create policy clinic_monthly_read  on clinic_monthly
  for select using (can_see_clinic(clinic_id));
create policy clinic_monthly_write on clinic_monthly
  for all using (is_admin()) with check (is_admin());

drop policy if exists ar_split_read  on ar_split_monthly;
drop policy if exists ar_split_write on ar_split_monthly;
create policy ar_split_read  on ar_split_monthly
  for select using (can_see_clinic(clinic_id));
create policy ar_split_write on ar_split_monthly
  for all using (is_admin()) with check (is_admin());

-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select code, name from financial_classes order by sort_order;
--   expect 12 rows, ending with XX UNCLASSIFIED
--
-- select column_name from information_schema.columns
--   where table_name = 'activity_monthly' order by column_name;
--   expect NO unapplied_payments
--
-- Then run supabase/VERIFY.sql -- tables should now be 17.
