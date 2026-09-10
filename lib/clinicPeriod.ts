import { loadClinicMonth, type ClinicMonth } from "./clinicMonth";

/**
 * A clinic's figures across a period rather than a single month.
 *
 * ⚠ THE ONE THING THAT MATTERS HERE: FLOWS SUM, BALANCES DO NOT.
 *
 * Charges, payments, adjustments, units and visits are FLOWS — things that
 * happened during the period — so a three-month pack adds them up.
 *
 * A/R is a BALANCE. It is what was outstanding at a moment in time. Adding
 * January's closing A/R to February's would produce a number that means
 * nothing and looks plausible, which is the worst combination. So every
 * balance comes from the LAST month in the range, and the opening balance
 * comes from the FIRST.
 *
 * The same rule decides the patient-balance figures: a count of patients with
 * balances is a snapshot, not a total, so it too comes from the last month.
 */

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Every YYYY-MM from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Sum two rows of numbers, keyed the same way. */
function addInto(target: Record<string, number>, source: Record<string, unknown>, keys: string[]) {
  for (const k of keys) target[k] = n(target[k]) + n(source[k]);
}

const FLOW_ACTIVITY = ["units", "charges", "payments", "adjustments", "visits", "new_patients"];
const FLOW_SUMMARY = [
  "charges", "payments", "adjustments", "patient_payments", "insurance_payments",
  "units", "visits", "new_patients",
];

export type Period = { from: string; to: string; label: string };

/**
 * Loads a clinic across a period and folds it into the same shape a single
 * month produces, so the pack builder needs no idea which it was given.
 */
export async function loadClinicPeriod(
  clinicId: number,
  from: string,
  to: string
): Promise<(ClinicMonth & { period: Period }) | null> {
  const wanted = monthsBetween(from, to);
  if (wanted.length === 0) return null;

  const loaded: ClinicMonth[] = [];
  for (const m of wanted) {
    const one = await loadClinicMonth(clinicId, m);
    // A month with no summary row has nothing in it; skip rather than let
    // it drag zeros into the totals.
    if (one && one.summaryRow) loaded.push(one);
  }

  if (loaded.length === 0) {
    // Still return the shell so the caller can say "nothing for this period"
    // rather than failing — an empty answer is information.
    const shell = await loadClinicMonth(clinicId, wanted[wanted.length - 1]);
    return shell ? { ...shell, period: { from, to, label: periodLabel(from, to) } } : null;
  }

  const first = loaded[0];
  const last = loaded[loaded.length - 1];

  if (loaded.length === 1) {
    return { ...last, period: { from, to, label: periodLabel(from, to) } };
  }

  // ---- summary: flows summed, balances taken from the ends ----
  const summary: Record<string, number | null> = {};
  for (const m of loaded) addInto(summary as Record<string, number>, m.summaryRow ?? {}, FLOW_SUMMARY);

  summary.opening_ar = n(first.summaryRow?.opening_ar);
  summary.closing_ar = n(last.summaryRow?.closing_ar);
  summary.unapplied = n(last.summaryRow?.unapplied);
  summary.patients_with_balances = n(last.summaryRow?.patients_with_balances);
  summary.average_patient_balance = n(last.summaryRow?.average_patient_balance);

  // ---- activity by financial class: all flows, so sum every month ----
  const activityBy = new Map<number, Record<string, number>>();
  for (const m of loaded) {
    for (const row of m.activity as Record<string, number>[]) {
      const id = Number(row.financial_class_id);
      const acc = activityBy.get(id) ?? { financial_class_id: id };
      addInto(acc, row, FLOW_ACTIVITY);
      activityBy.set(id, acc);
    }
  }

  // ---- services and referrals are flows too ----
  const serviceBy = new Map<string, { code: string; desc: string; units: number; charges: number }>();
  for (const m of loaded) {
    for (const s of m.services) {
      const key = s.code;
      const acc = serviceBy.get(key) ?? { code: s.code, desc: s.desc, units: 0, charges: 0 };
      acc.units += n(s.units);
      acc.charges += n(s.charges);
      serviceBy.set(key, acc);
    }
  }

  const referralBy = new Map<string, { name: string; city: string; row: Record<string, number> }>();
  for (const m of loaded) {
    for (const r of m.referrals) {
      const acc = referralBy.get(r.name) ?? { name: r.name, city: r.city, row: {} };
      addInto(acc.row, r.row, ["visits", "new_patients", "charges", "payments"]);
      referralBy.set(r.name, acc);
    }
  }

  return {
    ...last,                    // balances, classes, months, history all from the end
    summaryRow: summary,
    activity: Array.from(activityBy.values()),
    services: Array.from(serviceBy.values()).sort((a, b) => b.charges - a.charges),
    referrals: Array.from(referralBy.values()).sort((a, b) => n(b.row.charges) - n(a.row.charges)),
    // ar, split and carriers stay as the LAST month's — they are balances.
    period: { from, to, label: periodLabel(from, to) },
  };
}

export function periodLabel(from: string, to: string) {
  const fmt = (m: string) =>
    new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return from === to ? fmt(from) : `${fmt(from)} to ${fmt(to)}`;
}
