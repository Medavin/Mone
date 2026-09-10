import * as XLSX from "xlsx";
import type { ClinicMonth } from "./clinicMonth";

/**
 * Builds the monthly pack — the workbook Momentum currently assembles by hand.
 *
 * This is the point of the whole application. Nine sheets across thirty-eight
 * clinics, stitched together from several AdvancedMD reports, takes about
 * fifteen working days a month. Every figure in it is already in MBOne; this
 * writes them back out in the shape the clients are used to receiving.
 *
 * ⚠ THE LAYOUT IS NOT A DESIGN DECISION. It matches the existing workbook
 * sheet for sheet and label for label, because the people receiving it have
 * been reading it for years and a "better" arrangement is a worse document to
 * them. Where the original prints a blank, this prints a blank.
 *
 * ⚠ AND THE GRAND TOTAL ROWS ARE DELIBERATE. They are what makes the file
 * checkable — MBOne validates every import against them, and that is how a
 * $1,303.58 discrepancy in Momentum's own December report was found. A
 * generated file without them would be less trustworthy than the manual one.
 */

type Cell = string | number | null;
type Grid = Cell[][];

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const orNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const monthTitle = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

/** Mgmt Summary — laid out row for row as the original. */
function mgmtSummary(d: ClinicMonth, clinicName: string, periodLabel?: string): Grid {
  const s = d.summaryRow ?? {};
  const f = d.facts;

  const opening = n(s.opening_ar);
  const closing = n(s.closing_ar);
  const charges = n(s.charges);
  const adjustments = n(s.adjustments);
  const patientPay = n(s.patient_payments);
  const insurancePay = n(s.insurance_payments);
  const payments = patientPay + insurancePay || n(s.payments);

  // Insurance against patient, by aging bucket. Held separately in MBOne
  // because the original report ages them separately — a combined figure
  // cannot be split back apart afterwards.
  const split = (d.split ?? []) as Record<string, number>[];
  const side = (which: string) => split.find((r) => String(r.side) === which) ?? {};
  const ins = side("insurance");
  const pat = side("patient");

  const bucket = (k: string) => n(ins[k]) + n(pat[k]);
  const combinedTotal =
    bucket("bucket_current") + bucket("bucket_30") + bucket("bucket_60") +
    bucket("bucket_90") + bucket("bucket_120_plus");

  const pctOf = (v: number) => (combinedTotal ? v / combinedTotal : 0);

  const g: Grid = [];
  const put = (r: number, c: number, v: Cell) => {
    while (g.length <= r) g.push([]);
    const row = g[r];
    while (row.length <= c) row.push(null);
    row[c] = v;
  };

  put(0, 0, "Management Summary");
  put(1, 0, clinicName);
  // A range says so; a single month reads exactly as the original does.
  put(2, 0, periodLabel ?? (d.month ? monthTitle(d.month) : ""));

  put(4, 0, "Change in A/R");
  put(5, 1, "Beginning A/R:");        put(5, 4, orNull(opening));
  put(6, 1, "A/R Increase (Decrease):"); put(6, 4, orNull(closing - opening));
  put(7, 1, "Ending A/R:");           put(7, 4, orNull(closing));

  put(9, 0, "Transaction Summary");   put(9, 2, "Selected Period");
  put(10, 0, "Charges/Adjustments");
  put(11, 1, "Charges:");             put(11, 4, orNull(charges));
  put(12, 1, "Adjustments:");         put(12, 3, "-"); put(12, 4, orNull(adjustments));
  put(13, 1, "Total:");               put(13, 4, orNull(charges - adjustments));

  put(15, 0, "Payments");
  put(16, 1, "Patient:");             put(16, 4, orNull(patientPay));
  put(17, 1, "Insurance:");           put(17, 3, "+"); put(17, 4, orNull(insurancePay));
  put(18, 1, "Total:");               put(18, 4, orNull(payments));

  put(20, 0, "Net Total");            put(20, 4, orNull(charges - adjustments - payments));

  put(22, 0, "Patient Balance Information");
  put(23, 0, "Patients with Balances:");  put(23, 2, orNull(s.patients_with_balances));
  put(24, 0, "Average Patient Balance:"); put(24, 2, orNull(s.average_patient_balance));

  put(28, 0, "Current A/R ");
  put(29, 7, "% of");
  put(30, 2, "Insurance"); put(30, 4, "Patient"); put(30, 5, "Combined"); put(30, 6, "Combined");

  const rows: [string, string][] = [
    ["Current:", "bucket_current"],
    ["Over 30:", "bucket_30"],
    ["Over 60:", "bucket_60"],
    ["Over 90:", "bucket_90"],
    ["Over 120:", "bucket_120_plus"],
  ];
  rows.forEach(([label, key], i) => {
    const r = 31 + i;
    put(r, 1, label);
    put(r, 2, orNull(n(ins[key])));
    put(r, 4, orNull(n(pat[key])));
    put(r, 5, orNull(bucket(key)));
    put(r, 6, pctOf(bucket(key)));
  });

  const insTotal = rows.reduce((t, [, k]) => t + n(ins[k]), 0);
  const patTotal = rows.reduce((t, [, k]) => t + n(pat[k]), 0);
  put(36, 1, "Total:"); put(36, 2, orNull(insTotal)); put(36, 4, orNull(patTotal));
  put(36, 5, orNull(combinedTotal)); put(36, 6, pctOf(combinedTotal));

  const unapplied = n(s.unapplied);
  put(37, 1, "Unapplied:"); put(37, 5, orNull(unapplied)); put(37, 6, pctOf(unapplied));
  put(38, 1, "Net Total:"); put(38, 5, orNull(combinedTotal + unapplied));

  if (!f) put(40, 0, "No figures are loaded for this month.");
  return g;
}

