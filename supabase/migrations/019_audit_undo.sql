-- =====================================================================
-- MOne — Migration 019: the activity log, and undoing an import
-- Run after 018. Paste in FOUR blocks, clearing the editor between each.
-- =====================================================================
--
-- WHY THESE TWO TOGETHER
-- They answer one question from both ends: what happened, and how do I
-- take it back. An undo without a record is just a second way to lose
-- data, and a log nobody can act on is only a record of regret.
--
-- Pravin has needed hand-written SQL twice to unpick a wrong import, and
-- three people can now reach the import screen. This is overdue.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 4 — the log
-- =====================================================================

create table if not exists audit_log (
  id          bigserial primary key,

  -- WHO DID IT, not who owns the row. MedaOne's first audit log recorded
  -- the row's owner instead of the actor, so an admin editing somebody
  -- else's record was logged against that other person. A log naming the
  -- wrong person is worse than no log, because it gets believed.
  actor_id    uuid references profiles(id) on delete set null,
  actor_name  text,

  action      text not null,          -- insert | update | delete | or an app event
  table_name  text,
  record_id   text,                   -- TEXT: some keys are integers, some uuids

  changed     text[],                 -- which columns actually moved
  before_row  jsonb,
  after_row   jsonb,
  detail      text,

  at          timestamptz not null default now()
);

create index if not exists audit_log_at    on audit_log (at desc);
create index if not exists audit_log_actor on audit_log (actor_id, at desc);
create index if not exists audit_log_table on audit_log (table_name, at desc);

-- APPEND ONLY, ON PURPOSE. There is a read policy and nothing else: no
-- insert, update or delete policy exists for anyone, including admins.
-- The trigger below writes through SECURITY DEFINER, which bypasses RLS.
-- A log that its own users can edit does not do the job it exists for.
alter table audit_log enable row level security;

drop policy if exists audit_log_read on audit_log;
create policy audit_log_read on audit_log for select using (manages_people());


-- =====================================================================
-- BLOCK 2 of 4 — the trigger that fills it
-- =====================================================================

create or replace function log_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor uuid := auth.uid();
  v_name  text;
  v_key   text;
begin
  v_name := (select p.full_name from profiles p where p.id = v_actor);

  if tg_op = 'DELETE' then
    v_key := coalesce((to_jsonb(old) ->> 'id'), '');
    insert into audit_log (actor_id, actor_name, action, table_name, record_id, before_row)
    values (v_actor, v_name, 'delete', tg_table_name, v_key, to_jsonb(old));
    return old;
  end if;

  v_key := coalesce((to_jsonb(new) ->> 'id'), '');

  if tg_op = 'INSERT' then
    insert into audit_log (actor_id, actor_name, action, table_name, record_id, after_row)
    values (v_actor, v_name, 'insert', tg_table_name, v_key, to_jsonb(new));
    return new;
  end if;

  -- UPDATE. `changed` is built as an inline array expression rather than
  -- `select ... into`, which the Supabase SQL editor mis-reads inside a
  -- quoted function body and rejects with a bogus "relation does not
  -- exist". Learned the hard way on MedaOne, four times.
  insert into audit_log (actor_id, actor_name, action, table_name, record_id,
                         changed, before_row, after_row)
  values (
    v_actor, v_name, 'update', tg_table_name, v_key,
    array(
      select k from jsonb_each(to_jsonb(new)) as n(k, v)
       where to_jsonb(new) -> k is distinct from to_jsonb(old) -> k
    ),
    to_jsonb(old), to_jsonb(new)
  );
  return new;
end;
$fn$;

-- Applied to the tables where "who changed this" is a real question.
-- Deliberately NOT the fact tables or chat: an import writes thousands of
-- rows at once and would bury everything else, and the import batch
-- already records that it happened.
do $do$
declare
  t text;
