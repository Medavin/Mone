# Client & CAM Results page (`/results`)

Built 1 Oct 2026 from Michelle Hatten's mockup and input spec (29 Sep 2026,
"CAM and Client Results Mock Stats" + "CAM_Client_Results_Dashboard_Input_Spec").
Anyone whose landing page is **operations** lands here. It is also under
**Clinics → Client results**.

## Scope and period

- **Company → CAM → client.** Choosing a CAM narrows to that CAM's clients;
  choosing a client narrows to one.
- **Period** defaults to year-to-date of the latest imported month.
- The CAM shown for a client is the one in force **on the last day of the
  period** (`cam_assignments` is dated). Changing a CAM on the page closes the
  old row and opens a new one, so earlier months keep their owner.

## The rules (from the spec, enforced in `lib/results.ts`)

| Kind of figure | How it is combined |
|---|---|
| Flows: visits, payments, change in A/R | summed over the months in the period |
| Balances: closing A/R, insurance A/R | the **last** month in the period, never summed across months |
| Ratios: payment per visit, days in A/R, % 120+ | **recomputed** from numerator and denominator, never averaged across clients |
| Missing data | shown as "—" or an explanation, never as 0 |

Reference points live as constants at the top of `lib/results.ts`:
`DAYS_IN_AR_TARGET = 30`, `OVER_120_LIMIT = 5` (strictly under),
`TREND_TOLERANCE = 10` (% rise against the client's own prior three months).
They are shown as **three separate signals, not one grade** — the spec says a
combined grade needs an agreed rule first.

## Where each card's numbers come from

| Card | Source table(s) | State |
|---|---|---|
| Dashboard snapshot | `activity_clinic_month`, `ar_clinic_month`, `clinic_monthly`, `ar_split_monthly` (insurance rows) | Live from monthly packs |
| A/R health / portfolio | same, plus `lib/arMetrics.ts` | Live; days-in-A/R formula provisional |
| Top denial reasons | `denials` + `denial_codes.category` | Live once denials are imported or entered |
| CRL | `crl_entries` (`entry_date`, `responded_on`, `resolved_on`) | Live; reply dates entered on the CRL page |
| Patients over 25 visits | — | Needs a per-client count from AdvancedMD |
| Add-on code utilization | `addon_codes` + `service_monthly` + `procedures` | Live once Momentum picks the codes; **billed charges**, not payments |
| CAM tasks | `tasks` assigned to a CAM's login + "Sent to CAM" in `collection_actions_monthly` | Live; CAMs need logins for tasks |
| Collector work | `collection_actions_monthly` | Counts only; no pending state in the source |

## Migration 030

`supabase/migrations/030_client_results.sql`:

1. Brings `crl_entries` to one shape and adds `responded_on`. (An early draft
   migration created a different `crl_entries`; 025's `create table if not
   exists` would have skipped it. 030 is safe on either shape and can be re-run.)
2. Lets `cam_assignments` name a CAM **without a login** (`party_id` →
   `work_parties`). RLS unchanged: `is_cam_of()` still matches `cam_id`.
3. Loads the 36 client→CAM pairs from the production template.
4. Creates `addon_codes` (empty by design — Momentum approves the list).

## Still open with Michelle / Chris

- Momentum's own formulas for days in A/R and payment per visit (Monty/David).
- The "CAM Dashboard Snapshot 2026" workbook — if it holds Momentum's computed
  figures, import those rather than recomputing.
- Denial count unit (claim / visit / line) and which adjustments are excluded.
- CRL response target, if a pass/fail "compliance" figure is wanted.
- Add-on CPT list; whether dollars mean charges, payments or both.
- Patient-over-25 definitions; EMR task export; AdvancedMD collections and
  Prompt exports for collector received/resolved/pending.

## Billing system (migration 031, 2 Oct 2026)

`clinics.billing_system` is `advancedmd` (default), `prompt` or `other`. Nine
clients are on **Prompt**: Performance Plus PT, Fullerton PT, Solutions PT,
Pro-Motion, Rhodes PT, Star PT, Movement Works, Cox PT, Body Logic. Prompt
clients are not in the AdvancedMD packs, ODBC feed or collections module, so
the page labels them and says they need a Prompt export rather than showing
"nothing imported". Set per clinic under Settings → Clinics.
