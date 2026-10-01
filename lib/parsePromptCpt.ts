import * as XLSX from "xlsx";

/**
 * Prompt EMR — "Revenue by CPT Code" report (Reports → Revenue), downloaded
 * 2 Oct 2026 from Performance PT's account, 1 Jan – 30 Sep 2026.
 *
 * Per-facility figures come from "Detailed Data" (one row per CPT line).
 * ⚠ PHI RULE: only Date of Service, Visit Facility, Primary Insurance Type,
 * CPT Code, Units Billed, $ Billed, $ Allowed and Provider Paid are read.
 * Patient name, account number, claim number and therapists are never read.
 *
 * ⚠ Prompt's own note: the report "only includes claims where the money was
 * paid at the line level". Lines on claims not yet paid, or paid as one
 * claim total, are NOT in it — so units and billed here are lower than the
 * Visits Revenue Report's. Paid and allowed are the reliable figures.
 *
 * The date range comes from the "Report Details" sheet, not the file name.
 */

export type CptCell = { units: number; billed: number; allowed: number; paid: number };
export type PromptCpt = {
  rangeFrom: string | null; rangeTo: string | null; basedOn: string | null;
  /** facility → month → insurance type → CPT → figures */
  cells: Map<string, Map<string, Map<string, Map<string, CptCell>>>>;
  facilities: string[]; months: string[]; fullMonths: string[]; codes: string[];
  totals: CptCell & { lines: number };
  summaryTotals: { units: number; billed: number; allowed: number; paid: number } | null;
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

export function isPromptCpt(wb: XLSX.WorkBook) {
  return wb.SheetNames.includes("Detailed Data") && wb.SheetNames.includes("Report Details") &&
    wb.SheetNames.some((s) => /by payer/i.test(s));
}

export function parsePromptCpt(wb: XLSX.WorkBook): PromptCpt {
  const issues: PromptCpt["issues"] = [];
  const grid = (s: string) => (wb.Sheets[s] ? XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, raw: true, defval: null }) as unknown[][] : []);

  // ---- the report's own statement of its range
  let rangeFrom: string | null = null, rangeTo: string | null = null, basedOn: string | null = null;
  for (const r of grid("Report Details")) {
    const k = txt(r[0]).toLowerCase();
    if (k.startsWith("start date")) rangeFrom = iso(r[1]);
    if (k.startsWith("end date")) rangeTo = iso(r[1]);
    if (k.startsWith("date based on")) basedOn = txt(r[1]);
  }
  if (!rangeFrom || !rangeTo) issues.push({ level: "warn", message: "The Report Details sheet does not state the date range. Tick the complete months yourself." });
  if (basedOn && !/visit|service/i.test(basedOn)) issues.push({ level: "warn", message: `This report is dated by "${basedOn}", not the date of visit — months may not line up with the visits report.` });

  const rows = grid("Detailed Data");
  const head = (rows[0] ?? []).map((h) => txt(h).toLowerCase());
  const col = (n: string) => head.indexOf(n.toLowerCase());
  const C = {
    dos: col("Date of Service"), fac: col("Visit Facility"), type: col("Primary Insurance Type"),
    code: col("CPT Code"), units: col("Units BIlled") >= 0 ? col("Units BIlled") : col("Units Billed"),
    billed: col("$ Billed"), allowed: col("$ Allowed"), paid: col("Provider Paid"),
  };
  for (const [k, i] of Object.entries(C)) if (i < 0) issues.push({ level: "error", message: `'Detailed Data' has no ${k} column — Prompt may have changed the report.` });

  const cells: PromptCpt["cells"] = new Map();
  const totals = { units: 0, billed: 0, allowed: 0, paid: 0, lines: 0 };
  const codes = new Set<string>();
  if (!issues.some((i) => i.level === "error")) {
    for (const r of rows.slice(1)) {
      const code = txt(r[C.code]);
      const dos = iso(r[C.dos]);
      if (!code && !dos) continue;
      if (!dos || !code) { issues.push({ level: "warn", message: "Some lines had no date or no code and were left out." }); continue; }
      const f = txt(r[C.fac]) || "(no facility)";
      const m = dos.slice(0, 7);
      const t = txt(r[C.type]) || "Unknown";
      const byM = cells.get(f) ?? new Map(); const byT = byM.get(m) ?? new Map(); const byC = byT.get(t) ?? new Map();
      const c: CptCell = byC.get(code) ?? { units: 0, billed: 0, allowed: 0, paid: 0 };
      const u = num(r[C.units]), b = num(r[C.billed]), a = num(r[C.allowed]), p = num(r[C.paid]);
      c.units += u; c.billed += b; c.allowed += a; c.paid += p;
      byC.set(code, c); byT.set(t, byC); byM.set(m, byT); cells.set(f, byM);
      totals.units += u; totals.billed += b; totals.allowed += a; totals.paid += p; totals.lines += 1;
      codes.add(code);
    }
  }
  // de-duplicate the repeated warning
  const seen = new Set<string>();
  const dedup = issues.filter((i) => (seen.has(i.message) ? false : (seen.add(i.message), true)));

  // ---- checksum: Prompt's Summary "Totals" row
  let summaryTotals: PromptCpt["summaryTotals"] = null;
  const sum = grid("Summary");
  const hi = sum.findIndex((r) => txt(r[0]).toLowerCase() === "cpt code");
  if (hi >= 0) {
    const h = sum[hi].map((x) => txt(x).toLowerCase());
    const tr = sum.find((r) => /^totals?$/i.test(txt(r[0])));
    if (tr) {
      summaryTotals = {
        units: num(tr[h.indexOf("total units")]), billed: num(tr[h.indexOf("total $ billed")]),
        allowed: num(tr[h.indexOf("total allowed")]), paid: num(tr[h.indexOf("total provider paid")]),
      };
      const off = (x: number, y: number) => Math.abs(x - y) > 0.5;
      if (off(summaryTotals.units, totals.units) || off(summaryTotals.billed, totals.billed) || off(summaryTotals.paid, totals.paid) || off(summaryTotals.allowed, totals.allowed)) {
        dedup.push({ level: "error", message: `The lines add up to ${totals.units} units, $${totals.billed.toFixed(2)} billed, $${totals.paid.toFixed(2)} paid; Prompt's Totals row says ${summaryTotals.units}, $${summaryTotals.billed.toFixed(2)}, $${summaryTotals.paid.toFixed(2)}.` });
      }
    }
  }

  const facilities = Array.from(cells.keys()).sort();
  const months = Array.from(new Set(facilities.flatMap((f) => Array.from(cells.get(f)!.keys())))).sort();
  const fullMonths = months.filter((m) => {
    if (!rangeFrom || !rangeTo) return false;
    const [y, mo] = m.split("-").map(Number);
    return rangeFrom <= `${m}-01` && rangeTo >= new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  });

  return { rangeFrom, rangeTo, basedOn, cells, facilities, months, fullMonths, codes: Array.from(codes).sort(), totals, summaryTotals, issues: dedup };
}

/** One facility-set's figures for a month, by code. */
export function codesFor(p: PromptCpt, facilities: string[], month: string) {
  const out = new Map<string, Map<string, CptCell>>(); // type → code → cell
  for (const f of facilities) for (const [t, byC] of Array.from(p.cells.get(f)?.get(month)?.entries() ?? [])) {
    const tgt = out.get(t) ?? new Map<string, CptCell>();
    for (const [code, c] of Array.from(byC.entries())) {
      const x = tgt.get(code) ?? { units: 0, billed: 0, allowed: 0, paid: 0 };
      x.units += c.units; x.billed += c.billed; x.allowed += c.allowed; x.paid += c.paid;
      tgt.set(code, x);
    }
    out.set(t, tgt);
  }
  return out;
}

export function facilityTotal(p: PromptCpt, f: string): CptCell {
  const o = { units: 0, billed: 0, allowed: 0, paid: 0 };
  for (const byT of Array.from(p.cells.get(f)?.values() ?? [])) for (const byC of Array.from(byT.values())) for (const c of Array.from(byC.values())) {
    o.units += c.units; o.billed += c.billed; o.allowed += c.allowed; o.paid += c.paid;
  }
  return o;
}
