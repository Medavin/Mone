-- =====================================================================
-- MOMENTUM AR PLATFORM
-- Migration 002 — monthly facts (the data behind Monty's dashboard)
-- Run AFTER 001 has been verified. Clear the editor before pasting.
-- =====================================================================
--
-- GRAIN: clinic x month x FINANCIAL CLASS.
-- Not clinic x month. On one clinic in one month, LIEN alone was $14.81M
-- of $16.91M in AR, almost all past 120 days. At clinic level that is a
-- big number with no explanation; by financial class it is the whole
-- story, and it is what the client meeting is about.
--
-- Clinic-level totals are DERIVED by summing, never stored separately.
-- Two stored copies of the same number eventually disagree.
--
-- period_month always stores the FIRST DAY of the month.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AR BY FINANCIAL CLASS
-- ---------------------------------------------------------------------
-- Opening AND closing are both stored. Closing is not simply
-- opening + charges - payments once adjustments and transfers are in
-- play, so storing both makes the gap visible instead of hiding it.
--
-- Buckets hold AMOUNTS, not counts. That is standard AR ageing and it is
-- what the report shows. If counts are ever wanted, add a parallel set of
-- columns rather than overloading these.
--
-- NULL and 0 mean different things. NULL is "not reported"; 0 is zero.
-- Reading a month back a year later, those must not look identical.

create table if not exists ar_monthly (
  id                  bigserial primary key,
  clinic_id           bigint not null references clinics(id) on delete cascade,
  period_month        date   not null,
  financial_class_id  bigint not null references financial_classes(id),

  opening_ar          numeric(14,2),
  closing_ar          numeric(14,2),

  bucket_current      numeric(14,2),
  bucket_30           numeric(14,2),
  bucket_60           numeric(14,2),
  bucket_90           numeric(14,2),
  bucket_120_plus     numeric(14,2),

  source_batch_id     bigint,
  note                text,
  updated_at          timestamptz not null default now(),

  unique (clinic_id, period_month, financial_class_id),
  check (extract(day from period_month) = 1)
);

create index if not exists ar_monthly_clinic_period on ar_monthly (clinic_id, period_month);

-- ---------------------------------------------------------------------
-- 2. FINANCIAL ACTIVITY BY FINANCIAL CLASS
-- ---------------------------------------------------------------------
-- unapplied_payments is here deliberately. Money received but not posted
-- to a claim overstates AR and understates collections; it belongs beside
-- payments, not in a footnote.
--
-- Mix percentages are NOT stored. They are computed on read, because a
-- stored percentage goes stale the moment one figure is corrected.

create table if not exists activity_monthly (
  id                  bigserial primary key,
  clinic_id           bigint not null references clinics(id) on delete cascade,
  period_month        date   not null,
  financial_class_id  bigint not null references financial_classes(id),

  units               numeric(14,2),
  charges             numeric(14,2),
  payments            numeric(14,2),
  adjustments         numeric(14,2),
  unapplied_payments  numeric(14,2),
  visits              integer,
  new_patients        integer,

  source_batch_id     bigint,
  updated_at          timestamptz not null default now(),

  unique (clinic_id, period_month, financial_class_id),
  check (extract(day from period_month) = 1)
);

create index if not exists activity_monthly_clinic_period
  on activity_monthly (clinic_id, period_month);

-- ---------------------------------------------------------------------
-- 3. SERVICE DETAIL — CPT level
-- ---------------------------------------------------------------------
create table if not exists service_monthly (
  id                  bigserial primary key,
  clinic_id           bigint not null references clinics(id) on delete cascade,
  period_month        date   not null,
  financial_class_id  bigint not null references financial_classes(id),
  procedure_id        bigint not null references procedures(id),

  units               numeric(14,2),
  charges             numeric(14,2),

  source_batch_id     bigint,
  unique (clinic_id, period_month, financial_class_id, procedure_id),
  check (extract(day from period_month) = 1)
);

create index if not exists service_monthly_clinic_period
  on service_monthly (clinic_id, period_month);

-- ---------------------------------------------------------------------
-- 4. CARRIER AR
-- ---------------------------------------------------------------------
-- Carrier x provider, aged. NO chart number, NO visit id, NO CPT.
-- The report carries that grain; neither dashboard needs it, and pulling
-- it in would mean holding far more identifiable data than the reports
-- require. Line detail can be added later without reshaping this table.

create table if not exists carrier_ar_monthly (
  id                  bigserial primary key,
  clinic_id           bigint not null references clinics(id) on delete cascade,
  period_month        date   not null,
  carrier_id          bigint not null references carriers(id),
  provider_id         bigint references providers(id),

  bucket_current      numeric(14,2),
  bucket_30           numeric(14,2),
  bucket_60           numeric(14,2),
  bucket_90           numeric(14,2),
  bucket_120_plus     numeric(14,2),
  total_ar            numeric(14,2),

  source_batch_id     bigint,
  unique (clinic_id, period_month, carrier_id, provider_id),
  check (extract(day from period_month) = 1)
);

create index if not exists carrier_ar_clinic_period
  on carrier_ar_monthly (clinic_id, period_month);

-- ---------------------------------------------------------------------
-- 5. REFERRAL SOURCES
-- ---------------------------------------------------------------------
create table if not exists referrals_monthly (
  id                     bigserial primary key,
  clinic_id              bigint not null references clinics(id) on delete cascade,
  period_month           date   not null,
  referring_provider_id  bigint not null references referring_providers(id),

  new_patients_mtd       integer,
  new_patients_ytd       integer,
  visits_mtd             integer,

  source_batch_id        bigint,
  unique (clinic_id, period_month, referring_provider_id),
  check (extract(day from period_month) = 1)
);

create index if not exists referrals_clinic_period
  on referrals_monthly (clinic_id, period_month);

-- ---------------------------------------------------------------------
-- 6. IMPORT BATCHES
-- ---------------------------------------------------------------------
-- Every load is logged: what came in, who ran it, what was accepted and
-- what was rejected. An import that silently drops rows is worse than one
-- that fails outright, because nobody goes looking.

create table if not exists import_batches (
  id            bigserial primary key,
  source_type   text not null check (source_type in ('file','odbc')),
  source_name   text,
  report_kind   text,
  clinic_id     bigint references clinics(id),
  period_month  date,
  run_by        uuid references profiles(id),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running'
                check (status in ('running','success','partial','failed')),
  rows_read     integer default 0,
  rows_accepted integer default 0,
  rows_rejected integer default 0,
  error_detail  text
);

create index if not exists import_batches_recent on import_batches (started_at desc);

-- ---------------------------------------------------------------------
-- 7. RLS — one rule, reused everywhere
-- ---------------------------------------------------------------------
-- Read: admin, exec and ops see everything; a CAM sees only the clinics
-- they currently own. Enforced in the database, so a CAM who types
-- another CAM's clinic into the URL gets nothing back rather than a
-- hidden menu item.
--
-- Write: admin only. Imports run through the service role, which bypasses
-- RLS by design.

alter table ar_monthly          enable row level security;
alter table activity_monthly    enable row level security;
alter table service_monthly     enable row level security;
alter table carrier_ar_monthly  enable row level security;
alter table referrals_monthly   enable row level security;
alter table import_batches      enable row level security;

drop policy if exists ar_monthly_read on ar_monthly;
drop policy if exists ar_monthly_write on ar_monthly;
create policy ar_monthly_read  on ar_monthly for select using (can_see_clinic(clinic_id));
create policy ar_monthly_write on ar_monthly for all using (is_admin()) with check (is_admin());

drop policy if exists activity_monthly_read on activity_monthly;
drop policy if exists activity_monthly_write on activity_monthly;
create policy activity_monthly_read  on activity_monthly for select using (can_see_clinic(clinic_id));
create policy activity_monthly_write on activity_monthly for all using (is_admin()) with check (is_admin());

drop policy if exists service_monthly_read on service_monthly;
drop policy if exists service_monthly_write on service_monthly;
create policy service_monthly_read  on service_monthly for select using (can_see_clinic(clinic_id));
create policy service_monthly_write on service_monthly for all using (is_admin()) with check (is_admin());

drop policy if exists carrier_ar_read on carrier_ar_monthly;
drop policy if exists carrier_ar_write on carrier_ar_monthly;
create policy carrier_ar_read  on carrier_ar_monthly for select using (can_see_clinic(clinic_id));
create policy carrier_ar_write on carrier_ar_monthly for all using (is_admin()) with check (is_admin());

drop policy if exists referrals_read on referrals_monthly;
drop policy if exists referrals_write on referrals_monthly;
create policy referrals_read  on referrals_monthly for select using (can_see_clinic(clinic_id));
create policy referrals_write on referrals_monthly for all using (is_admin()) with check (is_admin());

drop policy if exists import_batches_read on import_batches;
drop policy if exists import_batches_write on import_batches;
create policy import_batches_read  on import_batches for select using (sees_all_clinics());
create policy import_batches_write on import_batches for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- 8. CONVENIENCE VIEW — clinic totals, derived not stored
-- ---------------------------------------------------------------------
create or replace view ar_monthly_clinic_total as
select
  clinic_id,
  period_month,
  sum(opening_ar)      as opening_ar,
  sum(closing_ar)      as closing_ar,
  sum(bucket_current)  as bucket_current,
  sum(bucket_30)       as bucket_30,
  sum(bucket_60)       as bucket_60,
  sum(bucket_90)       as bucket_90,
  sum(bucket_120_plus) as bucket_120_plus
from ar_monthly
group by clinic_id, period_month;

-- =====================================================================
-- VERIFY — run separately after the migration.
-- =====================================================================
-- select table_name from information_schema.tables
--   where table_schema='public' and table_name like '%monthly%'
--   order by table_name;
--
-- select tablename, count(*) as policies from pg_policies
--   where schemaname='public' group by tablename order by tablename;
--
-- Expect: ar_monthly, activity_monthly, service_monthly,
--         carrier_ar_monthly, referrals_monthly  (+ import_batches)
--         and 2 policies on each.
