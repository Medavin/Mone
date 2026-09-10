/**
 * The two measures Michelle asked for on the clinic cards.
 *
 * ⚠ THE FORMULAS ARE PROVISIONAL. Pravin has asked David and Monty to
 * state how Momentum calculates these, so that MBOne produces the number
 * they already quote clients rather than a defensible-looking number of
 * its own. Until that answer arrives, the method used is named on screen
 * next to the figure — a metric whose definition is invisible is a metric
 * two people will read differently and both believe.
 *
 * When the real definitions come back, change them HERE and nowhere else.
 */

export type ArMonth = {
  period_month: string;
  closing_ar: number | null;
};

export type ActivityMonth = {
  period_month: string;
  charges: number | null;
  payments: number | null;
  visits: number | null;
};

/** How days in A/R is being computed until Momentum states otherwise. */
export const DAYS_IN_AR_METHOD =
  "closing A/R divided by average daily charges over the last three months";

/**
 * Days in A/R.
 *
 * Closing A/R over average daily charges. A three-month charge base is used
 * rather than a single month because one quiet month — a holiday period, a
 * clinic closed for a fortnight — otherwise sends the figure up sharply
 * while nothing about the receivable has changed.
 *
 * Returns null rather than a number when there is not enough history. A
 * days figure computed from one month is not a worse estimate, it is a
 * different measure, and printing it as though it were the same thing is
 * how a client conversation goes wrong.
 */
export function daysInAr(
  closingAr: number | null,
  activity: ActivityMonth[],
  months = 3
): number | null {
  if (closingAr === null || closingAr <= 0) return null;

  const recent = [...activity]
    .sort((a, b) => b.period_month.localeCompare(a.period_month))
    .slice(0, months)
    .filter((m) => (m.charges ?? 0) > 0);

  if (recent.length === 0) return null;

  const totalCharges = recent.reduce((t, m) => t + (m.charges ?? 0), 0);
  const dailyCharges = totalCharges / (recent.length * 30.4);
  if (dailyCharges <= 0) return null;

  return Math.round(closingAr / dailyCharges);
}

/** How average payment per visit is being computed until told otherwise. */
export const PAYMENT_PER_VISIT_METHOD =
  "payments received in the month divided by visits in the same month";

/**
 * Average payment per visit.
 *
 * Payments received in a month over visits in that same month. This is the
 * simple reading and it is slightly wrong: a payment arriving in March may
 * belong to a visit in January. Matching payments back to the visits that
 * produced them would be right, and needs claim-level data MBOne does not
 * have. The screen says which is being used.
 */
export function paymentPerVisit(month: ActivityMonth | undefined): number | null {
  if (!month) return null;
  const visits = month.visits ?? 0;
  const payments = month.payments ?? 0;
  if (visits <= 0) return null;
  return Math.round((payments / visits) * 100) / 100;
}

/**
 * Movement out of Current into the 30-day bucket.
 *
 * Michelle wanted this daily, as an early warning that something has begun
 * going wrong at a clinic before it becomes a denial. MBOne reads monthly
 * packs, so month-over-month is the best it can do today; a weekly feed
 * from AdvancedMD would make it weekly.
 *
 * A RISE in the 30-day bucket alongside a FALL in Current is the signal —
 * either one alone can be explained by the size of the month.
 */
export function slippage(
  now: { bucket_current: number | null; bucket_30: number | null } | undefined,
  before: { bucket_current: number | null; bucket_30: number | null } | undefined
): { moved: number; currentChange: number; thirtyChange: number } | null {
  if (!now || !before) return null;

  const currentChange = (now.bucket_current ?? 0) - (before.bucket_current ?? 0);
  const thirtyChange = (now.bucket_30 ?? 0) - (before.bucket_30 ?? 0);

  // Only report it when Current fell AND 30 rose. Either alone is noise.
  const moved = currentChange < 0 && thirtyChange > 0 ? Math.min(-currentChange, thirtyChange) : 0;

  return { moved, currentChange, thirtyChange };
}

export const money0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
