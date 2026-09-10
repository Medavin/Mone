-- =====================================================================
-- MBOne — Migration 029: data sources and the intake door
-- Run after 028. Paste in FOUR blocks.
-- =====================================================================
--
-- WHAT THIS SOLVES, AND WHAT IT DELIBERATELY DOES NOT
--
-- Chris Williamson confirmed ODBC is the path, at a weekly cadence, and
-- said it would be "direct odbc queries from your application". That last
-- part cannot happen: MBOne is serverless — no persistent process, no
-- ODBC driver, no route into Momentum's network.
--
-- So something small runs the query where the database is reachable, and
-- posts the rows here. The split is deliberate:
--
--   the RUNNER holds the credentials and the driver, and nothing else;
--   MBOne holds the queries, the schedule, the mapping and the checks.
--
-- That way the interesting part is visible and changeable in the app, and
-- the part holding secrets is small enough to read in one sitting.
--
-- ⚠ NO CREDENTIALS ARE STORED HERE. `connection_hint` is a note to a human
-- — "the AMD ODBC DSN on the reporting box" — never a connection string.
-- The same argument as the portal directory: anything in this database is
-- readable by anyone with this database.
--
-- ⚠ AND WHEN AMD MOVES TO SNOWFLAKE, MBOne could query it directly over
-- HTTPS with no runner at all. Which is why `kind` exists and why the
-- queries live here rather than in the runner: the SQL survives the move.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 4 — the sources
-- =====================================================================

create table if not exists data_sources (
  id              bigserial primary key,

  name            text not null unique,
  kind            text not null default 'odbc'
                  check (kind in ('odbc','snowflake','fabric','api','folder','manual')),

  connection_hint text,                   -- a note to a person, NEVER a secret
  vault_ref       text,                   -- where the real credentials live
  owner_contact   text,                   -- who to ask when it stops working

  cadence         text not null default 'weekly'
                  check (cadence in ('daily','weekly','monthly','on_demand')),

  is_active       boolean not null default true,
  note            text,

  last_seen_at    timestamptz,            -- last time anything arrived from it
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Which clinics this source covers. Chris said ODBC reaches only some
-- clients, so MBOne has to know which ones still arrive as monthly packs.
create table if not exists data_source_clinics (
  id         bigserial primary key,
  source_id  bigint not null references data_sources(id) on delete cascade,
  clinic_id  bigint not null references clinics(id) on delete cascade,
  office_key text,                        -- the AMD office key, when known
  unique (source_id, clinic_id)
);


-- =====================================================================
-- BLOCK 2 of 4 — the queries
-- =====================================================================
-- One row per thing we want pulled. The SQL lives HERE, not in the runner,
-- so it can be read, changed and reviewed without touching the machine
-- that holds the credentials.

create table if not exists source_queries (
  id            bigserial primary key,
  source_id     bigint not null references data_sources(id) on delete cascade,

  name          text not null,
  target_table  text not null,            -- one of the import engine's targets

  sql_text      text,                     -- what to run; :from and :to are substituted
  cadence       text not null default 'weekly'
                check (cadence in ('daily','weekly','monthly','on_demand')),

  -- Reuses a saved import mapping, so a query result is treated exactly
  -- like a spreadsheet of the same shape. One path, not two.
  profile_id    bigint references import_profiles(id) on delete set null,

  is_active     boolean not null default true,
  last_run_at   timestamptz,
  last_rows     integer,
  last_error    text,
  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (source_id, name)
);

create index if not exists source_queries_source on source_queries (source_id, is_active);


-- =====================================================================
-- BLOCK 3 of 4 — keys for the intake door
-- =====================================================================
-- Each runner gets its own key so one can be revoked without stopping the
-- others. Only a HASH is stored: a key readable from the database is a key
-- that leaks with the database.

create extension if not exists pgcrypto;

create table if not exists ingest_keys (
  id          bigserial primary key,
  source_id   bigint references data_sources(id) on delete cascade,
  label       text not null,
  key_hash    text not null unique,       -- sha256 of the key, hex
  is_active   boolean not null default true,
  last_used_at timestamptz,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

-- The endpoint calls this. SECURITY DEFINER so the caller needs no rights
-- on the table itself, and it returns only the source id — never the row,
-- so a wrong key learns nothing except that it was wrong.
create or replace function verify_ingest_key(p_key text)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hash text := encode(digest(p_key, 'sha256'), 'hex');
  v_id   bigint;
begin
  v_id := (select k.source_id from ingest_keys k
            where k.key_hash = v_hash and k.is_active and k.revoked_at is null);

  if v_id is not null then
    update ingest_keys set last_used_at = now() where key_hash = v_hash;
  end if;

  return v_id;
end;
$fn$;


-- =====================================================================
-- BLOCK 4 of 4 — row level security
-- =====================================================================

alter table data_sources        enable row level security;
alter table data_source_clinics enable row level security;
alter table source_queries      enable row level security;
alter table ingest_keys         enable row level security;

drop policy if exists ds_read  on data_sources;
drop policy if exists ds_write on data_sources;
create policy ds_read  on data_sources for select using (auth.uid() is not null);
create policy ds_write on data_sources for all using (is_admin()) with check (is_admin());

drop policy if exists dsc_read  on data_source_clinics;
drop policy if exists dsc_write on data_source_clinics;
create policy dsc_read  on data_source_clinics for select using (auth.uid() is not null);
create policy dsc_write on data_source_clinics for all using (is_admin()) with check (is_admin());

drop policy if exists sq_read  on source_queries;
drop policy if exists sq_write on source_queries;
create policy sq_read  on source_queries for select using (auth.uid() is not null);
create policy sq_write on source_queries for all using (is_admin()) with check (is_admin());

-- Keys are management-only, and the hash is all there is to see anyway.
drop policy if exists ik_read  on ingest_keys;
drop policy if exists ik_write on ingest_keys;
create policy ik_read  on ingest_keys for select using (is_admin());
create policy ik_write on ingest_keys for all using (is_admin()) with check (is_admin());


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select proname from pg_proc where proname = 'verify_ingest_key';   -- 1
-- select tablename, policyname from pg_policies
--  where tablename in ('data_sources','data_source_clinics','source_queries','ingest_keys')
--  order by tablename;                                               -- 8 rows
