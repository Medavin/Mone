-- Schema needed for the clinic dashboard.
--
-- DRAFT — review before applying. Nothing here has been run against the
-- database. Apply with `npx supabase db push` once you're happy with it.
--
-- Covers the dashboard fields that have no columns behind them today:
-- clinic contact details, daily stats, account-level AR (which every
-- "number of accounts" figure depends on), collector routing, and the CRL.
--
-- Naming follows the existing schema: snake_case, `period_month`/date columns
-- as `date`, money as numeric(14,2), address fields named as in
-- `referring_providers` (street/city/state/zip).

begin;

-- ---------------------------------------------------------------------------
-- 1. Clinic contact details
-- ---------------------------------------------------------------------------

alter table public.clinics
  add column if not exists street         text,
  add column if not exists city           text,
  add column if not exists state          text,
  add column if not exists zip            text,
  add column if not exists phone          text,
  add column if not exists email          text,
  add column if not exists contact_name   text,
  add column if not exists contact_title  text;

comment on column public.clinics.contact_name is
  'Primary day-to-day contact at the clinic.';


-- ---------------------------------------------------------------------------
-- 2. Daily activity
--
-- Every existing fact table is keyed by period_month, so daily figures cannot
-- be derived from them. This mirrors activity_monthly at day grain; roll it up
-- to months rather than maintaining both by hand.
-- ---------------------------------------------------------------------------

create table if not exists public.activity_daily (
  id                  bigint generated always as identity primary key,
  clinic_id           bigint not null references public.clinics (id) on delete cascade,
  financial_class_id  bigint not null references public.financial_classes (id),
  activity_date       date   not null,
  charges             numeric(14,2),
  payments            numeric(14,2),
  adjustments         numeric(14,2),
  unapplied_payments  numeric(14,2),
  visits              integer,
  units               integer,
  new_patients        integer,
  claims_submitted    integer,          -- "claims in module"
  source_batch_id     bigint references public.import_batches (id),
  updated_at          timestamptz not null default now(),
  unique (clinic_id, financial_class_id, activity_date)
);

create index if not exists activity_daily_clinic_date_idx
  on public.activity_daily (clinic_id, activity_date desc);


-- ---------------------------------------------------------------------------
-- 3. Account-level AR
--
-- The keystone. AR is currently stored as bucket *amounts* only, so no
-- "number of accounts" figure is derivable. One row per account per snapshot
-- month, which is also what the CRL and collector routing hang off.
-- ---------------------------------------------------------------------------

create table if not exists public.accounts (
  id                  bigint generated always as identity primary key,
  clinic_id           bigint not null references public.clinics (id) on delete cascade,
  account_number      text   not null,
  patient_name        text,
  as_of_month         date   not null,   -- snapshot month, matches period_month
  balance             numeric(14,2) not null default 0,
  aging_bucket        text   not null
                        check (aging_bucket in
                          ('current','30','60','90','120_plus')),
  financial_class_id  bigint references public.financial_classes (id),
  carrier_id          bigint references public.carriers (id),
  provider_id         bigint references public.providers (id),
  last_activity_date  date,
  source_batch_id     bigint references public.import_batches (id),
  updated_at          timestamptz not null default now(),
  unique (clinic_id, account_number, as_of_month)
);

create index if not exists accounts_clinic_month_idx
  on public.accounts (clinic_id, as_of_month desc);

create index if not exists accounts_bucket_idx
  on public.accounts (clinic_id, as_of_month, aging_bucket);


-- ---------------------------------------------------------------------------
-- 4. Collectors and account routing
--
-- "Sent to CAM" and "sent to collector" are the same act with a different
-- destination, so they share a table. cam_assignments stays as-is: it records
-- which CAM owns a clinic, not which accounts were routed to them.
-- ---------------------------------------------------------------------------

create table if not exists public.collectors (
  id         bigint generated always as identity primary key,
  name       text    not null,
  email      text,
  phone      text,
  is_active  boolean not null default true
);

create table if not exists public.account_routing (
  id            bigint generated always as identity primary key,
  account_id    bigint not null references public.accounts (id) on delete cascade,
  clinic_id     bigint not null references public.clinics (id) on delete cascade,
  destination   text   not null check (destination in ('cam','collector')),
  collector_id  bigint references public.collectors (id),
  amount        numeric(14,2) not null default 0,  -- balance at time of routing
  sent_at       timestamptz not null default now(),
  sent_by       uuid references public.profiles (id),
  returned_at   timestamptz,
  note          text,
  -- A collector is required when routing to one, and meaningless otherwise.
  constraint account_routing_collector_required check (
    (destination = 'collector' and collector_id is not null) or
    (destination = 'cam'       and collector_id is null)
  )
);