begin
  foreach t in array array[
    'clinics','clinic_people','employees','employee_rates','profiles',
    'time_policy','work_parties','work_functions','clinic_function_owners',
    'daily_assignments','portals','portal_clinics','action_types',
    'action_type_aliases','clinic_aliases','tasks','clinic_flags',
    'announcements','meeting_notes','leave_days','company_holidays',
    'import_batches'
  ]
  loop
    -- to_regclass returns null instead of raising, so a table this
    -- database has not got is skipped rather than aborting the whole loop.
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists audit_%1$s on %1$I', t);
      execute format(
        'create trigger audit_%1$s after insert or update or delete on %1$I
           for each row execute function log_row_change()', t);
    end if;
  end loop;
end
$do$;


-- =====================================================================
-- BLOCK 3 of 4 — recording things no trigger can see
-- =====================================================================
-- Downloads, exports, sign-ins, a report opened. There is no such thing
-- as a SELECT trigger in Postgres, so anything about READING has to be
-- reported by the app.

create or replace function log_event(p_action text, p_detail text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor uuid := auth.uid();
begin
  insert into audit_log (actor_id, actor_name, action, detail)
  values (
    v_actor,
    (select p.full_name from profiles p where p.id = v_actor),
    p_action,
    p_detail
  );
end;
$fn$;


-- =====================================================================
-- BLOCK 4 of 4 — undoing an import
-- =====================================================================

alter table import_batches drop constraint if exists import_batches_status_check;
alter table import_batches
  add constraint import_batches_status_check
  check (status in ('running','success','partial','failed','undone'));

alter table import_batches add column if not exists undone_at timestamptz;
alter table import_batches add column if not exists undone_by uuid references profiles(id);

-- Undo works on the CLINIC AND MONTH the batch loaded, not on a list of
-- row ids. That is deliberate: the fact tables upsert, so a re-import
-- overwrites rather than adding, and there is no such thing as "the rows
-- this batch created" once a month has been loaded twice. A month for a
-- clinic is the real unit of work, and it is what somebody means when
-- they say "undo that import".
--
-- ⚠ CONSEQUENCE, STATED PLAINLY IN THE UI: undoing removes that clinic's
-- whole month, including anything an earlier import put there.
create or replace function undo_import(p_batch_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_clinic bigint;
  v_month  date;
  v_kind   text;
  v_rows   bigint := 0;
  v_n      bigint;
  t        text;
begin
  if not is_admin() then
    raise exception 'Only an administrator can undo an import.';
  end if;

  select b.clinic_id, b.period_month, b.report_kind
    into v_clinic, v_month, v_kind
    from import_batches b where b.id = p_batch_id;

  if v_month is null then
    raise exception 'That import did not record which month it loaded, so it cannot be undone automatically.';
  end if;

  if v_kind = 'collection_actions' then
    -- The action report covers every clinic at once, so its undo is by
    -- month alone, and by the batch that wrote the rows.
    delete from collection_actions_monthly where source_batch_id = p_batch_id;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    delete from unmapped_action_rows where source_batch_id = p_batch_id;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  else
    if v_clinic is null then
      raise exception 'That import did not record which clinic it loaded, so it cannot be undone automatically.';
    end if;

    foreach t in array array[
      'ar_monthly','ar_split_monthly','activity_monthly','clinic_monthly',
      'carrier_ar_monthly','service_monthly','referrals_monthly'
    ]
    loop
      if to_regclass('public.' || t) is not null then
        execute format('delete from %I where clinic_id = $1 and period_month = $2', t)
          using v_clinic, v_month;
        get diagnostics v_n = row_count;
        v_rows := v_rows + v_n;
      end if;
    end loop;
  end if;

  update import_batches
     set status = 'undone', undone_at = now(), undone_by = auth.uid()
   where id = p_batch_id;

  perform log_event(
    'import_undone',
    format('Batch %s (%s) — removed %s rows for clinic %s, month %s',
           p_batch_id, coalesce(v_kind,'pack'), v_rows,
           coalesce(v_clinic::text,'all'), v_month)
  );

  return format('Removed %s rows.', v_rows);
end;
$fn$;


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select count(*) as audited_tables from pg_trigger
--  where tgname like 'audit_%' and not tgisinternal;      -- expect ~22
--
-- select proname from pg_proc
--  where proname in ('log_row_change','log_event','undo_import');   -- 3 rows
--
-- select tablename, policyname, cmd from pg_policies where tablename = 'audit_log';
--   -> exactly ONE row, a SELECT policy. No insert/update/delete policy
--      should exist: the log is append-only through the trigger.
