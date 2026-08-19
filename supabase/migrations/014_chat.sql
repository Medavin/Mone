-- =====================================================================
-- MOne — Migration 014: team chat (channels, DMs, messages)
-- Run after 013. Clear the SQL Editor completely before pasting.
-- ⚠ Run 014b_chat_realtime.sql SEPARATELY afterwards. It is one line and
--   it is not idempotent, so it must not sit inside this file.
-- =====================================================================
--
-- Ported from MedaOne's Team space. The shape is deliberately the same:
-- one table for conversations, one for who is in them, one for what was
-- said. A DM is a channel with kind='dm' and two members, not a separate
-- table — otherwise every query about "my conversations" is a union.
--
-- ⚠ THE BUG THIS SCHEMA IS WRITTEN TO AVOID, because it bit MedaOne TWICE
-- and cost a lot of confused debugging:
--
--   A SELECT policy of `is_admin() or is_channel_member(id)` looks right
--   and breaks channel creation for everyone except admins. The client
--   inserts the channel, THEN adds the member rows. If the insert uses
--   `.select()` (INSERT ... RETURNING), Postgres applies the SELECT policy
--   to the row being returned — and at that instant there are no members
--   yet, so is_channel_member() is false and the whole insert is rejected.
--   Pravin never saw it in MedaOne because he is an admin.
--
-- Two independent defences here:
--   1. the read policy also allows `created_by = auth.uid()` and any
--      `is_general` channel, so it is satisfiable at RETURNING time; and
--   2. the client generates the row id itself and inserts WITHOUT
--      `.select()`, so the write does not depend on the read policy at all.
--
-- ⚠ ALSO: membership is resolved through SECURITY DEFINER functions, never
-- a sub-select. A policy on collab_channels that queries
-- collab_channel_members (whose own policy queries collab_channels) is the
-- classic infinite-recursion trap.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------
create table if not exists collab_channels (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'channel' check (kind in ('channel','dm')),
  name        text,                    -- null for a DM; the members name it
  topic       text,
  is_general  boolean not null default false,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Exactly one #general, enforced rather than hoped for.
create unique index if not exists collab_channels_one_general
  on collab_channels ((true)) where is_general;

create table if not exists collab_channel_members (
  id           bigserial primary key,
  channel_id   uuid not null references collab_channels(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  joined_at    timestamptz not null default now(),
  unique (channel_id, user_id)
);

create index if not exists collab_members_user on collab_channel_members (user_id);

create table if not exists collab_messages (
  id                uuid primary key default gen_random_uuid(),
  channel_id        uuid not null references collab_channels(id) on delete cascade,
  author_id         uuid references profiles(id) on delete set null,
  body              text not null,
  -- A reply points at the message it answers. Threads are read by grouping
  -- on this rather than by storing a thread id, so a message never has to
  -- be moved between threads.
  parent_message_id uuid references collab_messages(id) on delete cascade,
  created_at        timestamptz not null default now(),
  edited_at         timestamptz
);

create index if not exists collab_messages_channel
  on collab_messages (channel_id, created_at);
create index if not exists collab_messages_parent
  on collab_messages (parent_message_id);

-- ---------------------------------------------------------------------
-- 2. MEMBERSHIP HELPERS — SECURITY DEFINER, so policies never recurse
-- ---------------------------------------------------------------------
create or replace function is_channel_member(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from collab_channel_members m
     where m.channel_id = p_channel and m.user_id = auth.uid()
  );
$fn$;

create or replace function is_channel_creator(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from collab_channels c
     where c.id = p_channel and c.created_by = auth.uid()
  );
$fn$;

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------
alter table collab_channels        enable row level security;
alter table collab_channel_members enable row level security;
alter table collab_messages        enable row level security;

drop policy if exists channels_read   on collab_channels;
drop policy if exists channels_insert on collab_channels;
drop policy if exists channels_write  on collab_channels;

-- is_general first so a new signed-in user can see #general and join it.
-- created_by second so creating a channel cannot fail at RETURNING time.
create policy channels_read on collab_channels for select
  using (is_general or is_admin() or created_by = auth.uid() or is_channel_member(id));

create policy channels_insert on collab_channels for insert
  with check (created_by = auth.uid());

create policy channels_write on collab_channels for all
  using (is_admin() or created_by = auth.uid())
  with check (is_admin() or created_by = auth.uid());

drop policy if exists members_read   on collab_channel_members;
drop policy if exists members_insert on collab_channel_members;
drop policy if exists members_write  on collab_channel_members;

create policy members_read on collab_channel_members for select
  using (user_id = auth.uid() or is_admin() or is_channel_member(channel_id));

-- You may add yourself to a channel you can already see, and the person who
-- created a channel may add anyone to it.
create policy members_insert on collab_channel_members for insert
  with check (
    auth.uid() is not null
    and (is_admin() or user_id = auth.uid() or is_channel_creator(channel_id))
  );

-- Updating your own row is how last_read_at moves.
create policy members_write on collab_channel_members for all
  using (user_id = auth.uid() or is_admin() or is_channel_creator(channel_id))
  with check (user_id = auth.uid() or is_admin() or is_channel_creator(channel_id));

drop policy if exists messages_read   on collab_messages;
drop policy if exists messages_insert on collab_messages;
drop policy if exists messages_write  on collab_messages;

create policy messages_read on collab_messages for select
  using (is_admin() or is_channel_member(channel_id));

create policy messages_insert on collab_messages for insert
  with check (author_id = auth.uid() and is_channel_member(channel_id));

create policy messages_write on collab_messages for all
  using (author_id = auth.uid() or is_admin())
  with check (author_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------
-- 4. THE ROSTER
-- ---------------------------------------------------------------------
-- Chat needs every signed-in person to read the list of names: you cannot
-- start a DM with someone you cannot see, and a message needs its author's
-- name. Until now `profiles` was readable only by yourself and by admins.
-- This adds names and roles for signed-in users. It does NOT widen anything
-- else — the clinic and financial policies are untouched.

drop policy if exists profiles_signed_in_read on profiles;
create policy profiles_signed_in_read on profiles for select
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- 5. #general
-- ---------------------------------------------------------------------
-- Seeded here rather than created by whoever opens the page first, so it
-- has no owner and cannot be deleted by accident.
insert into collab_channels (kind, name, topic, is_general)
select 'channel', 'general', 'Everyone, everything', true
 where not exists (select 1 from collab_channels where is_general);


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select table_name from information_schema.tables
--  where table_schema='public'
--    and table_name in ('collab_channels','collab_channel_members','collab_messages')
--  order by table_name;                      -- expect 3 rows
--
-- select tablename, policyname, cmd from pg_policies
--  where tablename like 'collab%' or policyname = 'profiles_signed_in_read'
--  order by tablename, policyname;           -- expect 10 rows
--
-- select name, is_general from collab_channels;   -- expect general / true
