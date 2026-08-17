# Momentum AR Platform — Structure Specification

**Draft v0.1 — 17 August 2026**
Prepared by Medavin. Working document, not final. Sections marked **[GAP]** need input before build.

---

## 1. What this document is

Momentum's engineering team has the ability to build this; what has been missing is a
specification. This document defines *what the system is*, *what data it holds*, and *what each
person sees* — in enough detail that a developer can start, and in plain enough language that
the people who will use it can correct it.

It deliberately stops short of implementation detail. Framework, hosting and code style are
Momentum's team's decisions.

**Build sequence assumption:** built on Medavin-owned Supabase/Vercel accounts using
non-identifiable test data, then transferred to Momentum's own accounts, at which point real
data is loaded via ODBC. No PHI enters the system before that transfer.

---

## 2. The problem being solved

Today the monthly client report is assembled by hand. For each clinic, several separate
AdvancedMD reports are exported and stitched into a single workbook — AR movement, aging by
financial class, carrier detail, charges and payments, ten years of history, CPT-level service
detail, and inbound referrals.

At 37 clinics that is 37 manual assembly jobs every month, and the output is a static file that
nobody can filter, sort or drill into once it is sent.

The system replaces the assembly, not the analysis. The judgement stays with Monty and
Michelle; the clerical work stops.

---

## 3. People and roles

| Role | Who | What they do |
|---|---|---|
| **Executive** | Monty | Client meetings. Needs the per-clinic monthly picture and the ability to compare periods and clinics. |
| **Operations** | Michelle | Runs the AR operation. Needs throughput, workload and exception views across all clinics and all CAMs. |
| **CAM** | 9 people | Client Account Manager. Owns a set of clinics. Sees their own clinics in depth, the rest not at all or read-only. |
| **AR agent** | team | Works accounts, records actions. |
| **Admin** | — | User management, reference data, imports. |
| **Client / guest** | clinic contacts | Read-only, scoped to their own clinic. Not in phase 1, but the model must not preclude it. |

Roles are additive: Michelle is an operations user *and* a CAM (she holds Dynamx PT and HSSN).
The model must let one person hold a role and a clinic list at the same time, rather than
forcing a choice.

---

## 4. Modules — phase 1

**In:**

1. **Clinic page** — everything known about one clinic in one place
2. **CAM dashboard** — a CAM's own clinics, rolled up
3. **Operations dashboard** — Michelle's view
4. **Executive dashboard** — Monty's view
5. **CRL — Client Request Log** — requests coming in from clinics, tracked to closure (section 5.6)
6. **Tasks** — assignment and follow-through
7. **Audit** — who changed what, and who viewed what
8. **Admin & settings** — users, clinics, CAM assignments, reference lists
9. **Import** — file upload now, ODBC later

**Deliberately out of phase 1** (addable once the core is proven): HR/attendance, team chat,
noticeboard, file editor, projects, matrix/scheduling.

---

## 5. Data model

### 5.1 The dimension that matters most: financial class

Almost every figure in the monthly report is cut by **financial class** — AUTO, LIEN,
CONTRACTED PER DIEM, DEPT OF LABOR, PRIV INS, and so on.

This is not a reporting nicety. On one clinic in one month, the LIEN class alone accounted for
$14.81M of $16.91M in total AR, nearly all of it past 120 days. At clinic level that is a large
AR number with no explanation. Split by financial class it is the entire story, and it is what
the client meeting is actually about.

**Every monthly fact table is therefore grained at clinic × month × financial class**, not
clinic × month. Clinic-level totals are derived by summing, never stored separately — storing
both invites them to disagree.

### 5.2 Reference tables

| Table | Holds |
|---|---|
| `clinics` | name, code, status, timezone, go-live date |
| `financial_classes` | code (`1A`, `1L`…), name, sort order, active flag |
| `carriers` | code, name |
| `providers` | rendering/billing provider, name, credential |
| `procedures` | CPT/charge code, description |
| `referring_providers` | name, address, phone, email |
| `people` | app users: name, email, role |
| `cam_assignments` | clinic × CAM × effective from/to |

