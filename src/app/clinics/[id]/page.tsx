import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  formatCurrency,
  formatDate,
  formatMonth,
  formatNumber,
  statusSlug,
} from "@/lib/format";

/** Months of history shown in the activity table. */
const HISTORY_MONTHS = 12;

const AR_BUCKETS = [
  { key: "bucket_current", label: "Current" },
  { key: "bucket_30", label: "30 days" },
  { key: "bucket_60", label: "60 days" },
  { key: "bucket_90", label: "90 days" },
  { key: "bucket_120_plus", label: "120+ days" },
] as const;

type ActivityRow = {
  period_month: string;
  charges: number | null;
  payments: number | null;
  adjustments: number | null;
  visits: number | null;
  new_patients: number | null;
};

/** Rows arrive split by financial class; the page shows clinic totals. */
function rollUpByMonth(rows: ActivityRow[]) {
  const months = new Map<string, Omit<ActivityRow, "period_month">>();

  for (const row of rows) {
    const total = months.get(row.period_month) ?? {
      charges: 0,
      payments: 0,
      adjustments: 0,
      visits: 0,
      new_patients: 0,
    };
    total.charges = (total.charges ?? 0) + (row.charges ?? 0);
    total.payments = (total.payments ?? 0) + (row.payments ?? 0);
    total.adjustments = (total.adjustments ?? 0) + (row.adjustments ?? 0);
    total.visits = (total.visits ?? 0) + (row.visits ?? 0);
    total.new_patients = (total.new_patients ?? 0) + (row.new_patients ?? 0);
    months.set(row.period_month, total);
  }

  return Array.from(months.entries())
    .map(([period_month, totals]) => ({ period_month, ...totals }))
    .sort((a, b) => b.period_month.localeCompare(a.period_month));
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data } = await supabase
    .from("clinics")
    .select("name")
    .eq("id", Number(params.id))
    .maybeSingle();
  return { title: data ? `${data.name} · MOne` : "Clinic · MOne" };
}

export default async function ClinicPage({
  params,
}: {
  params: { id: string };
}) {
  const clinicId = Number(params.id);
  if (!Number.isInteger(clinicId)) notFound();

  const supabase = createClient();

  const { data: clinic } = await supabase
    .from("clinics")
    .select("id, name, code, status, go_live_date, notes")
    .eq("id", clinicId)
    .maybeSingle();

  // maybeSingle returns null both for "missing" and "hidden by RLS", which is
  // the behaviour we want — don't confirm a clinic exists to someone who
  // isn't allowed to see it.
  if (!clinic) notFound();

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - HISTORY_MONTHS);
  const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-01`;

  const [{ data: latestPeriod }, { data: activity, error: activityError }] =
    await Promise.all([
      supabase
        .from("ar_monthly")
        .select("period_month")
        .eq("clinic_id", clinicId)
        .order("period_month", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("activity_monthly")
        .select(
          "period_month, charges, payments, adjustments, visits, new_patients",
        )
        .eq("clinic_id", clinicId)
        .gte("period_month", cutoffMonth),
    ]);

  const { data: ar } = latestPeriod
    ? await supabase
        .from("ar_monthly")
        .select(
          "closing_ar, bucket_current, bucket_30, bucket_60, bucket_90, bucket_120_plus, financial_classes ( name )",
        )
        .eq("clinic_id", clinicId)
        .eq("period_month", latestPeriod.period_month)
    : { data: null };

  const arRows = ar ?? [];
  const months = rollUpByMonth(activity ?? []);
  const bucketTotal = (key: (typeof AR_BUCKETS)[number]["key"]) =>
    arRows.reduce((sum, row) => sum + (row[key] ?? 0), 0);
  const closingAr = arRows.reduce((sum, row) => sum + (row.closing_ar ?? 0), 0);

  return (
    <main className="page">
      <p>
        <Link href="/clinics" className="back">
          ← All clinics
        </Link>
      </p>

      <header className="page-header">
        <div>
          <h1>{clinic.name}</h1>
          <p className="muted">
            {clinic.code ? `${clinic.code} · ` : ""}
            <span className={`pill pill--${statusSlug(clinic.status)}`}>
              {clinic.status}
            </span>
            {clinic.go_live_date
              ? ` · live since ${formatDate(clinic.go_live_date)}`
              : ""}
          </p>
        </div>
      </header>

      {clinic.notes ? <p className="notes">{clinic.notes}</p> : null}

      <section>
        <h2>
          Accounts receivable
          {latestPeriod ? (
            <span className="muted as-of">
              {" "}
              as of {formatMonth(latestPeriod.period_month)}
            </span>
          ) : null}
        </h2>

        {arRows.length === 0 ? (
          <p className="muted">No AR data recorded for this clinic yet.</p>
        ) : (
          <>
            <div className="stats">
              <div className="stat stat--lead">
                <span className="stat-label">Total AR</span>
                <span className="stat-value">{formatCurrency(closingAr)}</span>
              </div>
              {AR_BUCKETS.map((bucket) => (
                <div className="stat" key={bucket.key}>
                  <span className="stat-label">{bucket.label}</span>
                  <span className="stat-value">
                    {formatCurrency(bucketTotal(bucket.key))}
                  </span>
                </div>
              ))}
            </div>
            <p className="muted footnote">
              Totalled across {arRows.length} financial class
              {arRows.length === 1 ? "" : "es"}.
            </p>
          </>
        )}
      </section>

      <section>
        <h2>Monthly activity</h2>

        {activityError ? (
          <p className="error" role="alert">
            Could not load activity: {activityError.message}
          </p>
        ) : months.length === 0 ? (
          <p className="muted">
            No activity recorded in the last {HISTORY_MONTHS} months.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Charges</th>
                  <th className="num">Payments</th>
                  <th className="num">Adjustments</th>
                  <th className="num">Visits</th>
                  <th className="num">New patients</th>
                </tr>
              </thead>
              <tbody>
                {months.map((month) => (
                  <tr key={month.period_month}>
                    <td>{formatMonth(month.period_month)}</td>
                    <td className="num">{formatCurrency(month.charges)}</td>
                    <td className="num">{formatCurrency(month.payments)}</td>
                    <td className="num">{formatCurrency(month.adjustments)}</td>
                    <td className="num">{formatNumber(month.visits)}</td>
                    <td className="num">{formatNumber(month.new_patients)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
