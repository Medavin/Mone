import * as XLSX from "xlsx";
import { rangeFromFileName } from "@/lib/parsePromptAr";

/**
 * Prompt EMR — "Visits Revenue Report" (Reports → Revenue), downloaded
 * 2 Oct 2026 from Performance PT's account.
 *
 * Prompt's own "Summary" sheet is by INSURANCE COMPANY, not by facility,
 * so the per-facility figures MBOne needs are added up from "All Data" —
 * one row per appointment. That sheet carries patient names, so:
 *
 * ⚠ PHI RULE. Only these columns are read: DOS, Visit Stage, Visit Type,
 * Visit Facility, Case Primary Payer Reporting Type, Last Billed, Patient
 * Paid, Primary/Secondary Insurance Paid, Total Paid — plus Patient
 * Account Number, used ONLY to count distinct patients for "patients over
 * 25 visits" and never stored. The name, DOB, case title (which can hold a
 * diagnosis) and every other column are never read. The file is read in
 * the browser; only totals per facility per month are saved.
 *
 * DEFINITIONS (shown on screen, provisional until Michelle confirms):
 *   visits    — appointments NOT cancelled or no-show. Prompt's own
 *               "Total Visits" counts every appointment, cancellations
 *               included (5,815 in September where 4,847 happened).
 *   new patients — Initial Evaluations.
 *   charges   — "Last Billed".
 *   payments  — "Total Paid" so far on visits dated in the month. NOT the
 *               cash posted in the month (AdvancedMD's figure): recent
 *               visits are mostly unpaid when the report is run, and the
 *               figure grows if the month is downloaded again later.
 */

export const NOT_A_VISIT = new Set(["Patient Canceled", "No Show", "Center Canceled", "Clinic Canceled", "Canceled"]);
export const OVER_VISITS = 25;

export type RevenueCell = {
  appointments: number; visits: number; cancelled: number; noShow: number; evals: number;
  billed: number; paid: number; patientPaid: number; insurancePaid: number;
};
export type PromptRevenue = {
  rangeFrom: string | null; rangeTo: string | null;
  /** facility → month (YYYY-MM) → payer type → figures */
  cells: Map<string, Map<string, Map<string, RevenueCell>>>;
  facilities: string[];
  months: string[];
  fullMonths: string[];               // months the date range covers end to end
  /**
   * Completed visits per patient per facility — ONLY when the file starts
   * on 1 January, and ONLY held in the browser. The import merges the
   * facilities that belong to one client (a patient seen at two locations
   * counts once) and saves just two numbers: patients, and patients over 25.
   */
  patientVisits: { year: number; byFacility: Map<string, Map<string, number>> } | null;
  totals: { appointments: number; billed: number; paid: number };
  summaryTotals: { appointments: number; billed: number; paid: number } | null;
  issues: { level: "error" | "warn"; message: string }[];
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,]/g, "")) || 0);
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const iso = (v: unknown): string | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime()))
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  if (typeof v === "number" && v > 30000 && v < 80000)
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  const m = txt(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
};
const empty = (): RevenueCell => ({ appointments: 0, visits: 0, cancelled: 0, noShow: 0, evals: 0, billed: 0, paid: 0, patientPaid: 0, insurancePaid: 0 });

export function isPromptRevenue(wb: XLSX.WorkBook) {
  return wb.SheetNames.includes("All Data") && wb.SheetNames.includes("Summary") &&
    wb.SheetNames.some((s) => /revenue by insurance type|reimbursement by insurance type/i.test(s));
}

