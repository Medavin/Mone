/**
 * Parses a monthly clinic report workbook into the rows our tables expect.
 *
 *   node scripts/parse-report.mjs "<path to .xlsx>" [--json]
 *
 * Read-only: it prints what it found and writes nothing to the database.
 * Loading is a separate step, so a bad parse can never corrupt real data.
 */
import ExcelJS from "exceljs";
import path from "node:path";

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Reports are named "<Clinic Name> - <Mon> <YYYY>.xlsx". */
function parseFileName(file) {
  const base = path.basename(file, path.extname(file));
  const match = /^(.*?)\s*-\s*([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(base.trim());
  if (!match) return { clinicName: base.trim(), periodMonth: null };
  const month = MONTHS[match[2].toLowerCase()];
  return {
    clinicName: match[1].trim(),
    periodMonth: month
      ? `${match[3]}-${String(month).padStart(2, "0")}-01`
      : null,
  };
}

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "object" && "result" in v ? v.result : v;
  const parsed = Number(n);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (v) => {
  if (v === null || v === undefined) return null;
  const s = (typeof v === "object" && "richText" in v
    ? v.richText.map((r) => r.text).join("")
    : String(v)
  ).trim();
  return s === "" ? null : s;
};

/** Find the row holding the column headers, so a shifted export still parses. */
function findHeaderRow(sheet, firstCell, limit = 12) {
  for (let r = 1; r <= limit; r++) {
    if (text(sheet.getRow(r).getCell(1).value)?.toLowerCase() ===
        firstCell.toLowerCase()) {
      return r;
    }
  }
  return null;
}

/** "Financial Class A-R" -> ar_monthly, one row per financial class. */
function parseFinancialClassAr(sheet) {
  const header = findHeaderRow(sheet, "Financial Class");
  if (!header) return { rows: [], error: "no 'Financial Class' header row" };

  const rows = [];
  for (let r = header + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const code = text(row.getCell(1).value);
    if (!code || /grand total/i.test(code)) continue;
    rows.push({
      financial_class_code: code,
      financial_class_name: text(row.getCell(2).value),
      bucket_current: num(row.getCell(3).value),
      bucket_30: num(row.getCell(4).value),
      bucket_60: num(row.getCell(5).value),
      bucket_90: num(row.getCell(6).value),
      bucket_120_plus: num(row.getCell(7).value),
      closing_ar: num(row.getCell(8).value),
    });
  }
  return { rows };
}

/** "Financial Activity" -> activity_monthly. Class arrives as "1A - AUTO". */
function parseFinancialActivity(sheet) {
  const header = findHeaderRow(sheet, "Financial Class");
  if (!header) return { rows: [], error: "no 'Financial Class' header row" };

  const rows = [];
  let grandTotal = null;
  for (let r = header + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const label = text(row.getCell(1).value);
    if (!label) continue;

    const record = {
      units: num(row.getCell(3).value),
      charges: num(row.getCell(4).value),
      payments: num(row.getCell(5).value),
      adjustments: num(row.getCell(6).value),
    };

    if (/grand total/i.test(label)) {
      grandTotal = record;
      continue;
    }
    const [code, ...rest] = label.split(" - ");
    rows.push({
      financial_class_code: code.trim(),
      financial_class_name: rest.join(" - ").trim() || null,
      ...record,
    });
  }
  return { rows, grandTotal };
}

/**
 * "Carrier AR" is hierarchical: carrier, then provider, then a repeating
 * Chart / Visit ID / CPT block. Only the leaf rows are account-level, and
 * they're identified by the header row that precedes them.
 */
function parseCarrierAr(sheet) {
  let carrier = null;
  let provider = null;
  let inDetail = false;
  const accounts = [];

  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const c1 = text(row.getCell(1).value);
    const c2 = text(row.getCell(2).value);
    const c3 = text(row.getCell(3).value);

    // Header of a detail block — the rows beneath it are accounts.
    if (c2 === "Chart" && c3 === "Visit ID") { inDetail = true; continue; }
    if (c1 === "Code" && c2 === "Carrier Name") { inDetail = false; continue; }

    if (c1 && /^provider name/i.test(c1)) { inDetail = false; continue; }

    if (inDetail && c1) {
      accounts.push({
        carrier_name: carrier,
        provider_name: provider,
        chart: c1,
        visit_id: c3,
        cpt_code: text(row.getCell(4).value),
        bucket_current: num(row.getCell(5).value),
        bucket_30: num(row.getCell(6).value),
        bucket_60: num(row.getCell(7).value),
        bucket_90: num(row.getCell(8).value),
        bucket_120_plus: num(row.getCell(9).value),
        total: num(row.getCell(10).value),
      });
    } else if (c1 && !inDetail) {
      // Carrier/provider context lines carry no aging figures of their own.
      if (num(row.getCell(5).value) === null) carrier = c1;
      else provider = c1;
    }
  }
  return { accounts };
}

async function main() {
  const file = process.argv[2];
  const asJson = process.argv.includes("--json");
  if (!file) {
    console.error('usage: node scripts/parse-report.mjs "<report.xlsx>" [--json]');
    process.exit(1);
  }

  const { clinicName, periodMonth } = parseFileName(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const get = (name) => wb.getWorksheet(name);
  const ar = get("Financial Class A-R");
  const activity = get("Financial Activity");
  const carrier = get("Carrier AR");

  const result = {
    source_file: path.basename(file),
    clinic_name: clinicName,
    period_month: periodMonth,
    sheets_present: wb.worksheets.map((w) => w.name),
    ar_monthly: ar ? parseFinancialClassAr(ar) : { rows: [], error: "sheet missing" },
    activity_monthly: activity
      ? parseFinancialActivity(activity)
      : { rows: [], error: "sheet missing" },
    carrier_ar: carrier ? parseCarrierAr(carrier) : { accounts: [], error: "sheet missing" },
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const money = (n) =>
    n === null || n === undefined
      ? "—"
      : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  console.log(`\nFile      : ${result.source_file}`);
  console.log(`Clinic    : ${result.clinic_name}`);
  console.log(`Period    : ${result.period_month ?? "COULD NOT PARSE"}`);
  console.log(`Sheets    : ${result.sheets_present.length}`);

  console.log(`\nar_monthly       : ${result.ar_monthly.rows.length} rows`);
  const arTotal = result.ar_monthly.rows.reduce((s, r) => s + (r.closing_ar ?? 0), 0);
  const ar120 = result.ar_monthly.rows.reduce((s, r) => s + (r.bucket_120_plus ?? 0), 0);
  console.log(`  total AR       : ${money(arTotal)}`);
  console.log(`  120+ days      : ${money(ar120)}`);

  console.log(`\nactivity_monthly : ${result.activity_monthly.rows.length} rows`);
  const gt = result.activity_monthly.grandTotal;
  if (gt) {
    console.log(`  charges        : ${money(gt.charges)}`);
    console.log(`  payments       : ${money(gt.payments)}`);
    console.log(`  adjustments    : ${money(gt.adjustments)}`);
    console.log(`  units          : ${gt.units?.toLocaleString("en-US") ?? "—"}`);
  }

  const accounts = result.carrier_ar.accounts;
  console.log(`\ncarrier_ar       : ${accounts.length} account rows`);
  const acct120 = accounts.filter((a) => (a.bucket_120_plus ?? 0) > 0);
  console.log(`  accounts 120+  : ${acct120.length.toLocaleString("en-US")}`);
  console.log(
    `  amount 120+    : ${money(acct120.reduce((s, a) => s + (a.bucket_120_plus ?? 0), 0))}`,
  );

  // The two sheets are independent exports of the same month, so a mismatch
  // means one of them was parsed wrong.
  const drift = Math.abs(arTotal - accounts.reduce((s, a) => s + (a.total ?? 0), 0));
  console.log(
    `\ncross-check      : AR summary vs carrier detail differ by ${money(drift)}`,
  );
  console.log();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
