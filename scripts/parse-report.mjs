/**
 * Command-line view of the report parser.
 *
 *   node scripts/parse-report.mjs "<path to .xlsx>" [--json]
 *
 * Parsing lives in src/lib/report/parse.mjs, shared with the /reports page so
 * both show the same figures. This writes nothing to the database.
 */
import { parseReportFile } from "../src/lib/report/parse.mjs";

async function main() {
  const file = process.argv[2];
  const asJson = process.argv.includes("--json");
  if (!file) {
    console.error('usage: node scripts/parse-report.mjs "<report.xlsx>" [--json]');
    process.exit(1);
  }

  const result = await parseReportFile(file);

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

  const svc = result.service_monthly;
  console.log(`\nservice_monthly  : ${svc.rows.length} procedure lines`);
  console.log(
    `  charges        : ${money(svc.rows.reduce((s, r) => s + (r.charges ?? 0), 0))}`,
  );
  console.log(
    `  reconciliation : ${svc.checks?.checked ?? 0} class totals, ` +
      `${svc.checks?.mismatched ?? 0} mismatched` +
      (svc.checks && !svc.checks.mismatched ? "  \u2713" : ""),
  );

  const vnp = result.visits_new_patients.rows;
  const vMonths = new Set(vnp.map((r) => r.period_month));
  console.log(`\nvisits/new pts   : ${vnp.length} class-months`);
  console.log(
    `  visits         : ${formatCount(vnp.filter((r) => r.metric === "visits"))}`,
  );
  console.log(
    `  new patients   : ${formatCount(vnp.filter((r) => r.metric === "new_patients"))}`,
  );
  console.log(`  months covered : ${vMonths.size}`);

  const ref = result.referrals_monthly.rows;
  console.log(`\nreferrals        : ${ref.length} referring providers`);
  console.log(
    `  new patients MTD: ${ref.reduce((s, r) => s + (r.new_patients_mtd ?? 0), 0).toLocaleString("en-US")}`,
  );
  console.log(
    `  visits MTD      : ${ref.reduce((s, r) => s + (r.visits_mtd ?? 0), 0).toLocaleString("en-US")}`,
  );
  console.log(
    `  with contact    : ${ref.filter((r) => r.phone || r.email).length}`,
  );

  // This one is NOT expected to match: the carrier report covers balances
  // assigned to a carrier, while the AR summary covers everything.
  console.log(
    `\nfor information  : AR summary ${money(arTotal)} vs carrier detail ` +
      `${money(carrierTotal)} — difference ${money(arTotal - carrierTotal)}`,
  );
  console.log();
}

const formatCount = (rows) =>
  rows.reduce((s, r) => s + (r.value ?? 0), 0).toLocaleString("en-US");

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
