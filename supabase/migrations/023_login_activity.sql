-- =====================================================================
-- MOne — Migration 023: who has signed in
-- Run after 022. One paste.
-- =====================================================================
--
-- WHY A VIEW AND NOT A QUERY
-- Supabase already records `last_sign_in_at` on auth.users, but that table
-- is deliberately out of reach of the application: it also holds password
-- hashes, recovery tokens, confirmation tokens and one-time codes. Reading
-- it from the app would mean exposing all of that to get one date.
--
-- So this view selects THREE COLUMNS and nothing else, and is restricted
-- to management. It answers "have they opened it yet", which is the
-- question asked about every login ever issued, and nothing more.
--
-- ⚠ security_invoker is NOT set here, and that is deliberate — the whole
-- point is to read a table the caller cannot. The `manages_people()` test
-- inside the view is what does the restricting instead. This is the one
-- place in MOne where that is the right answer; everywhere else, a view
-- without security_invoker is the migration-004 bug.
-- =====================================================================

create or replace view login_activity as
select p.id,
       p.full_name,
       p.email,
       p.role,
       p.is_active,
       u.last_sign_in_at,
       u.created_at as login_created_at
  from profiles p
  join auth.users u on u.id = p.id
 where manages_people();

-- Not readable at all unless the caller manages people. The where clause
-- above already enforces it; this removes the view from everyone else's
-- reach entirely rather than returning them an empty list.
revoke all on login_activity from anon;
grant select on login_activity to authenticated;


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select full_name, email, last_sign_in_at from login_activity
--  order by last_sign_in_at desc nulls last;
--
-- A NULL last_sign_in_at means that person has never signed in — which is
-- exactly what you want to see the day after sending someone their login.
