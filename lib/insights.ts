/**
 * Generates the written summary of a clinic's month from its own figures.
 *
 * Deliberately rule-based, not a language model. Monty takes these lines into a
 * client meeting, so every one of them has to be defensible: each is a stated
 * comparison between numbers on the page, and the number is always quoted so
 * the claim can be checked. Nothing here is generated prose.
 */

export type Tone = "good" | "watch" | "bad" | "neutral";
export type Insight = { tone: Tone; headline: string; detail?: string };

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const pctOf = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);
const p1 = (n: number) => `${n.toFixed(1)}%`;

export type MonthFacts = {
  month: string; // YYYY-MM
  openingAr: number | null;
  closingAr: number | null;
  arChange: number | null;
  charges: number | null;
  adjustments: number | null;
  paymentsPatient: number | null;
  paymentsInsurance: number | null;
  patientsWithBalance: number | null;
  classes: { code: string; name: string; total: number; over120: number }[];
  split: { payerType: string; total: number; unapplied: number }[];
  staleCarriers: { name: string; total: number; over120: number }[];
  /** Every month held for this clinic, oldest first. */
  history: { month: string; charges: number; payments: number; adjustments: number; visits: number; newPatients: number }[];
};

export function buildInsights(f: MonthFacts): Insight[] {
  const out: Insight[] = [];
  const totalAr = f.classes.reduce((a, c) => a + c.total, 0);
  const total120 = f.classes.reduce((a, c) => a + c.over120, 0);
  const payments = (f.paymentsPatient ?? 0) + (f.paymentsInsurance ?? 0);

  // --- 1. Which way A/R moved, and by how much relative to its size -------
  if (f.arChange !== null && f.openingAr) {
    const share = pctOf(Math.abs(f.arChange), f.openingAr);
    if (f.arChange > 0) {
      out.push({
        tone: share > 2 ? "bad" : "watch",
        headline: `A/R grew by ${money(f.arChange)} — ${p1(share)} of the opening balance.`,
        detail: `More was billed than was collected and written off. Charges ${money(
          f.charges ?? 0
        )} against payments ${money(payments)}.`,
      });
    } else {
      out.push({
        tone: "good",
        headline: `A/R fell by ${money(Math.abs(f.arChange))} — ${p1(share)} of the opening balance.`,
        detail: `Collections and adjustments together outpaced new charges.`,
      });
    }
  }

  // --- 2. How much of the balance has stopped moving ----------------------
  if (totalAr > 0) {
    const stale = pctOf(total120, totalAr);
    out.push({
      tone: stale > 60 ? "bad" : stale > 35 ? "watch" : "good",
      headline: `${p1(stale)} of A/R is over 120 days — ${money(total120)}.`,
      detail:
        stale > 60
          ? "Most of the balance is old enough that recovery rates fall sharply. The question for the meeting is which part of it is still collectable."
          : undefined,
    });
  }

  // --- 3. Concentration: is one class the whole story? --------------------
  const ranked = [...f.classes].sort((a, b) => b.total - a.total);
  const top = ranked[0];
  if (top && totalAr > 0) {
    const share = pctOf(top.total, totalAr);
    if (share > 40) {
      const topStale = pctOf(top.over120, top.total);
      out.push({
        tone: share > 70 ? "bad" : "watch",
        headline: `${top.name} alone is ${p1(share)} of the balance — ${money(top.total)}.`,
        detail: `${p1(topStale)} of it is over 120 days. Clinic-level totals will move only if this class moves.`,
      });
    }
  }

  // --- 4. Collection rate, this month against its own recent history ------
  if (f.charges && f.charges > 0) {
    const rate = pctOf(payments, f.charges);
    const prior = f.history.filter((h) => h.month < f.month).slice(-12);
    const priorBilled = prior.reduce((a, h) => a + h.charges, 0);
    const priorPaid = prior.reduce((a, h) => a + h.payments, 0);
    const priorRate = pctOf(priorPaid, priorBilled);

    if (prior.length >= 3 && priorBilled > 0) {
      const diff = rate - priorRate;
      out.push({
        tone: diff < -5 ? "bad" : diff < -1 ? "watch" : "good",
        headline: `Collected ${p1(rate)} of what was billed this month, against ${p1(
          priorRate
        )} over the previous ${prior.length} months.`,
        detail:
          diff < -1
            ? "Payments are lagging the recent pattern for this clinic."
            : "In line with, or ahead of, the recent pattern.",
      });
    } else {
      out.push({
        tone: "neutral",
        headline: `Collected ${p1(rate)} of what was billed this month.`,
        detail: "Not enough history loaded yet to compare against this clinic's own pattern.",
      });
    }
  }

  // --- 5. Adjustments as a share of charges -------------------------------
  if (f.charges && f.charges > 0 && f.adjustments) {
    const adjShare = pctOf(Math.abs(f.adjustments), f.charges);
    out.push({
      tone: adjShare > 45 ? "watch" : "neutral",
      headline: `Adjustments were ${p1(adjShare)} of charges — ${money(Math.abs(f.adjustments))}.`,
      detail:
        adjShare > 45
          ? "A high write-off share. Worth knowing whether that is contractual or avoidable."
          : undefined,
    });
  }

  // --- 6. Volume: this month against the same month a year earlier -------
  const thisMonth = f.history.find((h) => h.month === f.month);
  const yearAgo = f.history.find((h) => {
    const [y, m] = f.month.split("-").map(Number);
    return h.month === `${y - 1}-${String(m).padStart(2, "0")}`;
  });
  if (thisMonth && yearAgo && yearAgo.visits > 0) {
    const change = pctOf(thisMonth.visits - yearAgo.visits, yearAgo.visits);
    out.push({
      tone: change < -10 ? "bad" : change < 0 ? "watch" : "good",
      headline: `${thisMonth.visits.toLocaleString()} visits, ${
        change >= 0 ? "up" : "down"
      } ${p1(Math.abs(change))} on the same month last year.`,
      detail:
        change < 0
          ? "Visits drive charges, so a fall here shows up in revenue a month or two later."
          : undefined,
    });
  }

  // --- 7. Who actually owes it -------------------------------------------
  const patient = f.split.find((s) => s.payerType === "patient");
  if (patient && totalAr > 0) {
    const share = pctOf(patient.total, totalAr);
    if (share > 50) {
      out.push({
        tone: "watch",
        headline: `${p1(share)} of the balance is owed by patients, not insurers — ${money(
          patient.total
        )}.`,
        detail:
          "Patient balances behave differently from claims: they are not denied or appealed, they are chased. That is a different collection process.",
      });
    }
  }

  // --- 8. Payers that have effectively stopped paying --------------------
  if (f.staleCarriers.length > 0) {
    const total = f.staleCarriers.reduce((a, c) => a + c.total, 0);
    const worst = f.staleCarriers[0];
    out.push({
      tone: "bad",
      headline: `${f.staleCarriers.length} ${
        f.staleCarriers.length === 1 ? "carrier has" : "carriers have"
      } almost nothing moving — ${money(total)} outstanding, nearly all of it over 120 days.`,
      detail: `Worst is ${worst.name} at ${money(worst.total)}, of which ${money(
        worst.over120
      )} is past 120 days. These are the ones to raise directly with the payer.`,
    });
  }

  // --- 9. Money received but not posted ---------------------------------
  const unapplied = f.split.reduce((a, s) => a + Math.abs(s.unapplied), 0);
  if (unapplied > 0 && totalAr > 0 && pctOf(unapplied, totalAr) > 1) {
    out.push({
      tone: "watch",
      headline: `${money(unapplied)} of payments are received but not yet posted to a claim.`,
      detail: "Until it is applied, A/R reads higher and collections read lower than they are.",
    });
  }

  return out;
}

/** One sentence for the top of the page or the export. */
export function headlineSentence(f: MonthFacts, clinicName: string): string {
  const totalAr = f.classes.reduce((a, c) => a + c.total, 0);
  const total120 = f.classes.reduce((a, c) => a + c.over120, 0);
  const dir = (f.arChange ?? 0) > 0 ? "rose" : "fell";

  return (
    `${clinicName} closed the month with ${money(f.closingAr ?? 0)} outstanding, ` +
    `${dir} ${money(Math.abs(f.arChange ?? 0))} on the month, with ` +
    `${p1(pctOf(total120, totalAr))} of it over 120 days.`
  );
}
