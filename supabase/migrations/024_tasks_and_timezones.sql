-- =====================================================================
-- MBOne — Migration 024: task responses, subjects, and time zones
-- Run after 023. Paste in THREE blocks.
-- =====================================================================
--
-- From Michelle's feedback, 4 September 2026.
--
-- ⚠ THE RULE SHE GAVE, EXACTLY: a task is overdue when it has had NO
-- RESPONSE and has NOT been marked completed. Opening it does not count
-- and has no effect.
--
-- That last clause is the whole design. "Seen" is not progress, and a
-- system that treats opening as acknowledgement lets somebody read a task
-- every day for a week while nothing happens. So there is no `seen_at`
-- column here, deliberately, and there should not be one.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 3 — responses on a task
-- =====================================================================

create table if not exists task_responses (
  id         bigserial primary key,
  task_id    bigint not null references tasks(id) on delete cascade,
  author_id  uuid references profiles(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists task_responses_task on task_responses (task_id, created_at);

alter table task_responses enable row level security;

drop policy if exists task_responses_read  on task_responses;
drop policy if exists task_responses_write on task_responses;

-- You can see the conversation on a task you can see.
create policy task_responses_read on task_responses for select
  using (
    is_admin()
    or exists (select 1 from tasks t
                where t.id = task_responses.task_id
                  and (t.assigned_to = auth.uid() or t.created_by = auth.uid()))
  );

create policy task_responses_write on task_responses for all
  using (author_id = auth.uid() or is_admin())
  with check (author_id = auth.uid());

-- Denormalised onto the task so "which tasks have gone quiet" is one read
-- rather than a join across every task in the system. Kept true by the
-- trigger below, not by the application — an app-maintained counter drifts
-- the first time somebody writes to the table another way.
alter table tasks add column if not exists last_response_at timestamptz;
alter table tasks add column if not exists response_count   integer not null default 0;

create or replace function task_response_touch()
returns trigger language plpgsql as $fn$
begin
  update tasks
     set last_response_at = now(),
         response_count   = response_count + 1,
         updated_at       = now()
   where id = new.task_id;
  return new;
end;
$fn$;

drop trigger if exists task_response_touch_t on task_responses;
create trigger task_response_touch_t
  after insert on task_responses
  for each row execute function task_response_touch();


-- =====================================================================
-- BLOCK 2 of 3 — what a task is about
-- =====================================================================
-- Michelle asked for To and From to be visible, and for a client or clinic
-- field that is EDITABLE and OPTIONAL, so a task about something other
-- than a clinic can still say what it is about.
--
-- `clinic_id` already exists for real clinics. `subject` is the free-text
-- alternative for everything else — a payer, a project, "IT", "internal".
-- Both can be empty; a task about nothing in particular is legitimate.

alter table tasks add column if not exists subject text;

-- A task carries either a clinic or a free-text subject, not both. Two
-- answers to "what is this about" means two different reports disagree.
alter table tasks drop constraint if exists tasks_one_subject;
alter table tasks
  add constraint tasks_one_subject
  check (clinic_id is null or subject is null);


-- =====================================================================
-- BLOCK 3 of 3 — time zones
-- =====================================================================
-- ⚠ THIS CORRECTS AN ASSUMPTION CARRIED OVER FROM MedaOne.
--
-- MedaOne serves an office in India working a night shift, where the whole
-- team maps onto one US working day. MBOne is for a US office on US hours,
-- and some of its people work from home in OTHER US time zones.
--
-- So there are two different things, and conflating them is what goes
-- wrong:
--
--   * the BUSINESS DATE stays anchored to one company zone, so a month
--     closes once and everybody's figures land in the same month; and
--   * each PERSON has their own zone, so their punch times, their day
--     boundaries and their hours read correctly for where they are.
--
-- Null means "use the company zone", which is right for everybody in the
-- office and means nothing has to be filled in for them.

alter table profiles  add column if not exists time_zone text;
alter table employees add column if not exists time_zone text;

comment on column profiles.time_zone is
  'IANA zone, e.g. America/New_York. Null = the company zone. Used for '
  'displaying this person''s times and computing their own day boundaries.';


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select column_name from information_schema.columns
--  where table_name = 'tasks'
--    and column_name in ('subject','last_response_at','response_count');   -- 3
--
-- select tgname from pg_trigger where tgname = 'task_response_touch_t';    -- 1
