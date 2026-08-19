-- =====================================================================
-- MOne — Migration 011: the workspace cluster
--   shared calendar · announcements · meeting notes · clinic flags · tasks
-- Run after 010. Clear the SQL Editor completely before pasting.
-- =====================================================================
--
-- These five arrive together because they reference each other: a meeting
-- produces notes, notes raise a flag on a clinic, a flag becomes a task, and
-- all of it wants to appear on one calendar. Building them separately would
-- mean three migrations that each add a foreign key to the last.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SHARED CALENDAR
-- ---------------------------------------------------------------------
-- Dates, not timestamps, for the event itself. Most entries here are
-- all-day (a client meeting, a deadline, a visit) and storing a timestamp
-- would force a timezone decision onto things that do not have one. Where a
-- time genuinely matters it goes in start_time as plain text -- displayed,
-- never used for arithmetic.
--
-- Holidays and leave are NOT copied in. They already live in
-- company_holidays and leave_days from migration 009, and the calendar reads
-- all three. Copying would mean two records of the same fact.

create table if not exists calendar_events (
  id          bigserial primary key,
  title       text not null,
  detail      text,

  starts_on   date not null,
  ends_on     date,                       -- null = single day
  start_time  text,                       -- "9:00 AM", display only
  end_time    text,

  kind        text not null default 'event'
              check (kind in ('event','meeting','deadline','visit','training','other')),

  -- Shared events are the point of this; personal ones keep somebody's own
  -- reminders out of everybody else's month view.
  visibility  text not null default 'shared'
              check (visibility in ('shared','personal')),

  clinic_id   bigint references clinics(id) on delete set null,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),

  check (ends_on is null or ends_on >= starts_on)
);

create index if not exists calendar_events_span on calendar_events (starts_on, ends_on);

-- ---------------------------------------------------------------------
-- 2. ANNOUNCEMENTS / POLICY
-- ---------------------------------------------------------------------
-- `category` separates a policy document from a piece of news. Policies are
-- the ones people need to find again months later; news is read once.
--
-- Publishing is a state, not a delete: a draft that was never published and
-- an announcement that was withdrawn are different things.

