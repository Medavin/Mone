-- =====================================================================
-- MOne — Migration 014b: put chat messages on the realtime publication
-- Run AFTER 014, and run it ON ITS OWN.
-- =====================================================================
--
-- WHY THIS IS A SEPARATE FILE
-- The Supabase SQL editor runs a pasted file as ONE TRANSACTION. This
-- statement cannot be made idempotent — re-running it errors with
-- "42710: already member of publication" — and an error anywhere in a
-- transaction rolls back EVERYTHING before it. In MedaOne exactly this
-- line sat at the end of a migration, failed on a second run, and silently
-- rolled back a whole set of policy fixes that had appeared to succeed.
--
-- So: one line, its own file. If it errors with 42710, the table is already
-- published and there is nothing to do — ignore it and carry on.
-- =====================================================================

alter publication supabase_realtime add table collab_messages;
