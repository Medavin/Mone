/**
 * Parses a monthly clinic report workbook into the rows our tables expect.
 *
 * Shared by the CLI (scripts/parse-report.mjs) and the /reports page, so the
 * figures on screen come from exactly the code the CLI reconciles.
 *
 * Pure: it reads a workbook and returns data. It never touches the database.
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
  // Number(date) is epoch milliseconds — a silent ~1.6e12 per cell if a date
  // column is ever read as a figure. Dates are never quantities here.
  if (v instanceof Date) return null;
  const n = typeof v === "object" && "result" in v ? v.result : v;
  if (n instanceof Date) return null;
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

/**
 * "Service Details" -> service_monthly. Nests financial class > "Non-voided
 * items" > procedure lines, with a stated total per class to check against.
 */
function parseServiceDetails(sheet) {
  let financialClass = null;
  const rows = [];
  const stated = new Map();
  const parsed = new Map();

  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const c1 = text(cellValue(row, 1));
    const units = num(cellValue(row, 3));
    const charge = num(cellValue(row, 4));
    if (!c1) continue;

    // "1A - AUTO Total:" closes a class; "Non-voided items Total:" is an
    // inner subtotal we ignore, since its lines are already counted.
    const totalMatch = /^(.*?)\s*Total:?\s*$/i.exec(c1);
    if (totalMatch) {
      const label = totalMatch[1].trim();
      if (/non-voided/i.test(label)) continue;
      stated.set(label.split(" - ")[0].trim(), charge ?? 0);
      continue;
    }

    // A class heading carries no figures of its own.
    if (/^\w{1,3} - /.test(c1) && units === null) {
      financialClass = c1.split(" - ")[0].trim();
      continue;
    }

    if (/^non-voided/i.test(c1) || c1 === "Proc") continue;

    // Procedure line: code, description, units, charge.
    if (units !== null || charge !== null) {
      rows.push({
        financial_class_code: financialClass,
        procedure_code: c1,
        description: text(cellValue(row, 2)),
        units,
        charges: charge,
      });
      if (financialClass) {
        parsed.set(financialClass, (parsed.get(financialClass) ?? 0) + (charge ?? 0));
      }
    }
  }

  let checked = 0;
  let mismatched = 0;
  for (const [code, total] of stated) {
    if (!parsed.has(code)) continue;
    checked++;
    if (Math.abs(round2(total - parsed.get(code))) >= 0.01) mismatched++;
  }
  return { rows, checks: { checked, mismatched } };
}

