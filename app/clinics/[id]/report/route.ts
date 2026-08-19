import { loadClinicMonth } from "@/lib/clinicMonth";
import { buildInsights, headlineSentence } from "@/lib/insights";

/**
 * Produces the client-meeting report as ONE self-contained HTML file.
 *
 * No external stylesheet, no script tag pointing anywhere, no font download —
 * it has to open correctly on a laptop with no network, from an email
 * attachment, years from now. The only script is a few lines of tab switching.
 */

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pct = (part: number, whole: number) =>
  whole === 0 ? "—" : `${((part / whole) * 100).toFixed(1)}%`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const monthName = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

function lineChart(
  months: string[],
  series: { label: string; color: string; values: number[] }[],
  height = 220
): string {
  const W = 900;
  const padL = 70;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;

  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / mag) * mag;

  const x = (i: number) => padL + (months.length <= 1 ? innerW / 2 : (i / (months.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / top) * innerH;

  const short = (v: number) =>
    v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (f) =>
        `<line x1="${padL}" x2="${W - padR}" y1="${y(top * f)}" y2="${y(top * f)}" stroke="#e1e6e9"/>` +
        `<text x="${padL - 8}" y="${y(top * f) + 4}" text-anchor="end" font-size="11" fill="#5b6770" font-family="monospace">${short(
          top * f
        )}</text>`
    )
    .join("");

  const years: string[] = [];
  const yearLabels = months
    .map((m, i) => {
      const yr = m.slice(0, 4);
      if (years.includes(yr)) return "";
      years.push(yr);
      return `<text x="${x(i)}" y="${height - 8}" text-anchor="middle" font-size="11" fill="#5b6770" font-family="monospace">${yr}</text>`;
    })
    .join("");

  const lines = series
    .map(
      (s) =>
        `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" points="${s.values
          .map((v, i) => `${x(i)},${y(v)}`)
          .join(" ")}"/>`
    )
    .join("");

  const legend = series
    .map(
      (s) =>
        `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:12px">
           <span style="display:inline-block;width:16px;height:2px;background:${s.color}"></span>${esc(s.label)}
         </span>`
    )
    .join("");

  return `<div>${legend}<svg viewBox="0 0 ${W} ${height}" style="width:100%;height:auto">${grid}${yearLabels}${lines}</svg></div>`;
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const url = new URL(request.url);
  const wanted = url.searchParams.get("month") ?? undefined;

  const data = await loadClinicMonth(Number(params.id), wanted);
  if (!data) return new Response("Clinic not found", { status: 404 });
  if (!data.month || !data.facts) return new Response("No month imported for this clinic", { status: 404 });

  const { clinic, summaryRow, month, facts, classes, ar, activity, split, carriers, services, referrals, history } = data;

  const averagePatientBalance =
    ((summaryRow ?? {}) as Record<string, number | null>).average_patient_balance ?? null;

  const insights = buildInsights(facts);
  const headline = headlineSentence(facts, clinic.name);

  const totalAr = ar.reduce((a, r) => a + (r.closing_ar ?? 0), 0);
  const total120 = ar.reduce((a, r) => a + (r.bucket_120_plus ?? 0), 0);
  const totalCharges = activity.reduce((a, r) => a + (r.charges ?? 0), 0);
  const totalPayments = activity.reduce((a, r) => a + (r.payments ?? 0), 0);
  const totalAdjust = activity.reduce((a, r) => a + (r.adjustments ?? 0), 0);
  const totalUnits = activity.reduce((a, r) => a + (r.units ?? 0), 0);

  const actById = new Map(activity.map((a) => [a.financial_class_id, a]));
  const ranked = [...ar].sort((a, b) => (b.closing_ar ?? 0) - (a.closing_ar ?? 0));

  const last12 = history.slice(-12);
  const carrierGrand = carriers.reduce((a, c) => a + (c.row.total_ar ?? 0), 0);

  const toneColour: Record<string, string> = {
    good: "#2f6b4f",
    watch: "#b4761a",
    bad: "#a33a3f",
    neutral: "#5b6770",
  };

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(clinic.name)} — ${monthName(month)}</title>
<style>
  :root { --ink:#0d1215; --muted:#5b6770; --line:#e1e6e9; --canvas:#f7f8f9; --accent:#12586b;
          --bad:#a33a3f; --warn:#b4761a; --good:#2f6b4f; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--canvas); color:var(--ink);
         font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
         -webkit-font-smoothing:antialiased }
  .wrap { max-width:1000px; margin:0 auto; padding:40px 24px 80px }
  h1 { font-size:28px; margin:0; letter-spacing:-.02em }
  h2 { font:600 11px/1 monospace; text-transform:uppercase; letter-spacing:.1em;
       color:var(--muted); margin:40px 0 12px }
  .sub { color:var(--muted); margin:6px 0 0 }
  .lede { font-size:17px; line-height:1.45; margin:24px 0 0; padding:20px;
          background:#fff; border:1px solid var(--line); border-radius:4px }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px }
  .card { background:#fff; border:1px solid var(--line); border-radius:4px; padding:14px }
  .card .k { font:600 11px/1 monospace; text-transform:uppercase; letter-spacing:.08em; color:var(--muted) }
  .card .v { font-size:20px; margin-top:6px; font-variant-numeric:tabular-nums }
  table { width:100%; border-collapse:collapse; font-size:14px; background:#fff }
  th { font:600 11px/1 monospace; text-transform:uppercase; letter-spacing:.08em; color:var(--muted);
       text-align:right; padding:10px 8px; border-bottom:1px solid var(--line) }
  th:first-child { text-align:left }
  td { padding:9px 8px; border-bottom:1px solid #eef1f3; text-align:right;
       font-variant-numeric:tabular-nums }
  td:first-child { text-align:left; font-variant-numeric:normal }
  tr.total td { border-top:2px solid var(--line); border-bottom:none; font-weight:600 }
  .bad { color:var(--bad) } .warn { color:var(--warn) } .good { color:var(--good) }
  .muted { color:var(--muted) }
  .note { font-size:12px; color:var(--muted); margin-top:8px }
  .ins { background:#fff; border:1px solid var(--line); border-left:3px solid var(--muted);
         border-radius:3px; padding:14px 16px; margin-bottom:10px }
  .ins .h { font-weight:600 }
  .ins .d { color:var(--muted); font-size:14px; margin-top:4px }
  nav { display:flex; flex-wrap:wrap; gap:2px; border-bottom:1px solid var(--line); margin-top:28px }
  nav button { background:none; border:none; border-bottom:2px solid transparent; cursor:pointer;
               font:inherit; font-size:14px; color:var(--muted); padding:9px 14px; margin-bottom:-1px }
  nav button[aria-selected="true"] { color:var(--ink); font-weight:600; border-bottom-color:var(--accent) }
  section[hidden] { display:none }
  .chart { background:#fff; border:1px solid var(--line); border-radius:4px; padding:16px; margin-top:12px }
  footer { margin-top:60px; padding-top:16px; border-top:1px solid var(--line);
           font-size:12px; color:var(--muted) }
  @media print {
    body { background:#fff } nav { display:none } section[hidden] { display:block !important }
    h2 { page-break-after:avoid } table { page-break-inside:avoid }
  }
</style>
</head><body><div class="wrap">

<h1>${esc(clinic.name)}</h1>
<p class="sub">${monthName(month)} · accounts receivable review</p>

<p class="lede">${esc(headline)}</p>

<h2>What this month says</h2>
${insights
  .map(
    (i) => `<div class="ins" style="border-left-color:${toneColour[i.tone]}">
      <div class="h">${esc(i.headline)}</div>
      ${i.detail ? `<div class="d">${esc(i.detail)}</div>` : ""}
    </div>`
  )
  .join("")}

<nav role="tablist">
  ${["Summary", "A/R", "Activity", "Carriers", "Services", "Referrals", "History"]
    .map(
      (t, i) =>
        `<button role="tab" aria-selected="${i === 0}" data-tab="${i}" onclick="pick(${i})">${t}</button>`
    )
    .join("")}
</nav>

<section data-panel="0">
  <h2>Change in A/R</h2>
  <div class="cards">
    <div class="card"><div class="k">Beginning</div><div class="v">${money(facts.openingAr)}</div></div>
    <div class="card"><div class="k">Increase / (decrease)</div>
      <div class="v ${(facts.arChange ?? 0) > 0 ? "bad" : "good"}">${
        (facts.arChange ?? 0) > 0 ? "+" : ""
      }${money(facts.arChange)}</div></div>
    <div class="card"><div class="k">Ending</div><div class="v">${money(facts.closingAr)}</div></div>
  </div>

  <h2>Transaction summary</h2>
  <table><tbody>
    <tr><td>Charges</td><td>${money(facts.charges)}</td></tr>
    <tr><td>Adjustments</td><td>${money(facts.adjustments)}</td></tr>
    <tr><td>Patient payments</td><td>${money(facts.paymentsPatient)}</td></tr>
    <tr><td>Insurance payments</td><td>${money(facts.paymentsInsurance)}</td></tr>
    <tr class="total"><td>Total payments</td><td>${money(
      (facts.paymentsPatient ?? 0) + (facts.paymentsInsurance ?? 0)
    )}</td></tr>
  </tbody></table>

  <h2>Patient balances</h2>
  <div class="cards">
    <div class="card"><div class="k">Patients with a balance</div>
      <div class="v">${facts.patientsWithBalance?.toLocaleString() ?? "—"}</div></div>
    <div class="card"><div class="k">Average balance</div>
      <div class="v">${money(averagePatientBalance)}</div></div>
  </div>

  ${
    split.length
      ? `<h2>Current A/R — insurance and patient</h2>
  <table><thead><tr><th></th>
    ${["Current", "Over 30", "Over 60", "Over 90", "Over 120", "Total", "Unapplied", "Net"]
      .map((h) => `<th>${h}</th>`)
      .join("")}
  </tr></thead><tbody>
  ${split
    .map(
      (s) => `<tr><td style="text-transform:capitalize">${esc(String(s.payer_type))}</td>
      <td>${money(s.bucket_current as number)}</td>
      <td>${money(s.bucket_30 as number)}</td>
      <td>${money(s.bucket_60 as number)}</td>
      <td>${money(s.bucket_90 as number)}</td>
      <td class="bad">${money(s.bucket_120_plus as number)}</td>
      <td>${money(s.total_ar as number)}</td>
      <td class="muted">${money(s.unapplied as number)}</td>
      <td><strong>${money(s.net_ar as number)}</strong></td></tr>`
    )
    .join("")}
  </tbody></table>
  <p class="note">Unapplied is money received but not yet posted to a claim, which is why total and net differ.</p>`
      : ""
  }

  ${
    last12.length > 1
      ? `<h2>Monthly activity — last 12 months</h2><div class="chart">${lineChart(
          last12.map((h) => h.month),
          [
            { label: "Charges", color: "#12586b", values: last12.map((h) => h.charges) },
            { label: "Payments", color: "#2f6b4f", values: last12.map((h) => h.payments) },
            { label: "Adjustments", color: "#b4761a", values: last12.map((h) => Math.abs(h.adjustments)) },
          ]
        )}</div>`
      : ""
  }
</section>

<section data-panel="1" hidden>
  <h2>A/R aging by financial class</h2>
  <table><thead><tr><th>Class</th>
    ${["Current", "30", "60", "90", "120+", "Total", "Share"].map((h) => `<th>${h}</th>`).join("")}
  </tr></thead><tbody>
  ${ranked
    .map((r) => {
      const c = classes.get(r.financial_class_id);
      const stale = (r.closing_ar ?? 0) > 0 && (r.bucket_120_plus ?? 0) / (r.closing_ar ?? 1) > 0.8;
      return `<tr><td><span class="muted" style="font-family:monospace;font-size:12px">${esc(
        c?.code ?? ""
      )}</span> ${esc(c?.name ?? "")}</td>
        <td>${money(r.bucket_current)}</td><td>${money(r.bucket_30)}</td>
        <td>${money(r.bucket_60)}</td><td>${money(r.bucket_90)}</td>
        <td class="${stale ? "bad" : ""}">${money(r.bucket_120_plus)}</td>
        <td><strong>${money(r.closing_ar)}</strong></td>
        <td class="muted">${pct(r.closing_ar ?? 0, totalAr)}</td></tr>`;
    })
    .join("")}
    <tr class="total"><td>Grand total</td><td colspan="4"></td>
      <td class="bad">${money(total120)}</td><td>${money(totalAr)}</td><td>100%</td></tr>
  </tbody></table>
</section>

<section data-panel="2" hidden>
  <h2>Financial activity by class</h2>
  <div class="cards">
    <div class="card"><div class="k">Units</div><div class="v">${totalUnits.toLocaleString()}</div></div>
    <div class="card"><div class="k">Charges</div><div class="v">${money(totalCharges)}</div></div>
    <div class="card"><div class="k">Payments</div><div class="v">${money(totalPayments)}</div></div>
    <div class="card"><div class="k">Adjustments</div><div class="v">${money(totalAdjust)}</div></div>
  </div>
  <table style="margin-top:16px"><thead><tr><th>Class</th>
    ${["Units", "Charges", "Charge mix", "Payments", "Payment mix", "Adjustments"]
      .map((h) => `<th>${h}</th>`)
      .join("")}
  </tr></thead><tbody>
  ${ranked
    .map((r) => {
      const a = actById.get(r.financial_class_id);
      const c = classes.get(r.financial_class_id);
      if (!a) return "";
      return `<tr><td><span class="muted" style="font-family:monospace;font-size:12px">${esc(
        c?.code ?? ""
      )}</span> ${esc(c?.name ?? "")}</td>
        <td>${(a.units ?? 0).toLocaleString()}</td><td>${money(a.charges)}</td>
        <td class="muted">${pct(a.charges ?? 0, totalCharges)}</td>
        <td>${money(a.payments)}</td>
        <td class="muted">${pct(a.payments ?? 0, totalPayments)}</td>
        <td>${money(a.adjustments)}</td></tr>`;
    })
    .join("")}
  </tbody></table>
</section>

<section data-panel="3" hidden>
  <h2>Insurance A/R by carrier</h2>
  <p class="note">${carriers.length} carriers, ${money(
    carrierGrand
  )} outstanding. Patient balances are not attributed to a carrier.</p>
  <table><thead><tr><th>Carrier</th>
    ${["Current", "30", "60", "90", "120+", "Total", "Share"].map((h) => `<th>${h}</th>`).join("")}
  </tr></thead><tbody>
  ${carriers
    .slice(0, 40)
    .map(({ name, row }) => {
      const stale = (row.total_ar ?? 0) > 0 && (row.bucket_120_plus ?? 0) / (row.total_ar ?? 1) > 0.8;
      return `<tr><td>${esc(name)}</td>
        <td>${money(row.bucket_current)}</td><td>${money(row.bucket_30)}</td>
        <td>${money(row.bucket_60)}</td><td>${money(row.bucket_90)}</td>
        <td class="${stale ? "bad" : ""}">${money(row.bucket_120_plus)}</td>
        <td><strong>${money(row.total_ar)}</strong></td>
        <td class="muted">${pct(row.total_ar ?? 0, carrierGrand)}</td></tr>`;
    })
    .join("")}
  </tbody></table>
</section>

<section data-panel="4" hidden>
  <h2>What was billed</h2>
  <table><thead><tr><th>Procedure</th><th>Units</th><th>Charges</th><th>Share</th></tr></thead><tbody>
  ${services
    .slice(0, 40)
    .map(
      (s) => `<tr><td><span class="muted" style="font-family:monospace;font-size:12px">${esc(
        s.code
      )}</span> ${esc(s.desc)}</td>
      <td>${s.units.toLocaleString()}</td><td><strong>${money(s.charges)}</strong></td>
      <td class="muted">${pct(s.charges, services.reduce((a, x) => a + x.charges, 0))}</td></tr>`
    )
    .join("")}
  </tbody></table>
</section>

<section data-panel="5" hidden>
  <h2>Where the patients come from</h2>
  <table><thead><tr><th>Referring provider</th><th style="text-align:left">City</th>
    <th>New patients</th><th>Visits</th><th>Visits YTD</th><th>YTD charges</th></tr></thead><tbody>
  ${referrals
    .map(
      ({ name, city, row }) => `<tr><td>${esc(name)}</td>
      <td style="text-align:left" class="muted">${esc(city || "—")}</td>
      <td>${row.new_patients_mtd ?? "—"}</td>
      <td><strong>${row.visits_mtd ?? "—"}</strong></td>
      <td>${row.visits_ytd ?? "—"}</td>
      <td>${money(row.ytd_charges)}</td></tr>`
    )
    .join("")}
  </tbody></table>
</section>

<section data-panel="6" hidden>
  <h2>Charges and collections over time</h2>
  <div class="chart">${lineChart(
    history.map((h) => h.month),
    [
      { label: "Charges", color: "#12586b", values: history.map((h) => h.charges) },
      { label: "Payments", color: "#2f6b4f", values: history.map((h) => h.payments) },
    ],
    240
  )}</div>
  <h2>Visits and new patients</h2>
  <div class="chart">${lineChart(
    history.map((h) => h.month),
    [
      { label: "Visits", color: "#2f6b4f", values: history.map((h) => h.visits) },
      { label: "New patients", color: "#b4761a", values: history.map((h) => h.newPatients) },
    ],
    200
  )}</div>
  <p class="note">${history.length} months held, ${history[0]?.month} to ${
    history[history.length - 1]?.month
  }.</p>
</section>

<footer>
  Generated from MOne on ${new Date().toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })}. Figures are as reported by AdvancedMD for ${monthName(month)}.
</footer>

</div>
<script>
  function pick(n) {
    document.querySelectorAll('[role=tab]').forEach(function (b) {
      b.setAttribute('aria-selected', String(Number(b.dataset.tab) === n));
    });
    document.querySelectorAll('[data-panel]').forEach(function (s) {
      if (Number(s.dataset.panel) === n) { s.removeAttribute('hidden'); } else { s.setAttribute('hidden', ''); }
    });
  }
</script>
</body></html>`;

  const slug = clinic.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-${month}.html"`,
    },
  });
}
