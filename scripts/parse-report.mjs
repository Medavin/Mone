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

/**
 * exceljs reports a merged range's value on every cell in it, while the
 * exports merge cells liberally for layout. Reading a merged slave as if it
 * held its own value duplicates figures into neighbouring columns, so treat
 * anything but the master cell as empty.
 */
function cellValue(row, n) {
  const cell = row.getCell(n);
  if (cell.isMerged && cell.master && cell.master.address !== cell.address) {
    return null;
  }
  return cell.value;
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
    if (text(cellValue(sheet.getRow(r), 1))?.toLowerCase() ===
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
    const code = text(cellValue(row, 1));
    if (!code || /grand total/i.test(code)) continue;
    rows.push({
      financial_class_code: code,
      financial_class_name: text(cellValue(row, 2)),
      bucket_current: num(cellValue(row, 3)),
      bucket_30: num(cellValue(row, 4)),
      bucket_60: num(cellValue(row, 5)),
      bucket_90: num(cellValue(row, 6)),
      bucket_120_plus: num(cellValue(row, 7)),
      closing_ar: num(cellValue(row, 8)),
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
    const label = text(cellValue(row, 1));
    if (!label) continue;

    const record = {
      units: num(cellValue(row, 3)),
      charges: num(cellValue(row, 4)),
      payments: num(cellValue(row, 5)),
      adjustments: num(cellValue(row, 6)),
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

const BUCKETS = [
  "bucket_current",
  "bucket_30",
  "bucket_60",
  "bucket_90",
  "bucket_120_plus",
];

function zeroBuckets() {
  return { bucket_current: 0, bucket_30: 0, bucket_60: 0, bucket_90: 0, bucket_120_plus: 0, total: 0 };
}

function addBuckets(target, row) {
  for (let i = 0; i < BUCKETS.length; i++) {
    target[BUCKETS[i]] += num(cellValue(row, 5 + i)) ?? 0;
  }
  target.total += num(cellValue(row, 10)) ?? 0;
}

/**
 * "Carrier AR" nests four levels deep:
 *
 *   Carrier            c2 = name, aging figures, c1 empty
 *     Provider         c1 = name, aging figures
 *       Chart/Visit    c1 = "CHART n", c3 = "VISIT n", no figures
 *         CPT line     c4 = code, aging figures      <-- the only leaf
 *     "<Provider> Total:"                            <-- subtotal, must not be summed
 *
 * Only CPT lines carry real money; everything else is a heading or a subtotal,
 * and summing them alongside the leaves would double-count. Accounts are
 * rolled up to chart+visit, which is the claim grain.
 */
function parseCarrierAr(sheet) {
  let carrier = null;
  let chart = null;
  let visit = null;

  // The provider block currently open, closed by its own "Total:" row. Matching
  // positionally rather than by name matters: the same provider appears under
  // several carriers, and carrier totals are spelled the same way as provider
  // totals, so name matching misassigns them.
  let openProvider = null;
  let carrierRunning = zeroBuckets();

  const claims = new Map();
  let cptLines = 0;
  const checks = { providers: 0, providerMismatch: 0, carriers: 0, carrierMismatch: 0, drift: 0 };

  const closeProvider = () => {
    if (!openProvider) return;
    checks.providers++;
    const diff = round2(openProvider.stated.total - openProvider.parsed.total);
    if (Math.abs(diff) >= 0.01) {
      checks.providerMismatch++;
      checks.drift += diff;
    }
    openProvider = null;
  };

  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const c1 = text(cellValue(row, 1));
    const c2 = text(cellValue(row, 2));
    const c3 = text(cellValue(row, 3));
    const c4 = text(cellValue(row, 4));
    const total = num(cellValue(row, 10));
    const hasFigures = total !== null;

    // Column headings, repeated once per detail block.
    if (c2 === "Chart" && c3 === "Visit ID") continue;
    if (c4 === "CPT Code") continue;
    if (c1 === "Code" && c2 === "Carrier Name") continue;
    if (c1 && /^provider name/i.test(c1)) continue;

    // A "… Total:" row closes whichever block is currently open.
    if (c2 && /total:?\s*$/i.test(c2)) {
      if (openProvider) {
        addBuckets(openProvider.stated, row);
        closeProvider();
      } else {
        // No provider open, so this closes the carrier.
        checks.carriers++;
        if (Math.abs(round2(total - carrierRunning.total)) >= 0.01) {
          checks.carrierMismatch++;
        }
        carrierRunning = zeroBuckets();
      }
      continue;
    }

    // CPT service line — the only row that contributes money.
    if (c4 && hasFigures) {
      cptLines++;
      const key = `${carrier}||${openProvider?.name}||${chart}||${visit}`;
      const claim = claims.get(key) ?? {
        carrier_name: carrier,
        provider_name: openProvider?.name ?? null,
        chart,
        visit_id: visit,
        cpt_lines: 0,
        ...zeroBuckets(),
      };
      claim.cpt_lines++;
      addBuckets(claim, row);
      claims.set(key, claim);

      if (openProvider) addBuckets(openProvider.parsed, row);
      addBuckets(carrierRunning, row);
      continue;
    }

    // Chart/visit heading — the claim the following CPT lines belong to.
    // Detected structurally (identifiers in columns 1 and 3, no CPT code, no
    // figures) rather than by matching "CHART n": de-identified exports use
    // that placeholder, but live ones carry real chart and visit numbers.
    if (c1 && c3 && !c2 && !c4 && !hasFigures) {
      chart = c1;
      visit = c3;
      continue;
    }

    // Provider line: name in column 1 with its own figures. Opens a block.
    if (c1 && hasFigures) {
      closeProvider();
      openProvider = { name: c1, stated: zeroBuckets(), parsed: zeroBuckets() };
      chart = null;
      visit = null;
      continue;
    }

    // Carrier line: name in column 2, nothing in column 1.
    if (!c1 && c2 && hasFigures) {
      closeProvider();
      carrier = c2;
      carrierRunning = zeroBuckets();
      chart = null;
      visit = null;
    }
  }
  closeProvider();

  return { claims: Array.from(claims.values()), cptLines, checks };
}

const round2 = (n) => Math.round(n * 100) / 100;

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

  const { claims, cptLines, checks } = result.carrier_ar;
  const carrierTotal = claims.reduce((s, a) => s + a.total, 0);
  const charts = new Set(claims.map((c) => c.chart)).size;
  const claims120 = claims.filter((c) => c.bucket_120_plus > 0);

  console.log(`\ncarrier_ar       : ${cptLines.toLocaleString("en-US")} CPT lines`);
  console.log(`  claims         : ${claims.length.toLocaleString("en-US")} (chart+visit)`);
  console.log(`  patient charts : ${charts.toLocaleString("en-US")}`);
  console.log(`  total          : ${money(carrierTotal)}`);
  console.log(`  claims 120+    : ${claims120.length.toLocaleString("en-US")}`);
  console.log(
    `  amount 120+    : ${money(claims120.reduce((s, c) => s + c.bucket_120_plus, 0))}`,
  );

  // The sheet states its own provider subtotals. If what we summed beneath a
  // provider doesn't match its subtotal, the parse is wrong — that check is
  // internal to the sheet and must hold.
  const clean = checks.providerMismatch === 0 && checks.carrierMismatch === 0;
  console.log(
    `\nreconciliation   : ${checks.providers} provider blocks, ` +
      `${checks.providerMismatch} mismatched` +
      ` | ${checks.carriers} carrier blocks, ${checks.carrierMismatch} mismatched` +
      (clean ? "  ✓" : `  drift ${money(checks.drift)}`),
  );

  // This one is NOT expected to match: the carrier report covers balances
  // assigned to a carrier, while the AR summary covers everything.
  console.log(
    `\nfor information  : AR summary ${money(arTotal)} vs carrier detail ` +
      `${money(carrierTotal)} — difference ${money(arTotal - carrierTotal)}`,
  );
  console.log();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