/** Excel serial dates and real dates both appear in these headers. */
function headerMonth(value) {
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  const parsed = typeof value === "string" ? new Date(value) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-01`;
  }
  return null;
}

/**
 * "Visits & New Patients" is wide — financial class down, months across, with
 * a block per metric. Unpivots to one row per class per month per metric.
 */
function parseVisitsAndNewPatients(sheet) {
  let metric = null;
  let months = null;
  const rows = [];

  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const c1 = text(cellValue(row, 1));
    if (!c1) continue;

    // Header row for a block: months run across from column 3.
    if (/^financial class/i.test(c1)) {
      months = [];
      for (let c = 3; c <= sheet.columnCount; c++) {
        months.push({ col: c, month: headerMonth(cellValue(row, c)) });
      }
      months = months.filter((m) => m.month);
      continue;
    }

    // A bare title line switches which metric the next block holds.
    if (num(cellValue(row, 3)) === null && !text(cellValue(row, 2))) {
      if (/new patient/i.test(c1)) metric = "new_patients";
      else if (/visit/i.test(c1)) metric = "visits";
      continue;
    }

    if (!metric || !months || /total/i.test(c1)) continue;

    for (const { col, month } of months) {
      const value = num(cellValue(row, col));
      if (value === null) continue;
      rows.push({
        metric,
        financial_class_code: c1,
        financial_class_name: text(cellValue(row, 2)),
        period_month: month,
        value,
      });
    }
  }
  return { rows };
}

/**
 * "ReferringProviderInbound" -> referring_providers + referrals_monthly.
 *
 * Column positions are NOT stable between exports — Street sits in column 5 in
 * one month's file and column 3 in another, because the layout merges a
 * different number of cells. Reading by fixed index silently yields nulls and
 * zeroes, so resolve every column from the header text instead.
 *
 * MTD/YTD appear twice, once under "New Patients" and once under "Visits";
 * the group label sits on the row above, spanning its pair.
 */
function parseReferringProviders(sheet) {
  const header = findHeaderRow(sheet, "Referring Provider Name", 10);
  if (!header) return { rows: [], error: "no header row" };

  const headerRow = sheet.getRow(header);
  const groupRow = sheet.getRow(header - 1);
  const col = {};
  const periodCols = [];

  for (let c = 1; c <= sheet.columnCount; c++) {
    const label = text(cellValue(headerRow, c))?.toLowerCase();
    if (!label) continue;
    if (label.includes("referring provider name")) col.name = c;
    else if (label === "street") col.street = c;
    else if (label === "city") col.city = c;
    else if (label === "st" || label === "state") col.state = c;
    else if (label === "zip") col.zip = c;
    else if (label.includes("phone")) col.phone = c;
    else if (label.includes("email")) col.email = c;
    else if (label === "mtd" || label === "ytd") periodCols.push({ c, label });
  }

  // Walk left from each MTD/YTD column to find the group heading above it.
  let group = null;
  for (const entry of periodCols) {
    for (let c = entry.c; c >= 1; c--) {
      const heading = text(cellValue(groupRow, c))?.toLowerCase();
      if (heading) {
        group = heading.includes("new patient") ? "new_patients" : "visits";
        break;
      }
    }
    col[`${group ?? "visits"}_${entry.label}`] = entry.c;
  }

  const at = (row, key) => (col[key] ? cellValue(row, col[key]) : null);

  const rows = [];
  for (let r = header + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const name = text(at(row, "name"));
    if (!name || /total/i.test(name)) continue;
    rows.push({
      name,
      street: text(at(row, "street")),
      city: text(at(row, "city")),
      state: text(at(row, "state")),
      zip: text(at(row, "zip")),
      phone: text(at(row, "phone")),
      email: text(at(row, "email")),
      new_patients_mtd: num(at(row, "new_patients_mtd")),
      new_patients_ytd: num(at(row, "new_patients_ytd")),
      visits_mtd: num(at(row, "visits_mtd")),
      visits_ytd: num(at(row, "visits_ytd")),
    });
  }
  return { rows, columns: col };
}

/** Parse an already-loaded workbook. */
export function parseWorkbook(wb, fileName) {
  const { clinicName, periodMonth } = parseFileName(fileName);
  const get = (name) => wb.getWorksheet(name);
  const ar = get("Financial Class A-R");
  const activity = get("Financial Activity");
  const carrier = get("Carrier AR");
  const services = get("Service Details");
  const visits = get("Visits & New Patients");
  const referrals = get("ReferringProviderInbound");

  return {
    source_file: path.basename(fileName),
    clinic_name: clinicName,
    period_month: periodMonth,
    sheets_present: wb.worksheets.map((w) => w.name),
    ar_monthly: ar ? parseFinancialClassAr(ar) : { rows: [], error: "sheet missing" },
    activity_monthly: activity
      ? parseFinancialActivity(activity)
      : { rows: [], error: "sheet missing" },
    carrier_ar: carrier
      ? parseCarrierAr(carrier)
      : { claims: [], cptLines: 0, checks: {}, error: "sheet missing" },
    service_monthly: services
      ? parseServiceDetails(services)
      : { rows: [], error: "sheet missing" },
    visits_new_patients: visits
      ? parseVisitsAndNewPatients(visits)
      : { rows: [], error: "sheet missing" },
    referrals_monthly: referrals
      ? parseReferringProviders(referrals)
      : { rows: [], error: "sheet missing" },
  };
}

/** Parse from a file path (CLI). */
export async function parseReportFile(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return parseWorkbook(wb, file);
}

/** Parse from bytes (upload). */
export async function parseReportBuffer(buffer, fileName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return parseWorkbook(wb, fileName);
}
