-- =====================================================================
-- MOne — Migration 018: insurance portal directory
-- Run after 017. One paste.
-- =====================================================================
--
-- ⚠ READ THIS BEFORE ADDING A PASSWORD COLUMN. SOMEBODY WILL WANT TO.
--
-- Pravin asked for a password manager for the insurance portals. I
-- recommended against holding the secrets here, and he agreed.
--
-- The reason is not squeamishness. Insurance portal logins usually reach
-- patient data, so a table of them would make this app the most valuable
-- target it has. And the protection this app relies on everywhere else --
-- row level security -- does not help: anyone with the Supabase dashboard,
-- the service-role key, or a database backup reads every row in plain
-- text, policies or no policies. Neither MOne nor MedaOne is on a
-- BAA-covered host yet. A leak would not be an app bug, it would be a
-- reportable breach across Momentum's clinics.
--
-- So this table holds everything EXCEPT the secret:
--   which portals exist, who they are for, which clinics use them, who has
--   access, who owns the account, when the password was last changed, and
--   where the credential actually lives.
--
-- That answers the questions the team loses time on -- which portal, whose
-- login, is it still current, who do I ask -- while the secret stays in a
-- real vault built and audited for the job.
--
-- IF A SECRET EVER HAS TO LIVE HERE, the minimum is: encrypted with a key
-- the database never holds, every reveal written to the audit log,
-- management-only, and after the move to a BAA-covered host. Not a text
-- column added in a hurry.
-- =====================================================================

create table if not exists portals (
  id            bigserial primary key,

  name          text not null,
  payer         text,                    -- the insurer or clearing house behind it
  url           text,
  kind          text not null default 'payer'
                check (kind in ('payer','clearinghouse','state','hospital','other')),

  -- Where the credential actually is. A pointer, never the thing itself.
  vault         text,                    -- e.g. "Bitwarden — Billing collection"
  vault_item    text,                    -- the item name inside that vault

  account_owner text,                    -- the person responsible for the account
  who_has_access text,                   -- free text: the team or names, as they say it
  login_hint    text,                    -- "sign in with the group NPI", not a password

  -- Rotation is the fact people actually need and never have.
  password_changed_on date,
  rotation_days       integer,           -- how often it should change, if there is a rule
  mfa                 text,              -- how second-factor works: app, SMS to whom, none

  note          text,
  is_active     boolean not null default true,

  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists portals_name on portals (name);

-- Which clinics use which portal. Many to many, because one payer portal
-- serves several clinics and one clinic uses many portals.
create table if not exists portal_clinics (
  id        bigserial primary key,
  portal_id bigint not null references portals(id) on delete cascade,
  clinic_id bigint not null references clinics(id) on delete cascade,
  note      text,
  unique (portal_id, clinic_id)
);

create index if not exists portal_clinics_clinic on portal_clinics (clinic_id);

alter table portals        enable row level security;
alter table portal_clinics enable row level security;

-- Any signed-in person can look up which portal to use and who to ask.
-- Only management edits the record.
drop policy if exists portals_read  on portals;
drop policy if exists portals_write on portals;
create policy portals_read  on portals for select using (auth.uid() is not null);
create policy portals_write on portals for all using (is_admin()) with check (is_admin());

drop policy if exists portal_clinics_read  on portal_clinics;
drop policy if exists portal_clinics_write on portal_clinics;
create policy portal_clinics_read  on portal_clinics for select using (auth.uid() is not null);
create policy portal_clinics_write on portal_clinics for all using (is_admin()) with check (is_admin());


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select column_name from information_schema.columns
--  where table_name = 'portals' order by ordinal_position;
--   -> there must be NO column called password, secret, credential or token.
