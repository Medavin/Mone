/**
 * The arithmetic behind the Client & CAM Results page (Michelle's spec,
 * 29 Sep 2026). Pure functions, no database, so every rule sits in one
 * place and reads the same on screen and in the export.
 *
 * THE RULE THAT MATTERS MOST, from her own spec: "do not sum rates or
 * averages across clients". Flows (visits, payments, change in A/R) add
 * up. Balances (A/R, insurance A/R) are taken at the LAST month, never
 * summed across months. Ratios (payment per visit, days in A/R, 120+
 * share) are RECOMPUTED from their numerators and denominators — the
 * average of five clients' percentages is not the company's percentage.
 */

import { daysInAr } from "@/lib/arMetrics";

/** Michelle's reference points. Change them here and nowhere else. */
export const DAYS_IN_AR_TARGET = 30;   // "use 30 days in AR as an initial reference point"
export const OVER_120_LIMIT = 5;       // "the aging target is under 5% (strictly less than 5%)"
export const TREND_TOLERANCE = 10;     // % rise in days in A/R vs the client's own prior 3 months

export type MonthFacts = {
  month: string;                  // YYYY-MM
  visits: number | null;
  payments: number | null;
  charges: number | null;
  arChange: number | null;        // clinic_monthly.ar_change
  closingAr: number | null;       // ar_clinic_month.closing_ar (gross, all classes)
  insTotal: number | null;        // ar_split_monthly insurance total_ar
  ins120: number | null;          // ar_split_monthly insurance bucket_120_plus
  insNet: number | null;          // ar_split_monthly insurance net_ar
};

export type Snapshot = {
  visits: number | null;
  payments: number | null;
  arChange: number | null;
  paymentPerVisit: number | null;
  daysInAr: number | null;
  over120Share: number | null;    // % of insurance A/R past 120 days
  insNetAr: number | null;
  asOf: string | null;            // the month the balances are taken from
  monthsWithData: number;
};

const sumOrNull = (xs: (number | null)[]) => {
  const present = xs.filter((x): x is number => x !== null && x !== undefined);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};

/**
 * One client over a period. `history` is every month we hold for the
 * client up to the end of the period (needed for the three-month days in
 * A/R base); `inRange` restricts which months count as the period.
 */
export function clientSnapshot(history: MonthFacts[], from: string, to: string): Snapshot {
  const sorted = [...history].sort((a, b) => a.month.localeCompare(b.month));
  const period = sorted.filter((m) => m.month >= from && m.month <= to);
  const upToEnd = sorted.filter((m) => m.month <= to);

  // The last month in the period that actually has a balance.
  const last = [...period].reverse().find((m) => m.closingAr !== null || m.insTotal !== null) ?? null;

  const visits = sumOrNull(period.map((m) => m.visits));
  const payments = sumOrNull(period.map((m) => m.payments));

  const days = last
    ? daysInAr(
        last.closingAr,
        upToEnd
          .filter((m) => m.month <= last.month)
          .map((m) => ({ period_month: m.month, charges: m.charges, payments: m.payments, visits: m.visits }))
      )
    : null;

  return {
    visits,
    payments,
    arChange: sumOrNull(period.map((m) => m.arChange)),
    paymentPerVisit: visits && payments !== null ? payments / visits : null,
    daysInAr: days,
    over120Share:
      last && last.insTotal && last.insTotal > 0 && last.ins120 !== null
        ? (last.ins120 / last.insTotal) * 100
        : null,
    insNetAr: last?.insNet ?? last?.insTotal ?? null,
    asOf: last?.month ?? null,
    monthsWithData: period.filter((m) => m.visits !== null || m.closingAr !== null).length,
  };
}

/**
 * Several clients combined — recomputed, never averaged.
 * Days in A/R for a group = the group's closing A/R over the group's
 * average daily charges, which is what a one-client figure means too.
 */
export function combinedSnapshot(clients: MonthFacts[][], from: string, to: string): Snapshot {
  const byMonth = new Map<string, MonthFacts>();
  for (const h of clients) {
    for (const m of h) {
      const t = byMonth.get(m.month) ?? {
        month: m.month, visits: null, payments: null, charges: null, arChange: null,
        closingAr: null, insTotal: null, ins120: null, insNet: null,
      };
      const add = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b);
      t.visits = add(t.visits, m.visits);
      t.payments = add(t.payments, m.payments);
      t.charges = add(t.charges, m.charges);
      t.arChange = add(t.arChange, m.arChange);
      t.closingAr = add(t.closingAr, m.closingAr);
      t.insTotal = add(t.insTotal, m.insTotal);
      t.ins120 = add(t.ins120, m.ins120);
      t.insNet = add(t.insNet, m.insNet ?? m.insTotal);
      byMonth.set(m.month, t);
    }
  }
  return clientSnapshot(Array.from(byMonth.values()), from, to);
}

/** Days in A/R for each month of the period — the trend line. */
export function daysTrend(history: MonthFacts[], from: string, to: string) {
  const sorted = [...history].sort((a, b) => a.month.localeCompare(b.month));
  return sorted
    .filter((m) => m.month >= from && m.month <= to)
    .map((m) => ({
      month: m.month,
      days: daysInAr(
        m.closingAr,
        sorted
          .filter((x) => x.month <= m.month)
          .map((x) => ({ period_month: x.month, charges: x.charges, payments: x.payments, visits: x.visits }))
      ),
    }));
}

export type Signal = "ok" | "watch" | "unknown";

/**
 * Three SEPARATE signals, deliberately not one grade. Michelle's spec:
 * "A single combined health grade needs an agreed trend window and
 * tolerance before implementation." Until that is agreed, each test is
 * shown on its own with the rule written beside it.
 */
export function signals(snap: Snapshot, trend: { days: number | null }[]) {
  const days: Signal =
    snap.daysInAr === null ? "unknown" : snap.daysInAr <= DAYS_IN_AR_TARGET ? "ok" : "watch";

  const aging: Signal =
    snap.over120Share === null ? "unknown" : snap.over120Share < OVER_120_LIMIT ? "ok" : "watch";

  // Latest days in A/R against the mean of the three months before it.
  const known = trend.map((t) => t.days).filter((d): d is number => d !== null);
  let direction: Signal = "unknown";
  let change: number | null = null;
  if (known.length >= 4) {
    const latest = known[known.length - 1];
    const prior = known.slice(-4, -1);
    const base = prior.reduce((a, b) => a + b, 0) / prior.length;
    change = base > 0 ? ((latest - base) / base) * 100 : null;
    direction = change === null ? "unknown" : change > TREND_TOLERANCE ? "watch" : "ok";
  }

  return { days, aging, direction, change };
}

/** Last calendar day of a YYYY-MM month, as YYYY-MM-DD. */
export function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