create index if not exists account_routing_clinic_idx
  on public.account_routing (clinic_id, destination, sent_at desc);


-- ---------------------------------------------------------------------------
-- 5. Client Request Log (CRL)
--
-- Accounts in AR that need information from the clinic or the patient before
-- they can progress. Entered in the app rather than imported.
-- ---------------------------------------------------------------------------

create table if not exists public.crl_entries (
  id              bigint generated always as identity primary key,
  clinic_id       bigint not null references public.clinics (id) on delete cascade,
  account_id      bigint references public.accounts (id) on delete set null,
  requested_from  text   not null check (requested_from in ('clinic','patient')),
  request_type    text,                        -- e.g. insurance, demographics, auth
  detail          text   not null,
  status          text   not null default 'open'
                    check (status in ('open','pending','answered','closed')),
  opened_at       timestamptz not null default now(),
  opened_by       uuid references public.profiles (id),
  responded_at    timestamptz,
  closed_at       timestamptz,
  updated_at      timestamptz not null default now()
);

create index if not exists crl_entries_clinic_status_idx
  on public.crl_entries (clinic_id, status, opened_at desc);


-- ---------------------------------------------------------------------------
-- 6. Row-level security
--
-- Mirrors the existing model: visibility flows through can_see_clinic(), so
-- CAMs keep seeing only their assigned clinics. Reads are open to anyone who
-- can see the clinic; writes on imported tables are admin-only, while the CRL
-- is written by whoever can see the clinic.
-- ---------------------------------------------------------------------------

alter table public.activity_daily  enable row level security;
alter table public.accounts        enable row level security;
alter table public.account_routing enable row level security;
alter table public.crl_entries     enable row level security;
alter table public.collectors      enable row level security;

-- Imported data: read if you can see the clinic, write only as admin.
create policy activity_daily_select on public.activity_daily
  for select using (public.can_see_clinic(clinic_id));
create policy activity_daily_write on public.activity_daily
  for all using (public.is_admin()) with check (public.is_admin());

create policy accounts_select on public.accounts
  for select using (public.can_see_clinic(clinic_id));
create policy accounts_write on public.accounts
  for all using (public.is_admin()) with check (public.is_admin());

-- Workflow data: written by anyone who can see the clinic.
create policy account_routing_select on public.account_routing
  for select using (public.can_see_clinic(clinic_id));
create policy account_routing_write on public.account_routing
  for all using (public.can_see_clinic(clinic_id))
  with check (public.can_see_clinic(clinic_id));

create policy crl_entries_select on public.crl_entries
  for select using (public.can_see_clinic(clinic_id));
create policy crl_entries_write on public.crl_entries
  for all using (public.can_see_clinic(clinic_id))
  with check (public.can_see_clinic(clinic_id));

-- Reference data: readable by any signed-in user, admin-managed.
create policy collectors_select on public.collectors
  for select to authenticated using (true);
create policy collectors_write on public.collectors
  for all using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------------
-- 7. Dashboard rollup
--
-- The dashboard needs counts and amounts per clinic per month. Doing it in a
-- view keeps the aggregation in one place.
-- ---------------------------------------------------------------------------

create or replace view public.account_summary_monthly as
select
  a.clinic_id,
  a.as_of_month,
  count(*)                                                        as account_count,
  sum(a.balance)                                                  as total_balance,
  count(*) filter (where a.aging_bucket = '120_plus')             as accounts_120_plus,
  sum(a.balance) filter (where a.aging_bucket = '120_plus')       as amount_120_plus,
  count(*) filter (where r.destination = 'cam')                   as accounts_sent_to_cam,
  sum(r.amount) filter (where r.destination = 'cam')              as amount_sent_to_cam,
  count(*) filter (where r.destination = 'collector')             as accounts_sent_to_collector,
  sum(r.amount) filter (where r.destination = 'collector')        as amount_sent_to_collector
from public.accounts a
left join public.account_routing r
  on r.account_id = a.id and r.returned_at is null
group by a.clinic_id, a.as_of_month;

commit;