`cam_assignments` is its own table with dates, not a `cam_id` column on `clinics`. Ownership
changes, and a report for March must show who owned the clinic in March.

### 5.3 Monthly fact tables

| Table | Grain | Holds |
|---|---|---|
| `ar_monthly` | clinic × month × financial class | opening AR, closing AR, and the aging buckets (current, 30, 60, 90, 120+) as **amounts** |
| `activity_monthly` | clinic × month × financial class | units, charges, payments, adjustments, **unapplied payments**, visits, new patients |
| `service_monthly` | clinic × month × financial class × CPT | units, charges |
| `carrier_ar_monthly` | clinic × month × carrier (× provider) | aging buckets |
| `referrals_monthly` | clinic × month × referring provider | new patients MTD/YTD, visits MTD |

Notes:

- **Store both opening and closing AR.** Closing is not simply opening plus charges minus
  payments once adjustments and transfers are involved. Storing both makes the gap visible
  instead of hiding it.
- **Blank and zero are different.** A missing figure stores NULL; zero means zero. Reading a
  month back later, "not reported" and "nothing happened" must not look identical.
- **Mix percentages are computed, never stored.** They go stale the moment a figure is corrected.
- **Unapplied payments** is on the list because money received but not posted to a claim
  overstates AR and understates collections. It belongs next to payments, not in a footnote.

### 5.4 Line-level data — not in phase 1, but do not preclude it

The Carrier AR report already carries chart number, visit ID and CPT with aged balances. That
grain is not needed for either dashboard, and pulling it in early means holding far more
identifiable data than the reports require.

Design the ODBC layer so line detail *can* be loaded later without reshaping the monthly
tables. Do not load it in phase 1.

### 5.5 Operations tables

| Table | Holds |
|---|---|
| `ar_actions` | one row per action an agent takes on an account |
| `action_summary_daily` | clinic × date × agent: actions taken, actions due, DOS in AR module |
| `tasks` | assignment, owner, due date, status |
| `audit_log` | actor, action, table, record, before/after, timestamp |

`action_summary_daily` is what Michelle's production template becomes. It is derived from
`ar_actions` where actions are recorded in-app, and imported directly where they are not — the
table must accept both, because the two systems will overlap during transition.

### 5.6 CRL — Client Request Log

Already built in MedaOne and carried over. One row per request received from a clinic, tracked
through to closure.

`client_requests` — clinic, request type, received date, who it came from, assigned CAM,
response date, outcome, response mode, file reference, comments, status. Amounts where the
request concerns a payment or invoice.

**[GAP: confirm this is the same module as MedaOne's medical records requests, or a separate
log.]**

Two things to settle before build, because they change the shape:

- **Does a CRL entry identify a patient?** MedaOne's version carries a patient field. If
  Momentum's does too, this becomes the one phase-1 table holding PHI, and it must be scoped
  and access-logged accordingly rather than treated like the monthly figures.
- **Turnaround is the metric.** Received-to-closed time, per clinic and per CAM, with anything
  open beyond a threshold surfaced. A log that only records requests without measuring how long
  they sit is a filing cabinet.

---

## 6. Monty's dashboard — executive

Purpose: walk into a client meeting knowing the story before the client tells it.

**Landing view — all clinics, one month.** One row per clinic: closing AR, month-over-month
movement, 120+ balance and its share of total, charges, payments, adjustments, visits, new
patients. Sortable on every column. AR rising is shown as negative, not positive — this is an
AR view, not a revenue chart.

**Clinic view — one clinic, one month.** Reproduces the monthly pack as a screen:

