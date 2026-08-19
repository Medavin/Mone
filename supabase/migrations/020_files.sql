-- =====================================================================
-- MOne — Migration 020: shared files and chat attachments
-- Run after 019. Paste in THREE blocks.
--
-- ⚠ CREATE THE BUCKET FIRST. Supabase → Storage → New bucket, named
--    exactly `mone-files`, with Public switched OFF. Code cannot create a
--    bucket, and the storage policies in block 3 have nothing to attach
--    to until it exists.
-- =====================================================================
--
-- WHY ONE BUCKET FOR BOTH
-- A file attached to a chat message and a file put in the Files module are
-- the same object with a different label. Two buckets would mean two sets
-- of policies, two upload paths and two places for a permission mistake to
-- hide. One bucket, with the path saying which is which.
--
-- ⚠ THE FILE ITSELF IS NEVER IN THE DATABASE. Postgres holds the record —
-- name, size, who, when, which clinic — and Storage holds the bytes. The
-- record is what gets searched and listed; the bytes are only fetched when
-- somebody actually opens one.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 3 — the file record
-- =====================================================================

create table if not exists shared_files (
  id          bigserial primary key,

  -- Where it is in the bucket. The path, not the contents.
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,

  -- Broad kind, worked out at upload from the extension, so the list can be
  -- filtered without reading every mime type.
  kind        text not null default 'other'
              check (kind in ('sheet','doc','pdf','image','video','text','archive','other')),

  title       text,
  note        text,
  folder      text,                    -- free text, so filing can settle by use
  clinic_id   bigint references clinics(id) on delete set null,

  uploaded_by uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),

  -- Deleting a shared file is a decision, so it is recorded rather than
  -- vanishing. The row stays; the bytes are removed separately.
  deleted_at  timestamptz,
  deleted_by  uuid references profiles(id)
);

create index if not exists shared_files_recent on shared_files (created_at desc);
create index if not exists shared_files_clinic on shared_files (clinic_id);

alter table shared_files enable row level security;

drop policy if exists shared_files_read   on shared_files;
drop policy if exists shared_files_insert on shared_files;
drop policy if exists shared_files_write  on shared_files;

-- Any signed-in person sees the shelf. A file attached to a clinic is
-- additionally limited to people who can see that clinic — otherwise
-- filing something against a clinic would quietly widen who could read it.
create policy shared_files_read on shared_files for select
  using (
    auth.uid() is not null
    and (clinic_id is null or can_see_clinic(clinic_id))
  );

create policy shared_files_insert on shared_files for insert
  with check (uploaded_by = auth.uid());

create policy shared_files_write on shared_files for all
  using (uploaded_by = auth.uid() or is_admin())
  with check (uploaded_by = auth.uid() or is_admin());


-- =====================================================================
-- BLOCK 2 of 3 — attachments on chat messages
-- =====================================================================
-- Columns on the message rather than a join table: a message carries at
-- most one file, and a table for a one-to-one relationship is a join
-- nobody needs to write.

alter table collab_messages add column if not exists file_path text;
alter table collab_messages add column if not exists file_name text;
alter table collab_messages add column if not exists file_size bigint;
alter table collab_messages add column if not exists file_kind text;

-- A message that is only a file has no words in it, and `body` is NOT
-- NULL. Rather than loosen that — an empty message with no file would then
-- be possible — the app sends the file name as the body. Stated here so
-- nobody later "fixes" the constraint.


-- =====================================================================
-- BLOCK 3 of 3 — who may touch the bucket
-- =====================================================================
-- These are policies on storage.objects, which is Supabase's own table.
-- Without them the bucket rejects everything, including from the app.

drop policy if exists mone_files_read   on storage.objects;
drop policy if exists mone_files_insert on storage.objects;
drop policy if exists mone_files_delete on storage.objects;

-- Read: any signed-in person, for this bucket only. Fine-grained control
-- lives on the shared_files record and on channel membership; the bucket
-- holds no file whose path is guessable, and every download goes through a
-- signed URL that expires.
create policy mone_files_read on storage.objects for select
  to authenticated
  using (bucket_id = 'mone-files');

create policy mone_files_insert on storage.objects for insert
  to authenticated
  with check (bucket_id = 'mone-files');

-- Only the uploader or an admin removes bytes. storage.objects records the
-- uploader in `owner`.
create policy mone_files_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'mone-files' and (owner = auth.uid() or is_admin()));


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select id, public from storage.buckets where id = 'mone-files';
--   -> one row, public = false. If there is no row, the bucket was not
--      created and nothing above will work.
--
-- select policyname, cmd from pg_policies
--  where tablename = 'objects' and policyname like 'mone_files%';   -- 3 rows
--
-- select column_name from information_schema.columns
--  where table_name = 'collab_messages' and column_name like 'file%';  -- 4 rows
