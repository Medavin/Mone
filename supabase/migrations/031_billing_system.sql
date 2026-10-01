-- =====================================================================
-- MBOne — Migration 031: which billing system each client is on
-- Run after 030. Paste in TWO blocks, one at a time.
-- =====================================================================
--
-- Pravin, 2 Oct 2026: nine clients bill through PROMPT, not AdvancedMD.
-- That matters for every figure in MBOne: the monthly packs, the ODBC
-- feed and the collection module are all AdvancedMD. A Prompt client
-- with no figures is not "nothing imported" — it needs a different
-- export, and the screens should say so.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 2 — the column
-- =====================================================================
-- Text + CHECK, never an enum (the project rule). Everyone defaults to
-- AdvancedMD because that is what all 38 original clinics are on.

alter table clinics add column if not exists billing_system text
  not null default 'advancedmd';
alter table clinics drop constraint if exists clinics_billing_system_check;
alter table clinics add constraint clinics_billing_system_check
  check (billing_system in ('advancedmd','prompt','other'));


-- =====================================================================
-- BLOCK 2 of 2 — the nine Prompt clients
-- =====================================================================
-- Matched on name ignoring capitals, so "STAR PT" finds "Star PT".
-- Any of the nine that MBOne does not have yet is ADDED as active, with
-- a note saying where it came from. Nothing is guessed: "Performance
-- Plus PT" is NOT merged with the "PERFORMANCE PT" spelling seen in the
-- June 2021 action report — if they are the same clinic, add that
-- spelling under Settings → Clinic names.

insert into clinics (name, status, notes, billing_system)
select v.name, 'active', 'Added 2 Oct 2026 from Pravin''s list of Prompt clients. CAM not set yet.', 'prompt'
  from (values
    ('Performance Plus PT'::text),
    ('Fullerton PT'),
    ('Solutions PT'),
    ('Pro-Motion'),
    ('Rhodes PT'),
    ('Star PT'),
    ('Movement Works'),
    ('Cox PT'),
    ('Body Logic')
  ) as v(name)
 where not exists (select 1 from clinics c where lower(c.name) = lower(v.name));

update clinics set billing_system = 'prompt'
 where lower(name) in ('performance plus pt','fullerton pt','solutions pt','pro-motion',
                       'rhodes pt','star pt','movement works','cox pt','body logic');


-- =====================================================================
-- CHECK — run separately. Expect nine rows, all 'prompt'.
-- =====================================================================
-- select name, status, billing_system from clinics
--  where billing_system = 'prompt' order by name;