/** Financial Class A-R, with its Grand Total row. */
function classAr(d: ClinicMonth, clinicName: string): Grid {
  const g: Grid = [
    ["Financial Class", null, null, null, null, null, null, "By Aging Date"],
    [clinicName],
    ["Financial Class", null, "Current", "30 Days", "60 Days", "90 Days", "120 Days", "Total"],
  ];

  let t = [0, 0, 0, 0, 0];
  for (const row of d.ar as Record<string, number>[]) {
    const cls = d.classes.get(Number(row.financial_class_id));
    const vals = [
      n(row.bucket_current), n(row.bucket_30), n(row.bucket_60),
      n(row.bucket_90), n(row.bucket_120_plus),
    ];
    t = t.map((v, i) => v + vals[i]);
    g.push([cls?.code ?? "", cls?.name ?? "", ...vals, vals.reduce((a, b) => a + b, 0)]);
  }

  g.push(["Grand Total:", null, ...t, t.reduce((a, b) => a + b, 0)]);
  return g;
}

/** Financial Activity. Mixes are computed here, never stored. */
function activity(d: ClinicMonth, clinicName: string): Grid {
  const g: Grid = [
    ["Financial Activity"],
    [clinicName],
    ["Units & Charges"],
    ["Payments & Adjustments"],
    ["Financial Class", null, "Units", "Charges", "Payments", "Adjustments",
     "Charges Mix", "Payments Mix", "Adjustments Mix"],
  ];

  const rows = d.activity as Record<string, number>[];
  const tot = (k: string) => rows.reduce((s, r) => s + n(r[k]), 0);
  const tc = tot("charges"), tp = tot("payments"), ta = tot("adjustments"), tu = tot("units");

  for (const row of rows) {
    const cls = d.classes.get(Number(row.financial_class_id));
    g.push([
      `${cls?.code ?? ""} - ${cls?.name ?? ""}`, null,
      n(row.units), n(row.charges), n(row.payments), n(row.adjustments),
      tc ? n(row.charges) / tc : 0,
      tp ? n(row.payments) / tp : 0,
      ta ? n(row.adjustments) / ta : 0,
    ]);
  }

  g.push(["Grand Total: ", null, tu, tc, tp, ta, tc ? 1 : 0, tp ? 1 : 0, ta ? 1 : 0]);
  return g;
}

function carriers(d: ClinicMonth, clinicName: string): Grid {
  const g: Grid = [
    ["Carrier A/R"], [clinicName],
    ["Carrier", "Current", "30 Days", "60 Days", "90 Days", "120 Days", "Total"],
  ];
  let t = [0, 0, 0, 0, 0];
  for (const c of d.carriers) {
    const v = [
      n(c.row.bucket_current), n(c.row.bucket_30), n(c.row.bucket_60),
      n(c.row.bucket_90), n(c.row.bucket_120_plus),
    ];
    t = t.map((x, i) => x + v[i]);
    g.push([c.name, ...v, v.reduce((a, b) => a + b, 0)]);
  }
  g.push(["Grand Total:", ...t, t.reduce((a, b) => a + b, 0)]);
  return g;
}

function services(d: ClinicMonth, clinicName: string): Grid {
  const g: Grid = [
    ["Service Details"], [clinicName],
    [d.month ? `Date of Entry, Date Ranges ${d.month}-01 to month end` : ""],
    ["Code", "Description", "Units", "Charges"],
  ];
  let u = 0, c = 0;
  for (const s of d.services) {
    u += n(s.units); c += n(s.charges);
    g.push([s.code, s.desc, n(s.units), n(s.charges)]);
  }
  g.push(["Grand Total:", null, u, c]);
  return g;
}