export function parsePromptRevenue(wb: XLSX.WorkBook, fileName = ""): PromptRevenue {
  const issues: PromptRevenue["issues"] = [];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["All Data"], { header: 1, raw: true, defval: null }) as unknown[][];
  const head = (rows[0] ?? []).map(txt);
  const col = (name: string) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const C = {
    acct: col("Patient Account Number"), dos: col("DOS"), stage: col("Visit Stage"), type: col("Visit Type"),
    fac: col("Visit Facility"), payer: col("Case Primary Payer Reporting Type"), billed: col("Last Billed"),
    ptPaid: col("Patient Paid"), priPaid: col("Primary Insurance Paid"), secPaid: col("Secondary Insurance Paid"),
    paid: col("Total Paid"),
  };
  for (const [k, i] of Object.entries(C)) {
    if (i < 0) issues.push({ level: "error", message: `The 'All Data' sheet has no column for ${k} — Prompt may have changed the report.` });
  }
  if (issues.length) {
    return { rangeFrom: null, rangeTo: null, cells: new Map(), facilities: [], months: [], fullMonths: [], patientVisits: null, totals: { appointments: 0, billed: 0, paid: 0 }, summaryTotals: null, issues };
  }

  const range = rangeFromFileName(fileName.replace(/Revenue_Report_-_/i, ""));
  const cells: PromptRevenue["cells"] = new Map();
  const totals = { appointments: 0, billed: 0, paid: 0 };
  const perPatient = new Map<string, Map<string, number>>(); // facility → account → completed visits
  let noDate = 0;

  for (const r of rows.slice(1)) {
    const facility = txt(r[C.fac]);
    const dos = iso(r[C.dos]);
    if (!facility && !dos) continue; // blank trailing rows
    if (!dos) { noDate++; continue; }
    const month = dos.slice(0, 7);
    const payer = txt(r[C.payer]) || "No payer";
    const stage = txt(r[C.stage]);
    const byM = cells.get(facility) ?? new Map();
    const byP = byM.get(month) ?? new Map();
    const c: RevenueCell = byP.get(payer) ?? empty();
    c.appointments += 1;
    if (stage === "No Show") c.noShow += 1;
    else if (NOT_A_VISIT.has(stage)) c.cancelled += 1;
    else {
      c.visits += 1;
      if (/initial evaluation/i.test(txt(r[C.type]))) c.evals += 1;
      const acct = txt(r[C.acct]);
      if (acct) {
        const m = perPatient.get(facility) ?? new Map<string, number>();
        m.set(acct, (m.get(acct) ?? 0) + 1);
        perPatient.set(facility, m);
      }
    }
    c.billed += num(r[C.billed]);
    c.paid += num(r[C.paid]);
    c.patientPaid += num(r[C.ptPaid]);
    c.insurancePaid += num(r[C.priPaid]) + num(r[C.secPaid]);
    byP.set(payer, c); byM.set(month, byP); cells.set(facility, byM);
    totals.appointments += 1;
    totals.billed += num(r[C.billed]);
    totals.paid += num(r[C.paid]);
  }
  if (noDate) issues.push({ level: "warn", message: `${noDate} rows had no date of service and were left out.` });

  // ---- checksum against Prompt's own Summary sheet ---------------------
  let summaryTotals: PromptRevenue["summaryTotals"] = null;
  const sum = XLSX.utils.sheet_to_json(wb.Sheets["Summary"], { header: 1, raw: true, defval: null }) as unknown[][];
  if (sum.length > 1) {
    const h = sum[0].map(txt);
    const iv = h.indexOf("Total Visits"), ib = h.indexOf("Total Billed"), ip = h.indexOf("Total Paid");
    if (iv >= 0 && ib >= 0 && ip >= 0) {
      summaryTotals = { appointments: 0, billed: 0, paid: 0 };
      for (const r of sum.slice(1)) {
        if (!txt(r[0]) || /^total$/i.test(txt(r[0]))) continue;
        summaryTotals.appointments += num(r[iv]); summaryTotals.billed += num(r[ib]); summaryTotals.paid += num(r[ip]);
      }
      const off = (a: number, b: number) => Math.abs(a - b) > 0.5;
      if (off(summaryTotals.appointments, totals.appointments + noDate) || off(summaryTotals.billed, totals.billed) || off(summaryTotals.paid, totals.paid)) {
        issues.push({
          level: "error",
          message: `The rows add up to ${totals.appointments} appointments, $${totals.billed.toFixed(2)} billed, $${totals.paid.toFixed(2)} paid; Prompt's Summary says ${summaryTotals.appointments}, $${summaryTotals.billed.toFixed(2)}, $${summaryTotals.paid.toFixed(2)}.`,
        });
      }
    }
  }

  const facilities = Array.from(cells.keys()).sort();
  const months = Array.from(new Set(facilities.flatMap((f) => Array.from(cells.get(f)!.keys())))).sort();

  // A month is only loaded when the date range covers ALL of it — a month
  // with one day of data would read as a disastrous month.
  const fullMonths = months.filter((m) => {
    if (!range.from || !range.to) return false;
    const [y, mo] = m.split("-").map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    return range.from <= `${m}-01` && range.to >= last;
  });
  if (!range.from) issues.push({ level: "warn", message: "No date range in the file name, so no month can be confirmed as complete. Choose the month by hand." });

  // Patients over 25 visits — only meaningful counted from 1 January.
  const patientVisits = range.from && /-01-01$/.test(range.from)
    ? { year: Number(range.from.slice(0, 4)), byFacility: perPatient }
    : null;

  return {
    rangeFrom: range.from, rangeTo: range.to, cells, facilities, months, fullMonths,
    patientVisits,
    totals, summaryTotals, issues,
  };
}

/** Add up a facility's figures for one month across payer types. */
export function facilityMonth(p: PromptRevenue, facility: string, month: string): RevenueCell {
  const out = empty();
  for (const c of Array.from(p.cells.get(facility)?.get(month)?.values() ?? [])) {
    for (const k of Object.keys(out) as (keyof RevenueCell)[]) out[k] += c[k];
  }
  return out;
}

/** Merge several facilities' patients into one client's two numbers. */
export function overCount(byFacility: Map<string, Map<string, number>>, facilities: string[]) {
  const merged = new Map<string, number>();
  for (const f of facilities) {
    for (const [acct, n] of Array.from(byFacility.get(f)?.entries() ?? [])) merged.set(acct, (merged.get(acct) ?? 0) + n);
  }
  return { patients: merged.size, over: Array.from(merged.values()).filter((n) => n > OVER_VISITS).length };
}