- AR movement: beginning, increase/decrease, ending
- Aging by financial class, with the buckets across
- Financial activity by class: units, charges, payments, adjustments, and mix
- History: charges, payments, adjustments, visits and new patients as a monthly trend
- Top procedures by units and by charges
- Inbound referral sources with new patients and visits

**Comparison view.** Any clinic against any period, or clinic against clinic. This is the thing
a static workbook cannot do and the main reason to build rather than keep exporting.

**Export.** PDF for the client meeting, Excel for anyone who wants to work the numbers. The
export must carry the clinic name, period, generation date and the name of whoever generated
it.

---

## 7. Michelle's dashboard — operations

**[GAP: Michelle's own requirements have been requested and not yet received. What follows is
the shape implied by the production template plus the metrics named so far — treat as a
starting point for her to correct.]**

Confirmed so far: payments, charges, unapplied payments, visits.

**Production view.** The AR production template as a live screen: clinic, CAM, AR actions
taken, actions due, total DOS in AR module, with totals. Filterable by CAM and by date range,
sortable, exportable.

**By CAM.** The same figures rolled up per account manager rather than per clinic, so workload
imbalance is visible.

**Exceptions.** Clinics where actions due exceed a threshold, where no actions were taken in a
period, or where AR moved sharply. Thresholds configurable, not hardcoded.

**Financial strip.** Charges, payments, unapplied payments and visits across all clinics for
the period, with month-over-month movement.

---

## 8. Clinic page

One page per clinic, reachable from everywhere a clinic name appears. Holds: profile and
contacts, current CAM and assignment history, the monthly figures, the action history, open
tasks, and documents. This is the page a CAM lives on and the page Monty opens before a call.

## 9. CAM dashboard

A CAM's own clinics only, rolled up: their clinics' AR and movement, their actions taken and
due, their open tasks, and anything flagged. Filtered by `cam_assignments`, enforced in the
database rather than in the interface — a CAM opening another CAM's clinic by URL should get
nothing back, not a hidden menu item.

---

## 10. Getting data in

**Two stages, and the first must not be skipped.**

**Stage 1 — file import.** Upload the AdvancedMD exports; the system parses and loads them.
This works today, needs no infrastructure decisions, and lets the parsers be built and proven
against real report shapes.

**Stage 2 — ODBC.** Direct connection to AdvancedMD, on HIPAA-compliant hosting, replacing the
upload step. The parsing and validation logic is unchanged; only the source differs.

Building stage 2 first means designing the import against an assumed data shape and rebuilding
when the real shape arrives.

**Seeding.** The historical sheets carry 113 monthly columns per clinic, running back to 2012.
One export per clinic populates a decade of history at go-live, so trends and comparisons work
from day one instead of a year in.

**Every import must be logged** — source file or query, who ran it, when, rows accepted, rows
rejected and why. An import that silently drops rows is worse than one that fails.

---

## 11. What is carried over from MedaOne, and what is not

**Carried over as patterns, rebuilt for this schema:** role-based access enforced in the
database, per-clinic scoping, action/audit logging, task assignment, import with preview before
commit, export with attribution, and business dates anchored to a single client timezone rather
than to whichever timezone the viewer happens to be in.

**Not carried over:** MedaOne's clinic-level monthly tables, because they have no financial
class dimension and cannot reproduce this report; and the modules listed as out of scope in
section 4.

---

## 12. Open items

| # | Item | Needed from |
|---|---|---|
| 1 | Is CRL the same module as MedaOne's medical records requests? Does it hold a patient identifier? | Pravin |
| 2 | Michelle's dashboard requirements | Michelle |
| 3 | Which AdvancedMD report feeds each of the nine sheets | Pravin / Momentum |
| 4 | A completed AR production template with a month of real figures | Michelle |
| 5 | Are MPS and Stan Ortho clinics, or a different category? | Pravin |
| 6 | Do clients ever get direct logins, or is everything via Momentum staff? | Momentum |
| 7 | Retention: how long must monthly figures and audit records be kept? | Momentum |
