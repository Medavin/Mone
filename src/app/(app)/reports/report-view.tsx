"use client";

import { useState } from "react";

import { formatCurrency, formatMonth, formatNumber } from "@/lib/format";
import type { ParsedReport } from "@/lib/report/parse.mjs";

import { parseUploadedReport } from "./actions";

const sum = <T,>(rows: T[], pick: (row: T) => number | null | undefined) =>
  rows.reduce((total, row) => total + (pick(row) ?? 0), 0);

export function ReportView() {
  const [report, setReport] = useState<ParsedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await parseUploadedReport(formData);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      setReport(null);
      return;
    }
    setReport(result.report);
  }

  return (
    <>
      <form action={onSubmit} className="card stack inline-form">
        <label className="field">
          <span>Monthly report workbook (.xlsx)</span>
          <input type="file" name="report" accept=".xlsx" required />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={pending}>
            {pending ? "Reading…" : "Read report"}
          </button>
        </div>
        <p className="muted footnote">
          Read on the server and shown here. Nothing is stored and nothing is
          written to the database.
        </p>
      </form>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {report ? <Parsed report={report} /> : null}
    </>
  );
}

function Parsed({ report }: { report: ParsedReport }) {
  const ar = report.ar_monthly.rows;
  const activity = report.activity_monthly.rows;
  const service = report.service_monthly.rows;
  const referrals = report.referrals_monthly.rows;
  const claims = report.carrier_ar.claims;
  const visits = report.visits_new_patients.rows;

  const arTotal = sum(ar, (r) => r.closing_ar);
  const ar120 = sum(ar, (r) => r.bucket_120_plus);
  const grand = report.activity_monthly.grandTotal;
  const claims120 = claims.filter((c) => c.bucket_120_plus > 0);
  const checks = report.carrier_ar.checks;
  const reconciled =
    (checks.providerMismatch ?? 0) === 0 && (checks.carrierMismatch ?? 0) === 0;

  // Two sheets state the same charges independently, so disagreement means one
  // of them was read wrong.
  const serviceCharges = sum(service, (r) => r.charges);
  const chargesAgree =
    grand?.charges != null &&
    Math.abs(serviceCharges - grand.charges) < 1;

  return (
    <>
      <header className="page-header">
        <div>
          <h2 className="tight">{report.clinic_name}</h2>
          <p className="muted">
            {report.period_month ? formatMonth(report.period_month) : "period unknown"}
            {" · "}
            {report.sheets_present.length} sheets · {report.source_file}
          </p>
        </div>
      </header>

      <div className="stats">
        <div className="stat stat--lead">
          <span className="stat-label">Total AR</span>
          <span className="stat-value">{formatCurrency(arTotal)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">120+ days</span>
          <span className="stat-value">{formatCurrency(ar120)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Charges</span>
          <span className="stat-value">{formatCurrency(grand?.charges)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Payments</span>
          <span className="stat-value">{formatCurrency(grand?.payments)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Adjustments</span>
          <span className="stat-value">{formatCurrency(grand?.adjustments)}</span>
        </div>
      </div>

      <div className="checks">
        <span className={reconciled ? "check ok" : "check bad"}>
          {reconciled ? "✓" : "✗"} Carrier detail reconciles —{" "}
          {checks.providers ?? 0} provider and {checks.carriers ?? 0} carrier
          blocks, {(checks.providerMismatch ?? 0) + (checks.carrierMismatch ?? 0)}{" "}
          mismatched
        </span>
        <span className={chargesAgree ? "check ok" : "check bad"}>
          {chargesAgree ? "✓" : "✗"} Service charges match financial activity —{" "}
          {formatCurrency(serviceCharges)} vs {formatCurrency(grand?.charges)}
        </span>
        <span className={report.service_monthly.checks?.mismatched ? "check bad" : "check ok"}>
          {report.service_monthly.checks?.mismatched ? "✗" : "✓"} Service class
          totals — {report.service_monthly.checks?.checked ?? 0} checked,{" "}
          {report.service_monthly.checks?.mismatched ?? 0} mismatched
        </span>
      </div>

      <section>
        <h2>AR by financial class</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Class</th>
                <th className="num">Current</th>
                <th className="num">30</th>
                <th className="num">60</th>
                <th className="num">90</th>
                <th className="num">120+</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {ar.map((row) => (
                <tr key={row.financial_class_code}>
                  <td>
                    {row.financial_class_code}
                    <span className="muted sub">{row.financial_class_name}</span>
                  </td>
                  <td className="num">{formatCurrency(row.bucket_current)}</td>
                  <td className="num">{formatCurrency(row.bucket_30)}</td>
                  <td className="num">{formatCurrency(row.bucket_60)}</td>
                  <td className="num">{formatCurrency(row.bucket_90)}</td>
                  <td className="num">{formatCurrency(row.bucket_120_plus)}</td>
                  <td className="num">{formatCurrency(row.closing_ar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="columns">
        <section>
          <h2>Activity</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th className="num">Units</th>
                  <th className="num">Charges</th>
                  <th className="num">Payments</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((row) => (
                  <tr key={row.financial_class_code}>
                    <td>{row.financial_class_code}</td>
                    <td className="num">{formatNumber(row.units)}</td>
                    <td className="num">{formatCurrency(row.charges)}</td>
                    <td className="num">{formatCurrency(row.payments)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Account detail</h2>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Claims</span>
              <span className="stat-value">{formatNumber(claims.length)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Charts</span>
              <span className="stat-value">
                {formatNumber(new Set(claims.map((c) => c.chart)).size)}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Claims 120+</span>
              <span className="stat-value">{formatNumber(claims120.length)}</span>
              <span className="muted sub">
                {formatCurrency(sum(claims120, (c) => c.bucket_120_plus))}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">CPT lines</span>
              <span className="stat-value">
                {formatNumber(report.carrier_ar.cptLines)}
              </span>
            </div>
          </div>
        </section>
      </div>

      <div className="columns">
        <section>
          <h2>Top procedures</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th className="num">Units</th>
                  <th className="num">Charges</th>
                </tr>
              </thead>
              <tbody>
                {[...service]
                  .sort((a, b) => (b.charges ?? 0) - (a.charges ?? 0))
                  .slice(0, 10)
                  .map((row, i) => (
                    <tr key={`${row.procedure_code}-${i}`}>
                      <td>{row.procedure_code}</td>
                      <td className="muted detail-cell">{row.description}</td>
                      <td className="num">{formatNumber(row.units)}</td>
                      <td className="num">{formatCurrency(row.charges)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Top referrers</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th className="num">New pts</th>
                  <th className="num">Visits</th>
                </tr>
              </thead>
              <tbody>
                {[...referrals]
                  .sort((a, b) => (b.new_patients_mtd ?? 0) - (a.new_patients_mtd ?? 0))
                  .slice(0, 10)
                  .map((row, i) => (
                    <tr key={`${row.name}-${i}`}>
                      <td>
                        {row.name}
                        {row.city ? (
                          <span className="muted sub">
                            {row.city}
                            {row.state ? `, ${row.state}` : ""}
                          </span>
                        ) : null}
                      </td>
                      <td className="num">{formatNumber(row.new_patients_mtd)}</td>
                      <td className="num">{formatNumber(row.visits_mtd)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="muted footnote">
            {referrals.length} referring providers ·{" "}
            {sum(referrals, (r) => r.new_patients_mtd)} new patients this month ·{" "}
            {visits.length} class-months of visit history
          </p>
        </section>
      </div>
    </>
  );
}
