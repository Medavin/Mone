import * as XLSX from "xlsx";

/**
 * Parses the AdvancedMD monthly clinic workbook.
 *
 * Pure functions: this file reads a spreadsheet and returns numbers. It never
 * touches the database. That separation is deliberate — the parsing can be
 * checked against a real file without a database in the loop.
 *
 * Row positions are NOT hardcoded. The sheets are scanned for their labels,
 * because a report that gains a row at the top would otherwise import
 * silently wrong figures, which is far worse than failing.
 */

export type Cell = string | number | null;
export type Grid = Cell[][];

export type FinancialClassAr = {
  code: string;
  name: string;
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d120: number;
  total: number;
};

export type FinancialClassActivity = {
  code: string;
  name: string;
  units: number;
  charges: number;
  payments: number;
  adjustments: number;
};

export type ArSplitRow = {
  payerType: "insurance" | "patient";
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d120: number;
  total: number;
  unapplied: number;
  net: number;
};

export type ClinicSummary = {
  openingAr: number | null;
  closingAr: number | null;
  arChange: number | null;
  charges: number | null;
  adjustments: number | null;
  paymentsPatient: number | null;
  paymentsInsurance: number | null;
  patientsWithBalance: number | null;
  averagePatientBalance: number | null;
};

export type ParseIssue = { level: "error" | "warning"; message: string };

export type ParsedWorkbook = {
  detectedClinicName: string | null;
  /** The period the pack covers, as YYYY-MM, read from the report itself. */
  detectedPeriod: string | null;
  detectedPeriodSource: string | null;
  summary: ClinicSummary;
  arSplit: ArSplitRow[];
  financialClassAr: FinancialClassAr[];
  financialClassActivity: FinancialClassActivity[];
  issues: ParseIssue[];
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sheetToGrid(wb: XLSX.WorkBook, name: string): Grid | null {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  }) as Grid;
}

