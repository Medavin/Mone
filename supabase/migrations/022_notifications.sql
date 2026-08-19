-- =====================================================================
-- MOne — Migration 022: notifications
-- Run after 021. Paste in TWO blocks.
-- =====================================================================
--
-- WHY THIS IS NOT OPTIONAL ANY MORE
-- MOne now has tasks, clinic flags, assignments, announcements and chat.
-- Every one of them quietly waits for somebody to go and look. A task
-- assigned to you is invisible until you happen to open the Tasks page,
-- which means the collaboration features mostly do not get used — not
-- because they are bad, but because nobody is told.
--
-- ⚠ DEDUPE_KEY IS THE POINT, NOT AN OPTIMISATION. A rule that says "warn
-- me when this clinic's 120+ rises" will fire on every page load unless
-- something stops it. One row per key means the second attempt does
-- nothing, and the bell stays worth looking at. A bell that cries wolf
-- gets ignored within a week, and then the feature is worse than absent
-- because everybody assumes they were told.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 2 — the table
-- =====================================================================

create table if not exists notifications (
  id           bigserial primary key,

  -- Who it is FOR. Null means it is for whoever manages the place — an
  -- alert with no particular owner, which is a real case and not a bug.
  recipient_id uuid references profiles(id) on delete cascade,

  kind         text not null,
  title        text not null,
  body         text,
  link_url     text,                    -- where to go when it is clicked

  -- One notification per key. Null means always create a new one.
  dedupe_key   text,

  actor_id     uuid references profiles(id) on delete set null,
  actor_name   text,

  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_inbox
  on notifications (recipient_id, read_at, created_at desc);

-- Partial unique: dedupe only applies where a key was given.
create unique index if not exists notifications_dedupe
  on notifications (dedupe_key) where dedupe_key is not null;

alter table notifications enable row level security;


-- =====================================================================
-- BLOCK 2 of 2 — who sees and who sends
-- =====================================================================

drop policy if exists notifications_read   on notifications;
drop policy if exists notifications_insert on notifications;
drop policy if exists notifications_update on notifications;

-- Yours, plus the unaddressed ones if you manage the place.
create policy notifications_read on notifications for select
  using (recipient_id = auth.uid() or (recipient_id is null and manages_people()));

-- ANY signed-in person may create one. That is deliberate: you assign a
-- task, THEY get told. Restricting this to admins would mean the only
-- person who can notify somebody is the one least likely to need to.
create policy notifications_insert on notifications for insert
  with check (auth.uid() is not null);

-- Marking as read is the only edit, and only of your own.
create policy notifications_update on notifications for update
  using (recipient_id = auth.uid() or (recipient_id is null and manages_people()))
  with check (recipient_id = auth.uid() or (recipient_id is null and manages_people()));


-- =====================================================================
-- REALTIME — run this ONE LINE on its own
-- =====================================================================
-- It cannot be made idempotent, and an error inside a multi-statement
-- paste rolls back everything before it. If it says "already member of
-- publication", it is already done.
--
--   alter publication supabase_realtime add table notifications;


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select policyname, cmd from pg_policies where tablename = 'notifications';
--   -> three rows: select, insert, update. No delete policy: a
--      notification is marked read, not erased, so "was I told" keeps an
--      answer.
