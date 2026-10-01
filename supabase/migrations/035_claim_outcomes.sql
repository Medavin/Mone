-- =====================================================================
-- MBOne — Migration 035: claim outcomes per client per month
-- Run after 034. ONE block.
-- =====================================================================
--
-- From Prompt's Remit Allocation Report: how many claims came back from
-- payers, how many were DENIED, and how many earlier payments were
-- reversed — by month of service. Counts and dollars only: the claim
-- numbers are used in the browser to count distinct claims and are never
-- saved. Denial REASONS live in `denials` (from a report that carries
-- reason codes); this table is the rate, so the two never double count.

create table if not exists claim_outcomes_monthly (
  id              bigserial primary key,
  clinic_id       bigint not null references clinics(id) on delete cascade,
  period_month    date   not null,
  claims          integer not null,          -- distinct claims with a remit
  denied_claims   integer not null,
  denied_amount   numeric(14,2),             -- billed amount on the denied claims
  reversals       integer,                   -- earlier payments taken back
  paid            numeric(14,2),             -- insurance paid on these claims
  source          text,
  source_batch_id bigint,
  updated_at      timestamptz not null default now(),
  unique (clinic_id, period_month),
  check (extract(day from period_month) = 1)
);

alter table claim_outcomes_monthly enable row level security;
drop policy if exists com_read  on claim_outcomes_monthly;
drop policy if exists com_write on claim_outcomes_monthly;
create policy com_read  on claim_outcomes_monthly for select using (can_see_clinic(clinic_id));
create policy com_write on claim_outcomes_monthly for all using (is_admin()) with check (is_admin());

-- CHECK — expect 2 rows:
-- select policyname from pg_policies where tablename = 'claim_outcomes_monthly';