function referrals(d: ClinicMonth, clinicName: string): Grid {
  const g: Grid = [
    ["Referring Provider Inbound"], [clinicName],
    ["Referring Provider", "City", "Visits", "New Patients", "Charges", "Payments"],
  ];
  let t = [0, 0, 0, 0];
  for (const r of d.referrals) {
    const v = [n(r.row.visits), n(r.row.new_patients), n(r.row.charges), n(r.row.payments)];
    t = t.map((x, i) => x + v[i]);
    g.push([r.name, r.city, ...v]);
  }
  g.push(["Totals:", null, ...t]);
  return g;
}

/** History across months — charges, payments and adjustments as three blocks. */
function history(d: ClinicMonth, clinicName: string): Grid {
  const months = d.history.map((h) => h.month);
  const g: Grid = [
    ["Historical Charges, Payments and Adjustments"], [clinicName], [],
    ["Charges", ...months],
    ["Total", ...d.history.map((h) => orNull(h.charges))],
    [],
    ["Payments", ...months],
    ["Total", ...d.history.map((h) => orNull(h.payments))],
    [],
    ["Adjustments", ...months],
    ["Total", ...d.history.map((h) => orNull(h.adjustments))],
  ];
  return g;
}

function visits(d: ClinicMonth, clinicName: string): Grid {
  const months = d.history.map((h) => h.month);
  return [
    ["Visits & New Patients"], [clinicName], [],
    ["Visits", ...months],
    ["Total", ...d.history.map((h) => orNull(h.visits))],
    [],
    ["New Patients", ...months],
    ["Total", ...d.history.map((h) => orNull(h.newPatients))],
  ];
}

export type PackWarning = { sheet: string; message: string };

/**
 * Returns the workbook and anything that could not be filled.
 *
 * ⚠ WARNINGS ARE RETURNED, NOT SWALLOWED. A pack with a missing sheet that
 * looks complete is worse than one that says what is absent — it gets sent
 * to a client and the gap is found by them.
 */
export function buildMonthlyPack(d: ClinicMonth & { period?: { label: string } }): {
  buffer: ArrayBuffer;
  fileName: string;
  warnings: PackWarning[];
} {
  const clinicName = d.clinic.name.toUpperCase();
  const warnings: PackWarning[] = [];

  const sheets: [string, Grid][] = [
    ["Mgmt Summary", mgmtSummary(d, clinicName, d.period?.label)],
    ["Financial Class A-R", classAr(d, clinicName)],
    ["Carrier AR", carriers(d, clinicName)],
    ["Financial Activity", activity(d, clinicName)],
    ["Hist Chg Pmt Adj", history(d, clinicName)],
    ["Visits & New Patients", visits(d, clinicName)],
    ["Service Details", services(d, clinicName)],
    ["ReferringProviderInbound", referrals(d, clinicName)],
  ];

  if (d.carriers.length === 0) warnings.push({ sheet: "Carrier AR", message: "No carrier rows are loaded for this month." });
  if (d.services.length === 0) warnings.push({ sheet: "Service Details", message: "No service rows are loaded for this month." });
  if (d.referrals.length === 0) warnings.push({ sheet: "ReferringProviderInbound", message: "No referral rows are loaded." });
  if (d.history.length === 0) warnings.push({ sheet: "Hist Chg Pmt Adj", message: "No history is loaded, so the trend sheets are empty." });
  if (!d.summaryRow) warnings.push({ sheet: "Mgmt Summary", message: "No clinic summary row for this month — the top of the summary will be blank." });

  // The original carries a chart sheet. SheetJS cannot write charts, so the
  // numbers behind it ship as a normal sheet and Excel can draw it. Said out
  // loud rather than quietly omitted.
  warnings.push({
    sheet: "Monthly Activity Graph",
    message:
      "The chart sheet is not generated — the figures behind it are on Hist Chg Pmt Adj, and Excel can chart them in two clicks.",
  });

  const book = XLSX.utils.book_new();
  for (const [name, grid] of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(grid as (string | number | null)[][]);
    XLSX.utils.book_append_sheet(book, ws, name.slice(0, 31));
  }

  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const slug = d.clinic.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const label = (d.period?.label ?? (d.month
    ? new Date(`${d.month}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "no_month")).replace(/\s+/g, "_");

  return { buffer, fileName: `${slug}_-_${label}.xlsx`, warnings };
}
