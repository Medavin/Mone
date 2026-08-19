import * as XLSX from "xlsx";

/**
 * Parses the monthly Collection Action report.
 *
 * Shape: DATE | CLINIC | COLLECTION ACTIONS | NUMBER OF ACTIONS | COLLECTOR
 *
 * The clinic and the action are free text and are not typed consistently. In
 * one month's file, 38 spellings described 18 actions. Canonicalising is
 * therefore the main job here, not reading cells.
 */

export type ActionRow = {
  clinicRaw: string;
  actionRaw: string;
  /** Canonical, upper-case, for matching against the alias table. */
  actionNormalised: string;
  /** The report prefixes occupational-therapy work with "OT ". */
  isOt: boolean;
  collector: string;
  count: number;
};

export type ParsedActions = {
  period: string | null; // YYYY-MM
  rows: ActionRow[];
  totalActions: number;
  clinics: string[];
  collectors: string[];
  /** Canonical action -> total, and which raw spellings fed it. */
  actionTotals: { action: string; total: number; variants: string[] }[];
  issues: { level: "error" | "warning"; message: string }[];
};

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  const s = text(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reduces a typed action label to a canonical form.
 *
 * Every rule here comes from a real pair of labels in the source that mean the
 * same thing. Order matters: dashes and whitespace are normalised before the
 * word substitutions, or "DENIED-WRITE-OFF" never matches "DENIED - WRITE-OFF".
 */
export function canonicaliseAction(raw: string): { normalised: string; isOt: boolean } {
  let t = raw.toUpperCase().trim();

  // en-dash and em-dash both appear where a hyphen was meant
  t = t.replace(/[\u2010-\u2015]/g, "-");
  t = t.replace(/\s+/g, " ");

  // Occupational therapy is flagged with a prefix rather than a column
  const isOt = /^OT\b/.test(t);
  if (isOt) t = t.replace(/^OT\b\s*/, "");

  t = t.replace(/\bAND\b/g, "&");
  t = t.replace(/\bCLMS\b/g, "CLAIM").replace(/\bCLM\b/g, "CLAIM").replace(/\bCLAIMS\b/g, "CLAIM");
  t = t.replace(/\bADJ\b/g, "ADJUSTER");
  t = t.replace(/\bSTMT\b/g, "STATEMENT");
  t = t.replace(/\bWRITEOFF\b/g, "WRITE-OFF");
  t = t.replace(/DENIED\s*-\s*/g, "DENIED - ");
  t = t.replace(/\bFOLLOW UP ON A CLAIM\b/g, "FOLLOW UP ON CLAIM");
  t = t.replace(/\bFIXED CLAIM REBILLED\b/g, "FIXED CLAIM & REBILLED");
  t = t.replace(/\bNCOF REBILLED\b/g, "NCOF & REBILLED");
  t = t.replace(/\s*-\s*/g, " - ");
  // Genuine hyphenated words must survive the dash spacing above.
  t = t.replace(/\bWRITE - OFF\b/g, "WRITE-OFF");
  t = t.replace(/\s+/g, " ").trim();

  return { normalised: t, isOt };
}

/** Same idea for clinic names, which are abbreviated differently in each report. */
export function normaliseClinic(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toMonth(v: unknown): string | null {
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const s = text(v);
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}`;
  return null;
}

export function parseCollectionActions(data: ArrayBuffer): ParsedActions {
  const wb = XLSX.read(data, { type: "array" });
  const issues: ParsedActions["issues"] = [];

  // The sheet is usually called COLLECTION ACTIONS; fall back to the first
  // sheet that has the expected headings rather than assuming a name.
  let grid: unknown[][] | null = null;
  for (const name of wb.SheetNames) {
    const g = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    }) as unknown[][];
    const head = (g[0] ?? []).map((c) => text(c).toUpperCase());
    if (head.some((h) => h.startsWith("CLINIC")) && head.some((h) => h.includes("ACTION"))) {
      grid = g;
      break;
    }
  }

  if (!grid) {
    issues.push({
      level: "error",
      message: `No sheet with CLINIC and ACTION columns. Found: ${wb.SheetNames.join(", ")}.`,
    });
    return { period: null, rows: [], totalActions: 0, clinics: [], collectors: [], actionTotals: [], issues };
  }

  const head = (grid[0] ?? []).map((c) => text(c).toUpperCase());
  const col = (...names: string[]) =>
    head.findIndex((h) => names.some((n) => h.startsWith(n)));

  const iDate = col("DATE");
  const iClinic = col("CLINIC");
  const iAction = col("COLLECTION ACTION", "ACTION");
  const iCount = col("NUMBER OF ACTION", "NUMBER", "COUNT");
  const iCollector = col("COLLECTOR");

  if (iClinic < 0 || iAction < 0 || iCount < 0 || iCollector < 0) {
    issues.push({ level: "error", message: "The report is missing one of its expected columns." });
    return { period: null, rows: [], totalActions: 0, clinics: [], collectors: [], actionTotals: [], issues };
  }

  const rows: ActionRow[] = [];
  const periods = new Set<string>();

  for (let r = 1; r < grid.length; r++) {
    const clinicRaw = text(grid[r]?.[iClinic]);
    const actionRaw = text(grid[r]?.[iAction]);
    if (!clinicRaw || !actionRaw) continue;
    if (/^(grand )?totals?:?$/i.test(clinicRaw)) continue;

    const count = num(grid[r]?.[iCount]);
    if (count === null) continue;

    const month = iDate >= 0 ? toMonth(grid[r]?.[iDate]) : null;
    if (month) periods.add(month);

    const { normalised, isOt } = canonicaliseAction(actionRaw);

    rows.push({
      clinicRaw,
      actionRaw,
      actionNormalised: normalised,
      isOt,
      collector: text(grid[r]?.[iCollector]).toUpperCase(),
      count,
    });
  }

  if (rows.length === 0) {
    issues.push({ level: "error", message: "No action rows were recognised." });
  }

  // One report should cover one month. More than one date means either a
  // multi-month export or a typo, and both need a human to look.
  if (periods.size > 1) {
    issues.push({
      level: "warning",
      message: `The file contains ${periods.size} different months (${Array.from(periods)
        .sort()
        .join(", ")}). Every row will be filed under the month you choose.`,
    });
  }

  const byAction = new Map<string, { total: number; variants: Set<string> }>();
  for (const row of rows) {
    const acc = byAction.get(row.actionNormalised) ?? { total: 0, variants: new Set<string>() };
    acc.total += row.count;
    acc.variants.add(row.actionRaw);
    byAction.set(row.actionNormalised, acc);
  }

  const actionTotals = Array.from(byAction.entries())
    .map(([action, v]) => ({ action, total: v.total, variants: Array.from(v.variants) }))
    .sort((a, b) => b.total - a.total);

  return {
    period: periods.size === 1 ? Array.from(periods)[0] : null,
    rows,
    totalActions: rows.reduce((a, r) => a + r.count, 0),
    clinics: Array.from(new Set(rows.map((r) => r.clinicRaw))).sort(),
    collectors: Array.from(new Set(rows.map((r) => r.collector))).sort(),
    actionTotals,
    issues,
  };
}
