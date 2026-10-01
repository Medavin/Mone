import * as XLSX from "xlsx";

/**
 * Prompt EMR — "A/R Report" (Reports → Revenue → A/R Report), as
 * downloaded on 2 Oct 2026 from Performance PT's account.
 *
 * ⚠ PHI RULE: this parser reads TWO sheets only, and both are totals:
 *   - "AR by Facility"        facility × bucket, for primary insurance,
 *                             secondary insurance and patient A/R
 *   - "Primary Aging Summary" insurance company × bucket
 * The other sheets ("Primary AR Data", "Patient AR Data", "Patient Aging
 * Summary"…) hold patient names, dates of birth and member IDs. They are
 * NEVER read, except one column — "As of Date" — which is the report's
 * date, not a patient fact. The file is read in the browser; only the
 * totals below are sent to the database.
 *
 * Prompt's buckets are 0-30 / 31-60 / 61-90 / 91-120 / 121-365 / 366+.
 * MBOne's are Current / 30 / 60 / 90 / 120+, so 121-365 and 366+ add up
 * into 120+. Every other bucket maps one to one.
 *
 * A Prompt "facility" is a LOCATION. One Momentum client can have several
 * (Performance PT has Otay Ranch, Terra Nova, Imperial Beach, National
 * City), so the import maps each facility to a client and adds them up.
 */

export type Buckets = { current: number; d30: number; d60: number; d90: number; d120: number; total: number };
export type FacilityAr = { facility: string; claims: number | null; primary: Buckets; secondary: Buckets; patient: Buckets };
export type PayerAr = { type: string; payer: string; claims: number | null } & Buckets;

export type PromptAr = {
  asOf: string | null;              // YYYY-MM-DD, from the report itself
  asOfSource: string;
  rangeFrom: string | null;         // the date filter, read from the file name when present
  rangeTo: string | null;
  facilities: FacilityAr[];
  payers: PayerAr[];
  grand: { primary: number; secondary: number; patient: number; total: number } | null;
  issues: { level: "error" | "warn"; message: string }[];
};

const zero = (): Buckets => ({ current: 0, d30: 0, d60: 0, d90: 0, d120: 0, total: 0 });
const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = v.replace(/[$,\s]/g, "");
    if (/^\(.*\)$/.test(t)) return -Number(t.slice(1, -1)) || 0;
    return Number(t) || 0;
  }
  return 0;
};
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const round = (n: number) => Math.round(n * 100) / 100;

/** Six Prompt bucket cells, in order 0-30 … 366+, into MBOne's five. */
function bucketsFrom(cells: unknown[], totalCell: unknown): Buckets {
  const b = cells.map(num);
  return {
    current: b[0], d30: b[1], d60: b[2], d90: b[3],
    d120: round(b[4] + b[5]),
    total: num(totalCell),
  };
}

