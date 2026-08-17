# CLAUDE.md — MOne

Standing instructions for this project. Read this fully before doing anything.

---

## Who you are working with

Pravin runs a US medical billing company. **He is not a coder.** Everything he has built was
built with step-by-step guidance.

This changes how to help him:

- Name the **exact file and exact path**. Never say "update your config" — say
  "open `src/lib/supabase.ts`, line 4".
- Give **literal commands, fully filled in**. Never hand him a snippet with a blank to
  substitute into. He once got `ERROR 42703: column "pravin" does not exist` because a SQL
  statement had a bare column name where he was meant to type a value.
- **Never ask him to `cat` a file containing secrets**, and never ask him to paste keys. To
  check an env file, use the masked view:
  `awk -F= '{print $1"="substr($2,1,12)"…"}' .env.local`
- **Avoid heredocs** (`cat > file <<'EOF'`) for anything he must edit. One bad paste corrupts
  the file invisibly. Use `open -e <full path>` and tell him which line to replace.
- Every manual edit he has made to an env file has introduced a character error — a stray
  letter, a smart quote, a trailing `EOF`. Always verify afterwards.
- **He gets overwhelmed by multi-question rounds.** Make sensible calls, show the result, and
  let him correct it. One question at a time, at most.

---

## What MOne is

A web app for **Momentum**, a US organisation managing 38 physical therapy clinics with nine
Client Account Managers (CAMs). Medavin does their AR work.

Pravin is building this **for them, as a favour**, and will hand over the code and the accounts
when it is done. Momentum has their own engineering team who will maintain it afterwards. They
tried to build this themselves for over a year and could not — the blocker was never
engineering, it was that nobody had specified what it should do.

**Therefore: documentation is part of the deliverable, not an afterthought.** Their team
inherits this. Anything non-obvious gets a comment or a README entry.

The full specification is in `docs/Momentum_App_Structure_Spec.md`. Read it before designing
anything.

---

## Two dashboards drive everything

- **Monty** — runs client meetings. Needs the per-clinic monthly financial picture: AR
  movement, ageing, charges/payments/adjustments, visits, referral sources, CPT detail.
  Today this is assembled by hand into one workbook per clinic per month, from several
  AdvancedMD exports. 38 clinics means 38 manual assembly jobs a month. **Killing that manual
  assembly is the point of the product.**
- **Michelle** — runs operations. Needs throughput: actions taken, actions due, DOS in the AR
  module, by clinic and by CAM, plus payments, charges, unapplied payments and visits.
  Her detailed requirements have been requested and have not arrived. Do not invent them.

---

## Stack

- Next.js 14, app router, TypeScript
- Supabase — Postgres, Auth, Row Level Security
- Deployed on Vercel
- Project name `mone` everywhere: folder, repo, Supabase project

---

## Schema — the decisions that matter

Migrations live in `supabase/migrations/`. **001–004 are already applied.**

### Financial class is the grain

Every monthly fact table is keyed on **clinic × month × financial class**, never clinic ×
month. This is not negotiable and cannot be retrofitted cheaply.

Why: on one clinic in one month, the LIEN financial class alone was $14.81M of $16.91M in
total AR, nearly all past 120 days. At clinic level that is a big number with no explanation.
Split by financial class it is the entire story, and it is what the client meeting is about.

Clinic-level totals are **derived by summing**, never stored. Two stored copies of the same
number eventually disagree.

### Other standing schema rules

- `period_month` always stores the **first day** of the month, with a CHECK constraint.
- Ageing buckets hold **amounts**, not counts.
- **Store both opening and closing AR.** Closing is not opening + charges − payments once
  adjustments and transfers are involved. Storing both makes the gap visible.
- **NULL and 0 are different.** NULL means not reported; 0 means zero.
- **Mix percentages are computed, never stored** — a stored percentage goes stale the moment a
  figure is corrected.
- **Roles are `text` + CHECK, never a Postgres enum.** An enum cannot have a value added and
  used in the same transaction, which forces migrations to be split.