create table if not exists announcements (
  id           bigserial primary key,
  title        text not null,
  body         text not null,
  category     text not null default 'news'
               check (category in ('news','policy','alert','celebration')),
  status       text not null default 'draft'
               check (status in ('draft','published','withdrawn')),
  pinned       boolean not null default false,

  -- Empty means everybody. Otherwise only these roles see it.
  audience     text[] not null default '{}',

  author_id    uuid references profiles(id) on delete set null,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists announcements_live
  on announcements (published_at desc) where status = 'published';

-- Who has read what, so "3 unread" is answerable without a counter that
-- somebody has to remember to decrement.
create table if not exists announcement_reads (
  announcement_id bigint not null references announcements(id) on delete cascade,
  user_id         uuid   not null references profiles(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- ---------------------------------------------------------------------
-- 3. MEETING NOTES
-- ---------------------------------------------------------------------
-- Attached to a clinic where there is one, because the question later is
-- almost always "what did we agree with this client".
--
-- `period_month` links a note to the month that was reviewed, so a client
-- meeting about July sits with July's figures even if it happened in
-- September.

create table if not exists meeting_notes (
  id           bigserial primary key,
  clinic_id    bigint references clinics(id) on delete set null,
  period_month date,
  title        text not null,
  met_on       date not null,
  attendees    text,
  body         text,
  decisions    text,
  author_id    uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (period_month is null or extract(day from period_month) = 1)
);

create index if not exists meeting_notes_clinic on meeting_notes (clinic_id, met_on desc);

-- ---------------------------------------------------------------------
-- 4. CLINIC FLAGS
-- ---------------------------------------------------------------------
-- Monty marking a clinic as needing attention. Separate from a task because
-- a flag is a state of the clinic ("this one is a problem right now") while a
-- task is a piece of work somebody owes. One flag can produce several tasks.

create table if not exists clinic_flags (
  id          bigserial primary key,
  clinic_id   bigint not null references clinics(id) on delete cascade,
  reason      text not null,
  detail      text,
  severity    text not null default 'watch'
              check (severity in ('watch','concern','urgent')),
  status      text not null default 'open'
              check (status in ('open','resolved','dismissed')),
  period_month date,

  raised_by   uuid references profiles(id) on delete set null,
  raised_at   timestamptz not null default now(),
  resolved_by uuid references profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution  text
);

create index if not exists clinic_flags_open
  on clinic_flags (clinic_id) where status = 'open';

-- ---------------------------------------------------------------------
-- 5. TASKS
-- ---------------------------------------------------------------------
-- "Inward" and "outward" on the dashboard are not columns -- inward is
-- assigned_to = me, outward is created_by = me. Storing a direction would
-- mean two rows for one task, and they would disagree.

create table if not exists tasks (
  id           bigserial primary key,
  title        text not null,
  detail       text,

  clinic_id    bigint references clinics(id) on delete set null,
  flag_id      bigint references clinic_flags(id) on delete set null,

  assigned_to  uuid references profiles(id) on delete set null,
  -- Free text so work can be sent to a team that has no login yet
  -- ("AR team", "IT"), which is how it actually gets delegated.
  assigned_team text,

  created_by   uuid references profiles(id) on delete set null,
  due_on       date,
  priority     text not null default 'normal'
               check (priority in ('low','normal','high')),
  status       text not null default 'open'
               check (status in ('open','in_progress','blocked','done','cancelled')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_assigned on tasks (assigned_to) where status <> 'done';
create index if not exists tasks_clinic on tasks (clinic_id);

create table if not exists task_comments (
  id         bigserial primary key,
  task_id    bigint not null references tasks(id) on delete cascade,
  author_id  uuid references profiles(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------
alter table calendar_events    enable row level security;
alter table announcements      enable row level security;
alter table announcement_reads enable row level security;
alter table meeting_notes      enable row level security;
alter table clinic_flags       enable row level security;
alter table tasks              enable row level security;
alter table task_comments      enable row level security;

-- Calendar: shared events are visible to everyone signed in; personal ones
-- only to their author. Anyone may create; only the author or an admin edits.
drop policy if exists cal_read on calendar_events;
drop policy if exists cal_insert on calendar_events;
drop policy if exists cal_write on calendar_events;
create policy cal_read on calendar_events for select
  using (visibility = 'shared' or created_by = auth.uid() or is_admin());
create policy cal_insert on calendar_events for insert
  with check (created_by = auth.uid() or is_admin());
create policy cal_write on calendar_events for all
  using (created_by = auth.uid() or is_admin())
  with check (created_by = auth.uid() or is_admin());

-- Announcements: published ones to their audience; drafts only to admins.
drop policy if exists ann_read on announcements;
drop policy if exists ann_write on announcements;
create policy ann_read on announcements for select
  using (
    is_admin()
    or (
      status = 'published'
      and (audience = '{}' or current_role_of() = any(audience))
    )
  );
create policy ann_write on announcements for all using (is_admin()) with check (is_admin());

drop policy if exists ann_reads_own on announcement_reads;
create policy ann_reads_own on announcement_reads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Meeting notes follow the clinic: if you can see the clinic, you can see
-- what was agreed about it. Notes with no clinic are visible to everyone.
drop policy if exists notes_read on meeting_notes;
drop policy if exists notes_write on meeting_notes;
create policy notes_read on meeting_notes for select
  using (clinic_id is null or can_see_clinic(clinic_id));
create policy notes_write on meeting_notes for all
  using (author_id = auth.uid() or is_admin())
  with check (author_id = auth.uid() or is_admin());

drop policy if exists flags_read on clinic_flags;
drop policy if exists flags_insert on clinic_flags;
drop policy if exists flags_write on clinic_flags;
create policy flags_read on clinic_flags for select using (can_see_clinic(clinic_id));
create policy flags_insert on clinic_flags for insert
  with check (auth.uid() is not null and can_see_clinic(clinic_id));
create policy flags_write on clinic_flags for all
  using (raised_by = auth.uid() or sees_all_clinics())
  with check (raised_by = auth.uid() or sees_all_clinics());

-- Tasks: you see what you were given, what you gave out, and anything on a
-- clinic you can see. Assignees need update rights or they cannot move their
-- own work along.
drop policy if exists tasks_read on tasks;
drop policy if exists tasks_insert on tasks;
drop policy if exists tasks_write on tasks;
create policy tasks_read on tasks for select
  using (
    assigned_to = auth.uid()
    or created_by = auth.uid()
    or sees_all_clinics()
    or (clinic_id is not null and can_see_clinic(clinic_id))
  );
create policy tasks_insert on tasks for insert with check (created_by = auth.uid());
create policy tasks_write on tasks for all
  using (assigned_to = auth.uid() or created_by = auth.uid() or is_admin())
  with check (assigned_to = auth.uid() or created_by = auth.uid() or is_admin());

drop policy if exists task_comments_read on task_comments;
drop policy if exists task_comments_write on task_comments;
create policy task_comments_read on task_comments for select
  using (exists (select 1 from tasks t where t.id = task_id));
create policy task_comments_write on task_comments for all
  using (author_id = auth.uid() or is_admin())
  with check (author_id = auth.uid() or is_admin());

-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select table_name from information_schema.tables
--   where table_schema='public' and table_name in
--   ('calendar_events','announcements','announcement_reads','meeting_notes',
--    'clinic_flags','tasks','task_comments')
--   order by table_name;          -- expect 7 rows