function text(v: Cell): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Numbers only. A label, a blank or a stray dash becomes null, never 0. */
function num(v: Cell): number | null {
  if (typeof v === "number") return v;
  const s = text(v).replace(/[$,\s]/g, "");
  if (s === "" || s === "-" || s === "—") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function num0(v: Cell): number {
  return num(v) ?? 0;
}

/**
 * Finds the header row: the first row containing ALL of the given labels.
 *
 * Matching a single label is not enough. The Financial Class A-R sheet is
 * TITLED "Financial Class  A/R Aging", so looking for "financial class" alone
 * lands on row 1 and the clinic name gets imported as a data row. Requiring
 * the column headings to appear together is what distinguishes the real
 * header from the title.
 */
function findHeaderRow(grid: Grid, labels: string[]): number {
  const targets = labels.map((l) => l.toLowerCase());
  for (let r = 0; r < grid.length; r++) {
    const cells = (grid[r] ?? []).map((c) => text(c).toLowerCase());
    if (targets.every((t) => cells.some((c) => c.startsWith(t)))) return r;
  }
  return -1;
}

/** Two figures agree if they are within half a cent. */
function agrees(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

// ---------------------------------------------------------------------------
// Mgmt Summary
// ---------------------------------------------------------------------------

function parseMgmtSummary(
  grid: Grid,
  issues: ParseIssue[]
): { summary: ClinicSummary; arSplit: ArSplitRow[] } {
  // The sheet reuses labels — "Total:" appears under Charges/Adjustments,
  // again under Payments, and again under Current A/R. So track which
  // section each row belongs to rather than matching on the label alone.
  let section = "";
  const summary: ClinicSummary = {
    openingAr: null,
    closingAr: null,
    arChange: null,
    charges: null,
    adjustments: null,
    paymentsPatient: null,
    paymentsInsurance: null,
    patientsWithBalance: null,
    averagePatientBalance: null,
  };

  const buckets: Record<string, { ins: number; pat: number }> = {};

  for (const row of grid) {
    const colA = text(row?.[0]);
    const colB = text(row?.[1]);

    if (colA) {
      const a = colA.toLowerCase();
      if (a.startsWith("change in a/r")) section = "change";
      else if (a.startsWith("charges/adjustments")) section = "charges";
      else if (a.startsWith("payments")) section = "payments";
      else if (a.startsWith("current a/r")) section = "currentar";
      else if (a.startsWith("patient balance")) section = "balances";
      else if (a.startsWith("transaction summary")) section = "";
    }

    // "Patients with Balances" and "Average Patient Balance" sit in column A
    // with their value in column C, unlike everything else on the sheet.
    if (colA.toLowerCase().startsWith("patients with balance")) {
      summary.patientsWithBalance = num(row?.[2]);
    }
    if (colA.toLowerCase().startsWith("average patient balance")) {
      summary.averagePatientBalance = num(row?.[2]);
    }

    if (!colB) continue;
    const label = colB.toLowerCase().replace(/:$/, "");

    // Column D carries a bare "-" or "+" sign; column E carries the figure.
    const sign = text(row?.[3]) === "-" ? -1 : 1;
    const value = num(row?.[4]);

    if (section === "change") {
      if (label.startsWith("beginning a/r")) summary.openingAr = value;
      else if (label.startsWith("a/r increase")) summary.arChange = value;
      else if (label.startsWith("ending a/r")) summary.closingAr = value;
    } else if (section === "charges") {
      if (label === "charges") summary.charges = value;
      else if (label === "adjustments")
        summary.adjustments = value === null ? null : value * sign;
    } else if (section === "payments") {
      if (label === "patient") summary.paymentsPatient = value;
      else if (label === "insurance") summary.paymentsInsurance = value;
    } else if (section === "currentar") {
      // insurance in column C, patient in column E
      const key =
        label === "current" ? "current"
        : label === "over 30" ? "d30"
        : label === "over 60" ? "d60"
        : label === "over 90" ? "d90"
        : label === "over 120" ? "d120"
        : label === "total" ? "total"
        : label === "unapplied" ? "unapplied"
        : label === "net total" ? "net"
        : "";
      if (key) buckets[key] = { ins: num0(row?.[2]), pat: num0(row?.[4]) };
    }
  }

  if (summary.openingAr === null)
    issues.push({ level: "error", message: "Beginning A/R not found on the Mgmt Summary sheet." });
  if (summary.closingAr === null)
    issues.push({ level: "error", message: "Ending A/R not found on the Mgmt Summary sheet." });

  const pick = (k: string, side: "ins" | "pat") => buckets[k]?.[side] ?? 0;
  const arSplit: ArSplitRow[] = (["insurance", "patient"] as const).map((payerType) => {
    const side = payerType === "insurance" ? "ins" : "pat";
    return {
      payerType,
      current: pick("current", side),
      d30: pick("d30", side),
      d60: pick("d60", side),
      d90: pick("d90", side),
      d120: pick("d120", side),
      total: pick("total", side),
      unapplied: pick("unapplied", side),
      net: pick("net", side),
    };
  });

  // The report states the change; check it against the balances it also states.
  if (summary.openingAr !== null && summary.closingAr !== null && summary.arChange !== null) {
    const implied = summary.closingAr - summary.openingAr;
    if (!agrees(implied, summary.arChange)) {
      issues.push({
        level: "warning",
        message:
          `Ending minus beginning A/R is ${implied.toFixed(2)}, but the report states ` +
          `${summary.arChange.toFixed(2)}. Both figures are stored as reported.`,
      });
    }
  }

  return { summary, arSplit };
}

// ---------------------------------------------------------------------------
// Financial Class A-R
// ---------------------------------------------------------------------------

function parseFinancialClassAr(grid: Grid, issues: ParseIssue[]): FinancialClassAr[] {
  const header = findHeaderRow(grid, ["financial class", "current", "total"]);
  if (header < 0) {
    issues.push({ level: "error", message: "No header row on the Financial Class A-R sheet." });
    return [];
  }

  const rows: FinancialClassAr[] = [];
  let grand: FinancialClassAr | null = null;

  for (let r = header + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const code = text(row[0]);
    if (!code) continue;

    const parsed: FinancialClassAr = {
      code,
      name: text(row[1]).replace(/\s*\*+$/, ""),
      current: num0(row[2]),
      d30: num0(row[3]),
      d60: num0(row[4]),
      d90: num0(row[5]),
      d120: num0(row[6]),
      total: num0(row[7]),
    };

    if (code.toLowerCase().startsWith("grand total")) {
      grand = parsed;
      break;
    }
    if (code.startsWith("*")) break; // footnotes
    rows.push(parsed);
  }

  checkAgainstGrandTotal(
    "Financial Class A-R",
    rows.map((x) => [x.current, x.d30, x.d60, x.d90, x.d120, x.total]),
    grand ? [grand.current, grand.d30, grand.d60, grand.d90, grand.d120, grand.total] : null,
    ["Current", "30 days", "60 days", "90 days", "120 days", "Total"],
    issues
  );

  return rows;
}

// ---------------------------------------------------------------------------
// Financial Activity
// ---------------------------------------------------------------------------

function parseFinancialActivity(grid: Grid, issues: ParseIssue[]): FinancialClassActivity[] {
  const header = findHeaderRow(grid, ["financial class", "units", "charges"]);
  if (header < 0) {
    issues.push({ level: "error", message: "No header row on the Financial Activity sheet." });
    return [];
  }

  const rows: FinancialClassActivity[] = [];
  let grand: number[] | null = null;

  for (let r = header + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const label = text(row[0]);
    if (!label) continue;

    const figures = [num0(row[2]), num0(row[3]), num0(row[4]), num0(row[5])];

    if (label.toLowerCase().startsWith("grand total")) {
      grand = figures;
      break;
    }

    // Column A here is "1A - AUTO", one field rather than two.
    const [codePart, ...namePart] = label.split(" - ");
    rows.push({
      code: codePart.trim(),
      name: namePart.join(" - ").trim(),
      units: figures[0],
      charges: figures[1],
      payments: figures[2],
      adjustments: figures[3],
    });
  }

  checkAgainstGrandTotal(
    "Financial Activity",
    rows.map((x) => [x.units, x.charges, x.payments, x.adjustments]),
    grand,
    ["Units", "Charges", "Payments", "Adjustments"],
    issues
  );

  return rows;
}

// ---------------------------------------------------------------------------
// The checksum. This is why the report's Grand Total row matters.
// ---------------------------------------------------------------------------

function checkAgainstGrandTotal(
  sheet: string,
  rows: number[][],
  grand: number[] | null,
  labels: string[],
  issues: ParseIssue[]
) {
  if (!grand) {
    issues.push({
      level: "warning",
      message: `No Grand Total row found on ${sheet}, so the figures could not be cross-checked.`,
    });
    return;
  }

  labels.forEach((label, i) => {
    const summed = rows.reduce((acc, row) => acc + (row[i] ?? 0), 0);
    if (!agrees(summed, grand[i])) {
      issues.push({
        level: "error",
        message:
          `${sheet}: ${label} adds up to ${summed.toFixed(2)}, but the report's ` +
          `Grand Total says ${grand[i].toFixed(2)}. Rows are missing or misread.`,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * The period the pack covers.
 *
 * Several sheets print it outright — "Date of Entry, Date Ranges 07/01/2021 to
 * 07/31/2021". That is authoritative and is read first.
 *
 * The last column of the history sheet is only a fallback. It is usually the
 * same month, but it is an inference, and inferring a period when the report
 * states it is how a July pack ends up filed as December.
 */
function findStatedPeriod(wb: XLSX.WorkBook): { period: string; source: string } | null {
  const sheets = ["Service Details", "Mgmt Summary", "Financial Class A-R", "Financial Activity"];

  for (const name of sheets) {
    const grid = sheetToGrid(wb, name);
    if (!grid) continue;

    for (let r = 0; r < Math.min(grid.length, 12); r++) {
      for (const cell of grid[r] ?? []) {
        const t = text(cell);
        // mm/dd/yyyy, the first date of the stated range
        const m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m && /date range|date of entry|through|to /i.test(t)) {
          const month = m[1].padStart(2, "0");
          return { period: `${m[3]}-${month}`, source: `${name} — "${t.slice(0, 60)}"` };
        }
      }
    }
  }
  return null;
}

export function parseWorkbook(data: ArrayBuffer): ParsedWorkbook {
  const wb = XLSX.read(data, { type: "array" });
  const issues: ParseIssue[] = [];

  const need = (name: string): Grid => {
    const g = sheetToGrid(wb, name);
    if (!g) {
      issues.push({
        level: "error",
        message: `The workbook has no sheet called "${name}". Found: ${wb.SheetNames.join(", ")}.`,
      });
      return [];
    }
    return g;
  };

  const mgmt = need("Mgmt Summary");
  const fcAr = need("Financial Class A-R");
  const fcAct = need("Financial Activity");

  const { summary, arSplit } = parseMgmtSummary(mgmt, issues);

  // The clinic name sits under the sheet title, in caps.
  const detectedClinicName = text(mgmt?.[1]?.[0]) || null;

  const stated = findStatedPeriod(wb);
  if (!stated) {
    issues.push({
      level: "warning",
      message:
        "No stated date range found in the workbook, so the month has been taken from the last " +
        "column of the history sheet. Check it before importing.",
    });
  }

  const financialClassAr = parseFinancialClassAr(fcAr, issues);
  const financialClassActivity = parseFinancialActivity(fcAct, issues);

  // Cross-sheet check. Financial Class A/R is gross; the Mgmt Summary ending
  // A/R is net of unapplied payments. So the gap between them should equal the
  // unapplied total. Anything left over after accounting for that is a real
  // inconsistency in the source report, and saying so is more useful than
  // waving the difference away as expected.
  const fcTotal = financialClassAr.reduce((a, r) => a + r.total, 0);
  if (summary.closingAr !== null && fcTotal > 0) {
    const unapplied = arSplit.reduce((a, r) => a + r.unapplied, 0);
    const residual = fcTotal + unapplied - summary.closingAr;
    if (!agrees(residual, 0)) {
      issues.push({
        level: "warning",
        message:
          `Cross-check: Financial Class A/R totals ${fcTotal.toFixed(2)} and unapplied ` +
          `payments are ${unapplied.toFixed(2)}, which should leave an ending A/R of ` +
          `${(fcTotal + unapplied).toFixed(2)}. The Mgmt Summary states ` +
          `${summary.closingAr.toFixed(2)} — a difference of ${residual.toFixed(2)}. ` +
          `Both are stored as reported; the discrepancy is in the source.`,
      });
    }
  }

  return {
    detectedClinicName,
    detectedPeriod: stated?.period ?? null,
    detectedPeriodSource: stated?.source ?? null,
    summary,
    arSplit,
    financialClassAr,
    financialClassActivity,
    issues,
  };
}

// ===========================================================================
// HISTORY
//
// Two sheets in the pack carry 113 monthly columns each, running back to 2012:
// "Hist Chg Pmt Adj" holds three stacked blocks (charges, payments,
// adjustments) and "Visits & New Patients" holds two (visits, new patients).
// All five are cut by financial class, which is the same grain as
// activity_monthly — so one file seeds a decade of history.
//
// Each block has the same shape: a title in column A, then a header row whose
// column A reads "Financial Class code" and whose remaining columns are dates,
// then one row per financial class, ending at a "Total" row.
// ===========================================================================

export type HistoryCell = {
  code: string;
  month: string; // YYYY-MM-01
  charges: number | null;
  payments: number | null;
  adjustments: number | null;
  visits: number | null;
  newPatients: number | null;
};

export type ParsedHistory = {
  months: string[];
  rows: HistoryCell[];
  issues: ParseIssue[];
};

type BlockField = "charges" | "payments" | "adjustments" | "visits" | "newPatients";

/** Excel serial date, or a real Date, or a parseable string -> YYYY-MM-01. */
function toMonthStart(v: unknown): string | null {
  let d: Date | null = null;

  if (v instanceof Date) {
    d = v;
  } else if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel serial: days since 1899-12-30, read as UTC to avoid a timezone
    // shifting the date back into the previous month.
    d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  } else if (typeof v === "string" && v.trim()) {
    const parsed = new Date(v);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }

  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/** Reads one block, starting from the row carrying its title. */
function readBlock(
  grid: Grid,
  titleRow: number,
  field: BlockField,
  into: Map<string, HistoryCell>,
  monthsSeen: Set<string>,
  issues: ParseIssue[]
) {
  // The header row is the next one whose column A is "Financial Class code".
  let header = -1;
  for (let r = titleRow + 1; r < Math.min(titleRow + 8, grid.length); r++) {
    if (text(grid[r]?.[0]).toLowerCase().startsWith("financial class code")) {
      header = r;
      break;
    }
  }
  if (header < 0) {
    issues.push({ level: "warning", message: `No header row found for the ${field} history block.` });
    return;
  }

  // Column index -> month. Columns before the first date are code and name.
  const monthAt = new Map<number, string>();
  (grid[header] ?? []).forEach((cell, i) => {
    const m = toMonthStart(cell as unknown);
    if (m) {
      monthAt.set(i, m);
      monthsSeen.add(m);
    }
  });

  if (monthAt.size === 0) {
    issues.push({ level: "warning", message: `No date columns found in the ${field} history block.` });
    return;
  }

  for (let r = header + 1; r < grid.length; r++) {
    const code = text(grid[r]?.[0]);
    if (!code) continue;
    if (code.toLowerCase().startsWith("total")) break;

    for (const [col, month] of Array.from(monthAt.entries())) {
      const value = num(grid[r]?.[col] ?? null);
      if (value === null) continue; // blank stays blank, never becomes zero
      const key = `${code}|${month}`;
      const existing = into.get(key) ?? {
        code,
        month,
        charges: null,
        payments: null,
        adjustments: null,
        visits: null,
        newPatients: null,
      };
      existing[field] = value;
      into.set(key, existing);
    }
  }
}

export function parseHistory(data: ArrayBuffer): ParsedHistory {
  const wb = XLSX.read(data, { type: "array" });
  const issues: ParseIssue[] = [];
  const cells = new Map<string, HistoryCell>();
  const monthsSeen = new Set<string>();

  const blocks: { sheet: string; title: string; field: BlockField }[] = [
    { sheet: "Hist Chg Pmt Adj", title: "charges by financial class", field: "charges" },
    { sheet: "Hist Chg Pmt Adj", title: "payments by financial class", field: "payments" },
    { sheet: "Hist Chg Pmt Adj", title: "adjustments by financial class", field: "adjustments" },
    { sheet: "Visits & New Patients", title: "total visits", field: "visits" },
    { sheet: "Visits & New Patients", title: "new patients", field: "newPatients" },
  ];

  for (const block of blocks) {
    const grid = sheetToGrid(wb, block.sheet);
    if (!grid) {
      issues.push({ level: "warning", message: `No "${block.sheet}" sheet, so ${block.field} history was skipped.` });
      continue;
    }

    // Match on column A only. "Total Visits:" appears as a totals row further
    // down the same sheet, so the search must stop at the first match.
    const titleRow = grid.findIndex((row) =>
      text(row?.[0]).toLowerCase().startsWith(block.title)
    );
    if (titleRow < 0) {
      issues.push({ level: "warning", message: `No "${block.title}" block found, so it was skipped.` });
      continue;
    }

    readBlock(grid, titleRow, block.field, cells, monthsSeen, issues);
  }

  const months = Array.from(monthsSeen).sort();
  return { months, rows: Array.from(cells.values()), issues };
}

// ===========================================================================
// CARRIER A/R
//
// The sheet nests four levels deep: carrier -> provider -> chart number and
// visit ID -> CPT line. Only the top level is read.
//
// That is a deliberate limit, not a shortcut. The lower levels are patient
// data, and "which payers owe us and how old is it" is answered completely at
// carrier level. Nothing identifiable is stored.
//
// Row shapes, which is how the levels are told apart:
//   carrier          column B has a name, column C is empty, figures present
//   provider total   same shape, but the name ends "Total:"
//   provider         column A has a name, column C empty, figures present
//   chart line       column C holds a visit id  -> skipped
//   CPT line         columns A-C empty          -> skipped
// ===========================================================================

export type CarrierAr = {
  code: string;
  name: string;
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d120: number;
  total: number;
};

export type ParsedCarrierAr = {
  rows: CarrierAr[];
  issues: ParseIssue[];
};

export function parseCarrierAr(data: ArrayBuffer, insuranceArTotal?: number): ParsedCarrierAr {
  const wb = XLSX.read(data, { type: "array" });
  const issues: ParseIssue[] = [];
  const grid = sheetToGrid(wb, "Carrier AR");

  if (!grid) {
    issues.push({ level: "warning", message: 'No "Carrier AR" sheet, so carrier detail was skipped.' });
    return { rows: [], issues };
  }

  const rows: CarrierAr[] = [];

  for (const row of grid) {
    const code = text(row?.[0]);
    const name = text(row?.[1]);
    const third = text(row?.[2]);

    if (!name || third) continue;              // not a carrier-level row
    if (/total:?$/i.test(name)) continue;      // a provider subtotal

    // Take the numeric cells rather than fixed column positions. The figures
    // sit further right than the obvious guess, and an off-by-one here reads
    // every carrier as blank — which is exactly what happened first time.
    const figures = (row ?? [])
      .map((cell) => num(cell))
      .filter((v): v is number => v !== null);
    if (figures.length < 6) continue; // header or spacer

    // Current, 30, 60, 90, 120, Total — the last six on the row.
    const [c0, c30, c60, c90, c120, cTotal] = figures.slice(-6);

    rows.push({
      // Blank code happens on the "NOT BILLED YET" bucket; fall back to the
      // name so every carrier still has a stable key.
      code: code || name,
      name,
      current: c0,
      d30: c30,
      d60: c60,
      d90: c90,
      d120: c120,
      total: cTotal,
    });
  }

  if (rows.length === 0) {
    issues.push({ level: "warning", message: "No carrier rows were recognised on the Carrier AR sheet." });
    return { rows, issues };
  }

  // Carrier A/R covers the INSURANCE side only — patient balances are not
  // attributed to a carrier. So the carrier rows should add up to the
  // insurance total on the Mgmt Summary, and that is a real checksum.
  if (insuranceArTotal !== undefined) {
    const summed = rows.reduce((a, r) => a + r.total, 0);
    if (!agrees(summed, insuranceArTotal)) {
      issues.push({
        level: "error",
        message:
          `Carrier A/R adds up to ${summed.toFixed(2)} across ${rows.length} carriers, but the ` +
          `Mgmt Summary puts insurance A/R at ${insuranceArTotal.toFixed(2)}. Carriers are being ` +
          `missed or double-counted.`,
      });
    }
  }

  return { rows, issues };
}

// ===========================================================================
// SERVICE DETAIL  (Analysis of Services)
//
// Procedures grouped under a financial class heading, with a "Non-voided
// items" sub-heading and Total rows between each group.
//
// Note the class NAMES here disagree with the other sheets — this one says
// "1C - CONTRACTED ONE RATE" where the A/R sheet says "CONTRACTED PER DIEM
// RATE". The CODE is consistent, so everything matches on code.
// ===========================================================================

export type ServiceLine = {
  classCode: string;
  procCode: string;
  description: string;
  units: number;
  charges: number;
};

export function parseServiceDetails(data: ArrayBuffer): {
  rows: ServiceLine[];
  issues: ParseIssue[];
} {
  const wb = XLSX.read(data, { type: "array" });
  const issues: ParseIssue[] = [];
  const grid = sheetToGrid(wb, "Service Details");

  if (!grid) {
    issues.push({ level: "warning", message: 'No "Service Details" sheet, so procedures were skipped.' });
    return { rows: [], issues };
  }

  const header = findHeaderRow(grid, ["proc", "description", "units", "charge"]);
  if (header < 0) {
    issues.push({ level: "warning", message: "No header row on the Service Details sheet." });
    return { rows: [], issues };
  }

  const rows: ServiceLine[] = [];
  let classCode = "";

  for (let r = header + 1; r < grid.length; r++) {
    const first = text(grid[r]?.[0]);
    if (!first) continue;

    if (/total:?$/i.test(first)) continue;          // group and sub-group totals
    if (/^non-voided/i.test(first)) continue;       // sub-heading

    // A class heading looks like "1C - CONTRACTED ONE RATE" and carries no
    // figures of its own.
    const heading = first.match(/^([0-9A-Z]{1,3})\s+-\s+(.+)$/);
    if (heading && num(grid[r]?.[2] ?? null) === null) {
      classCode = heading[1].trim();
      continue;
    }

    const units = num(grid[r]?.[2] ?? null);
    const charges = num(grid[r]?.[3] ?? null);
    if (units === null && charges === null) continue;
    if (!classCode) continue;

    rows.push({
      classCode,
      procCode: first,
      description: text(grid[r]?.[1]),
      units: units ?? 0,
      charges: charges ?? 0,
    });
  }

  if (rows.length === 0) {
    issues.push({ level: "warning", message: "No procedure rows were recognised on the Service Details sheet." });
  }

  // Each class lists "Non-voided items" and then "Voided Items", and voided
  // rows carry NEGATIVE units and charges. The same CPT therefore appears
  // twice and the two must be summed — that nets to the class total the sheet
  // itself prints, and it is why the parsed grand total matches the Financial
  // Activity sheet.
  //
  // Summing here also removes the duplicate keys that made the database
  // reject the import: "ON CONFLICT DO UPDATE command cannot affect row a
  // second time" is Postgres refusing a payload that touches one row twice.
  const merged = new Map<string, ServiceLine>();
  for (const r of rows) {
    const key = `${r.classCode}|${r.procCode}`;
    const acc = merged.get(key);
    if (acc) {
      acc.units += r.units;
      acc.charges += r.charges;
    } else {
      merged.set(key, { ...r });
    }
  }

  return { rows: Array.from(merged.values()), issues };
}

// ===========================================================================
// REFERRING PROVIDERS
//
// Who is sending the patients. Business contact details, not patient data.
// The header row carries two MTD/YTD pairs: new patients first, then visits.
// ===========================================================================

export type ReferralRow = {
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  newPatientsMtd: number | null;
  newPatientsYtd: number | null;
  visitsMtd: number | null;
  visitsYtd: number | null;
  ytdCharges: number | null;
};

export function parseReferrals(data: ArrayBuffer): {
  rows: ReferralRow[];
  issues: ParseIssue[];
} {
  const wb = XLSX.read(data, { type: "array" });
  const issues: ParseIssue[] = [];
  const grid = sheetToGrid(wb, "ReferringProviderInbound");

  if (!grid) {
    issues.push({ level: "warning", message: 'No "ReferringProviderInbound" sheet, so referrals were skipped.' });
    return { rows: [], issues };
  }

  const header = findHeaderRow(grid, ["referring provider", "street", "city"]);
  if (header < 0) {
    issues.push({ level: "warning", message: "No header row on the referring provider sheet." });
    return { rows: [], issues };
  }

  const cols = (grid[header] ?? []).map((c) => text(c).toLowerCase());
  const at = (label: string) => cols.findIndex((c) => c.startsWith(label));

  // Two MTD columns and two YTD columns: new patients, then visits.
  const mtd = cols.map((c, i) => (c === "mtd" ? i : -1)).filter((i) => i >= 0);
  const ytd = cols.map((c, i) => (c === "ytd" ? i : -1)).filter((i) => i >= 0);
  if (mtd.length < 2 || ytd.length < 2) {
    issues.push({
      level: "warning",
      message: "The referring provider sheet did not have the expected MTD and YTD columns.",
    });
    return { rows: [], issues };
  }

  const iStreet = at("street");
  const iCity = at("city");
  const iState = at("st");
  const iZip = at("zip");
  const iCharges = cols.findIndex((c) => c.includes("ytd charges"));

  const rows: ReferralRow[] = [];
  let totalsRow: { newPatients: number | null; visits: number | null } | null = null;

  for (let r = header + 1; r < grid.length; r++) {
    const name = text(grid[r]?.[0]);
    if (!name) continue;

    // The sheet ends with a "Totals" row. It is not a referrer — it is the
    // checksum.
    if (/^totals?\b/i.test(name) || /total:?$/i.test(name)) {
      totalsRow = {
        newPatients: num(grid[r]?.[mtd[0]] ?? null),
        visits: num(grid[r]?.[mtd[1]] ?? null),
      };
      continue;
    }

    rows.push({
      name,
      street: iStreet >= 0 ? text(grid[r]?.[iStreet]) : "",
      city: iCity >= 0 ? text(grid[r]?.[iCity]) : "",
      state: iState >= 0 ? text(grid[r]?.[iState]) : "",
      zip: iZip >= 0 ? text(grid[r]?.[iZip]) : "",
      phone: text(grid[r]?.[7]),
      newPatientsMtd: num(grid[r]?.[mtd[0]] ?? null),
      newPatientsYtd: num(grid[r]?.[ytd[0]] ?? null),
      visitsMtd: num(grid[r]?.[mtd[1]] ?? null),
      visitsYtd: num(grid[r]?.[ytd[1]] ?? null),
      ytdCharges: iCharges >= 0 ? num(grid[r]?.[iCharges] ?? null) : null,
    });
  }

  // A provider can appear twice under the same name and zip. One row per key
  // is what the database expects, and the figures add.
  const mergedRefs = new Map<string, ReferralRow>();
  for (const r of rows) {
    const key = `${r.name}|${r.zip}`;
    const acc = mergedRefs.get(key);
    if (!acc) {
      mergedRefs.set(key, { ...r });
      continue;
    }
    const add = (a: number | null, b: number | null) =>
      a === null && b === null ? null : (a ?? 0) + (b ?? 0);
    acc.newPatientsMtd = add(acc.newPatientsMtd, r.newPatientsMtd);
    acc.newPatientsYtd = add(acc.newPatientsYtd, r.newPatientsYtd);
    acc.visitsMtd = add(acc.visitsMtd, r.visitsMtd);
    acc.visitsYtd = add(acc.visitsYtd, r.visitsYtd);
    acc.ytdCharges = add(acc.ytdCharges, r.ytdCharges);
  }
  rows.length = 0;
  rows.push(...Array.from(mergedRefs.values()));

  if (totalsRow) {
    const visits = rows.reduce((a, r) => a + (r.visitsMtd ?? 0), 0);
    const newPts = rows.reduce((a, r) => a + (r.newPatientsMtd ?? 0), 0);
    if (totalsRow.visits !== null && !agrees(visits, totalsRow.visits)) {
      issues.push({
        level: "error",
        message:
          `Referrals: visits add up to ${visits} across ${rows.length} providers, but the ` +
          `sheet's Totals row says ${totalsRow.visits}.`,
      });
    }
    if (totalsRow.newPatients !== null && !agrees(newPts, totalsRow.newPatients)) {
      issues.push({
        level: "error",
        message:
          `Referrals: new patients add up to ${newPts}, but the sheet's Totals row says ` +
          `${totalsRow.newPatients}.`,
      });
    }
  }

  return { rows, issues };
}