- `cam_assignments` is a **dated table**, not a column on `clinics`. Ownership changes, and a
  March report must show March's owner. A partial unique index enforces one current owner
  per clinic.

### Security rules

- Access is enforced **in the database**, not in the interface. A CAM who types another CAM's
  clinic into the URL must get nothing back, not a hidden menu item.
- Reuse `can_see_clinic(clinic_id)` on every clinic-scoped table. Do not write bespoke policy
  logic per table.
- Helper functions are `SECURITY DEFINER` so they can read `profiles` without re-triggering
  the policies on `profiles`. Reading `profiles` from inside a `profiles` policy causes
  infinite recursion.
- **EVERY VIEW NEEDS `security_invoker = on`.** A view has no policies of its own and by
  default runs with its creator's permissions, reading straight past the RLS on the tables
  underneath. Locking a table does not lock a view built on it. This has already bitten once.

---

## Migration rules — learned the hard way

On the previous project, three migrations reported **success in the SQL Editor and only
partially applied**. Reference tables were never created, dropdowns were silently empty for
weeks, and nobody noticed because nothing looked broken.

Therefore:

1. **Run one migration at a time**, then verify before the next.
2. **Verify with `VERIFY.sql`**, in the repo root. "Success" is not proof.
3. **Never use `do $$` blocks** in migrations pasted into the Supabase SQL Editor — the editor
   appends comments and breaks the dollar-quoting. Function bodies use `$fn$` tags.
4. Put **explicit `::type` casts on the first row of a VALUES list**, or Postgres can infer the
   wrong type for the whole list.
5. Tell him to **clear the SQL Editor completely** before each paste. Leftover text above a
   new paste has broken migrations before.
6. `"Could not find table X"` at runtime means **that migration was not run** — it is not a
   code bug.

---

## Data rules — non-negotiable

- **No real patient data in this system until it is transferred to Momentum's own Supabase and
  Vercel accounts.** Test data only. While the project sits in Pravin's accounts, real PHI
  would make him a business associate and trigger a large compliance burden that the handover
  plan is specifically designed to avoid.
- **No line-level chart number, visit ID or CPT detail in phase 1.** The AdvancedMD reports
  carry it; neither dashboard needs it. The schema does not preclude adding it later.
- **Chart number and visit ID are PHI** even with no patient name attached — they are on
  HIPAA's list of 18 identifiers. Removing names is not enough.
- Never ask him to paste report data into a chat window. Work from files.

---

## Getting data in

Two stages, and the first must not be skipped:

1. **File import.** Upload the AdvancedMD exports and parse them. Build and prove the parsers
   against real report shapes.
2. **ODBC.** Direct connection to AdvancedMD, after the migration to compliant hosting. Same
   parsing and validation logic; only the source changes.

Building stage 2 first means designing against a guessed data shape and rebuilding when the
real one arrives.

**Seeding:** the AdvancedMD historical reports carry 113 monthly columns per clinic, back to
2012. One export per clinic seeds a decade of history at go-live.

**Every import is logged** — source, who ran it, rows accepted, rows rejected and why. An
import that silently drops rows is worse than one that fails outright.

---

## Current state

**Done:** migrations 001 (core, access control, reference tables), 002 (monthly fact tables),
003 (38 clinics seeded, CAM mapping staged in `cam_seed_map`), 004 (view security fix).
Pravin's admin account exists in `profiles`.

**Next:** the app skeleton — login against Supabase, and one page listing clinics. Small on
purpose: it proves login, session, policies and data on screen before any dashboard is built.

**Held deliberately:** migration 005, the operations tables (AR actions, daily production
summary, CRL, tasks, audit log). Waiting on Michelle's requirements, because her dashboard is
what those tables have to produce.

**Open questions:** whether CRL identifies a patient (if so it is the only phase-1 table
holding PHI); which AdvancedMD report feeds each of the nine report sheets; whether MPS and
Stan Ortho are clinics or a different category.

---

## When something is unclear

Ask one question and stop. Do not guess at a requirement and build it — a wrong assumption
that reaches the schema costs far more than a question.