function toIso(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  }
  if (typeof v === "number" && v > 30000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  }
  const m = txt(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

/** "AR_Report_-_09-26-26_to_10-02-26.xlsx" → the From and To dates. */
export function rangeFromFileName(name: string): { from: string | null; to: string | null } {
  // Browsers save the same download as "AR_Report_-_09-26-26_to_10-02-26"
  // or "AR Report - 09-26-26 to 10-02-26" — accept spaces or underscores.
  const m = name.match(/(\d{2})-(\d{2})-(\d{2})[\s_]+to[\s_]+(\d{2})-(\d{2})-(\d{2})/i);
  if (!m) return { from: null, to: null };
  return { from: `20${m[3]}-${m[1]}-${m[2]}`, to: `20${m[6]}-${m[4]}-${m[5]}` };
}

export function isPromptAr(wb: XLSX.WorkBook) {
  return wb.SheetNames.includes("AR by Facility") && wb.SheetNames.some((s) => /aging summary/i.test(s));
}

export function parsePromptAr(wb: XLSX.WorkBook, fileName = ""): PromptAr {
  const issues: PromptAr["issues"] = [];
  const grid = (sheet: string): unknown[][] => {
    const ws = wb.Sheets[sheet];
    return ws ? (XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][]) : [];
  };

  // ---- AR by Facility: four stacked blocks, each "title row → header row
  // → facility rows → Total row". Read by TITLE, never by row position.
  const fac = grid("AR by Facility");
  if (!fac.length) issues.push({ level: "error", message: "No 'AR by Facility' sheet — this does not look like Prompt's A/R Report." });

  const blocks: Record<string, Map<string, { claims: number | null; b: Buckets }>> = {};
  const blockTotals: Record<string, number> = {};
  let section: string | null = null;
  for (const row of fac) {
    const a = txt(row[0]);
    if (/^primary insurance a\/r$/i.test(a)) { section = "primary"; continue; }
    if (/^secondary insurance a\/r$/i.test(a)) { section = "secondary"; continue; }
    if (/^patient a\/r$/i.test(a)) { section = "patient"; continue; }
    if (/^total a\/r by/i.test(a)) { section = null; continue; } // derived blocks — used as checks only
    if (!section || !a || /^facility$/i.test(a)) continue;
    if (/^total$/i.test(a)) { blockTotals[section] = num(row[2]); continue; }
    (blocks[section] ??= new Map()).set(a, {
      claims: row[1] === null ? null : num(row[1]),
      b: bucketsFrom(row.slice(3, 9), row[2]),
    });
  }

  // The report's own "Total A/R by Facility" block — the checksum.
  let grand: PromptAr["grand"] = null;
  const byFacTotal = new Map<string, number>();
  let inTotals = false;
  for (const row of fac) {
    const a = txt(row[0]);
    if (/^total a\/r by facility$/i.test(a)) { inTotals = true; continue; }
    if (!inTotals || !a || /^facility$/i.test(a)) continue;
    if (/^total$/i.test(a)) {
      grand = { primary: num(row[1]), secondary: num(row[2]), patient: num(row[3]), total: num(row[4]) };
      break;
    }
    byFacTotal.set(a, num(row[4]));
  }

  const names = new Set<string>();
  for (const s of ["primary", "secondary", "patient"]) for (const k of Array.from(blocks[s]?.keys() ?? [])) names.add(k);
  const facilities: FacilityAr[] = Array.from(names).sort().map((f) => ({
    facility: f,
    claims: blocks.primary?.get(f)?.claims ?? null,
    primary: blocks.primary?.get(f)?.b ?? zero(),
    secondary: blocks.secondary?.get(f)?.b ?? zero(),
    patient: blocks.patient?.get(f)?.b ?? zero(),
  }));

  // ---- checks: every block against its own Total row, and each facility
  // against the Total A/R by Facility block. A file that disagrees with
  // itself is refused, not loaded.
  for (const s of ["primary", "secondary", "patient"] as const) {
    const sum = round(facilities.reduce((t, f) => t + f[s].total, 0));
    if (blockTotals[s] !== undefined && Math.abs(sum - blockTotals[s]) > 0.01) {
      issues.push({ level: "error", message: `${s} A/R facilities add up to ${sum}, but the report's Total row says ${blockTotals[s]}.` });
    }
    for (const f of facilities) {
      const b = f[s];
      const bsum = round(b.current + b.d30 + b.d60 + b.d90 + b.d120);
      if (Math.abs(bsum - b.total) > 0.01) {
        issues.push({ level: "error", message: `${f.facility} ${s} A/R: buckets add up to ${bsum}, total says ${b.total}.` });
      }
    }
  }
  for (const f of facilities) {
    const t = byFacTotal.get(f.facility);
    const mine = round(f.primary.total + f.secondary.total + f.patient.total);
    if (t !== undefined && Math.abs(mine - t) > 0.01) {
      issues.push({ level: "error", message: `${f.facility}: primary + secondary + patient = ${mine}, but Total A/R by Facility says ${t}.` });
    }
  }

  // ---- Primary Aging Summary: insurance type rows (col A) with their
  // companies beneath (col B). Companies are what MBOne calls carriers.
  const payers: PayerAr[] = [];
  let type = "";
  for (const row of grid("Primary Aging Summary").slice(1)) {
    const a = txt(row[0]);
    const b = txt(row[1]);
    if (a && !b) { type = a; continue; }
    if (!b || /^total$/i.test(b) || /^total$/i.test(a)) continue;
    payers.push({ type, payer: b, claims: row[2] === null ? null : num(row[2]), ...bucketsFrom(row.slice(4, 10), row[3]) });
  }
  const payerSum = round(payers.reduce((t, p) => t + p.total, 0));
  if (grand && payers.length && Math.abs(payerSum - grand.primary) > 0.01) {
    issues.push({ level: "warn", message: `Insurance companies add up to ${payerSum}; primary A/R is ${grand.primary}. The by-company view may be incomplete.` });
  }

  // ---- the report date: the "As of Date" column only.
  let asOf: string | null = null;
  let asOfSource = "";
  const data = grid("Primary AR Data");
  if (data.length > 1) {
    const col = (data[0] as unknown[]).findIndex((h) => /^as of date$/i.test(txt(h)));
    if (col >= 0) {
      const dates = new Set(data.slice(1).map((r) => toIso(r[col])).filter((x): x is string => !!x));
      if (dates.size === 1) { asOf = Array.from(dates)[0]; asOfSource = "the report's 'As of Date' column"; }
      else if (dates.size > 1) issues.push({ level: "warn", message: "The file carries more than one 'As of Date'." });
    }
  }
  const range = rangeFromFileName(fileName);
  if (!asOf && range.to) { asOf = range.to; asOfSource = "the end date in the file name"; }
  if (!asOf) issues.push({ level: "error", message: "Could not find the report date. Choose the month by hand." });

  if (!facilities.length) issues.push({ level: "error", message: "No facility rows found in 'AR by Facility'." });

  return { asOf, asOfSource, rangeFrom: range.from, rangeTo: range.to, facilities, payers, grand, issues };
}

/** True when the date filter looks like it cut the A/R down to recent visits. */
export function rangeLooksPartial(p: PromptAr): boolean {
  if (!p.rangeFrom || !p.rangeTo) return false;
  const days = (Date.parse(p.rangeTo) - Date.parse(p.rangeFrom)) / 86_400_000;
  return days < 365;
}
