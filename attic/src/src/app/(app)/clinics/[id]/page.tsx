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

import { ContactCard } from "./contact-card";

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

/** Percent change against the prior month, or null when there's no basis. */
function change(current: number | null, previous: number | null) {
  if (!previous || current === null) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
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
    .select(
      "id, name, code, status, go_live_date, notes, street, city, state, zip, phone, email, contact_name, contact_title",
    )
    .eq("id", clinicId)
    .maybeSingle();

  // maybeSingle returns null both for "missing" and "hidden by RLS", which is
  // the behaviour we want — don't confirm a clinic exists to someone who
  // isn't allowed to see it.
  if (!clinic) notFound();

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - HISTORY_MONTHS);
  const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-01`;

  const [
    { data: latestPeriod },
    { data: activity, error: activityError },
    { data: summary },
    { data: crl },
    { data: tasks },
    { data: projects },
    { data: cam },
  ] = await Promise.all([
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
    // Account-level counts and routing totals, aggregated by the view.
    supabase
      .from("account_summary_monthly")
      .select(
        "as_of_month, account_count, total_balance, accounts_120_plus, amount_120_plus, accounts_sent_to_cam, amount_sent_to_cam, accounts_sent_to_collector, amount_sent_to_collector",
      )
      .eq("clinic_id", clinicId)
      .order("as_of_month", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("crl_entries")
      .select("id, detail, status, requested_from, opened_at")
      .eq("clinic_id", clinicId)
      .neq("status", "closed")
      .order("opened_at", { ascending: true })
      .limit(8),
    supabase
      .from("tasks")
      .select(
        "id, title, status, due_date, assignee:profiles!tasks_assigned_to_fkey ( full_name )",
      )
      .eq("clinic_id", clinicId)
      .not("status", "in", "(done,cancelled)")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(8),
    supabase
      .from("projects")
      .select("id, name, status, progress_pct, amount, claim_count")
      .eq("clinic_id", clinicId)
      .not("status", "in", "(done,cancelled)")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("cam_assignments")
      .select("profiles ( full_name )")
      .eq("clinic_id", clinicId)
      .is("effective_to", null)
      .maybeSingle(),
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
  const current = months[0] ?? null;
  const previous = months[1] ?? null;
  const bucketTotal = (key: (typeof AR_BUCKETS)[number]["key"]) =>
    arRows.reduce((sum, row) => sum + (row[key] ?? 0), 0);
  const closingAr = arRows.reduce((sum, row) => sum + (row.closing_ar ?? 0), 0);
  const camName =
    (cam?.profiles as { full_name: string } | null)?.full_name ?? null;

  const MTD = [
    { label: "Charges", value: current?.charges, prior: previous?.charges, money: true },
    { label: "Payments", value: current?.payments, prior: previous?.payments, money: true },
    { label: "Adjustments", value: current?.adjustments, prior: previous?.adjustments, money: true },
    { label: "Visits", value: current?.visits, prior: previous?.visits, money: false },
    { label: "New patients", value: current?.new_patients, prior: previous?.new_patients, money: false },
  ];

  return (
    <main className="page page--wide">
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
            {camName ? ` · CAM ${camName}` : ""}
          </p>
        </div>
      </header>

      <ContactCard clinic={clinic} />

      {clinic.notes ? <p className="notes">{clinic.notes}</p> : null}

      <section>
        <h2>
          This month
          {current ? (
            <span className="muted as-of">
              {" "}
              {formatMonth(current.period_month)} vs prior month
            </span>
          ) : null}
        </h2>
        {!current ? (
          <p className="muted">No activity recorded for this clinic.</p>
        ) : (
          <div className="stats">
            {MTD.map((metric) => {
              const delta = change(metric.value ?? null, metric.prior ?? null);
              return (
                <div className="stat" key={metric.label}>
                  <span className="stat-label">{metric.label}</span>
                  <span className="stat-value">
                    {metric.money
                      ? formatCurrency(metric.value)
                      : formatNumber(metric.value)}
                  </span>
                  {delta !== null ? (
                    <span
                      className={`delta ${delta > 0 ? "delta--up" : delta < 0 ? "delta--down" : "delta--flat"}`}
                    >
                      {delta > 0 ? "▲" : delta < 0 ? "▼" : "±"}{" "}
                      {Math.abs(delta)}%
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

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
        <h2>
          Account workflow
          {summary?.as_of_month ? (
            <span className="muted as-of">
              {" "}
              as of {formatMonth(summary.as_of_month)}
            </span>
          ) : null}
        </h2>
        {!summary ? (
          <p className="muted">
            No account-level detail loaded. These figures come from the
            per-account AR import.
          </p>
        ) : (
          <div className="stats">
            <div className="stat stat--lead">
              <span className="stat-label">Claims in module</span>
              <span className="stat-value">
                {formatNumber(summary.account_count)}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">120+ days</span>
              <span className="stat-value">
                {formatNumber(summary.accounts_120_plus)}
              </span>
              <span className="muted sub">
                {formatCurrency(summary.amount_120_plus)}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Sent to CAM</span>
              <span className="stat-value">
                {formatNumber(summary.accounts_sent_to_cam)}
              </span>
              <span className="muted sub">
                {formatCurrency(summary.amount_sent_to_cam)}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Sent to collector</span>
              <span className="stat-value">
                {formatNumber(summary.accounts_sent_to_collector)}
              </span>
              <span className="muted sub">
                {formatCurrency(summary.amount_sent_to_collector)}
              </span>
            </div>
          </div>
        )}
      </section>

      <div className="columns">
        <section>
          <h2>
            Open CRL <Link href="/crl" className="see-all">view all</Link>
          </h2>
          {(crl ?? []).length === 0 ? (
            <p className="muted">Nothing outstanding.</p>
          ) : (
            <ul className="list">
              {(crl ?? []).map((entry) => (
                <li key={entry.id}>
                  <span className={`pill pill--${entry.status}`}>
                    {entry.status}
                  </span>
                  <span className="list-main">{entry.detail}</span>
                  <span className="muted sub">
                    from {entry.requested_from} · {formatDate(entry.opened_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>
            Open tasks <Link href="/tasks" className="see-all">view all</Link>
          </h2>
          {(tasks ?? []).length === 0 ? (
            <p className="muted">Nothing outstanding.</p>
          ) : (
            <ul className="list">
              {(tasks ?? []).map((task) => (
                <li key={task.id}>
                  <span className={`pill pill--${task.status}`}>
                    {task.status.replace("_", " ")}
                  </span>
                  <span className="list-main">{task.title}</span>
                  <span className="muted sub">
                    {(task.assignee as { full_name: string } | null)
                      ?.full_name ?? "unassigned"}
                    {task.due_date ? ` · due ${formatDate(task.due_date)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>
            Projects <Link href="/projects" className="see-all">view all</Link>
          </h2>
          {(projects ?? []).length === 0 ? (
            <p className="muted">None running.</p>
          ) : (
            <ul className="list">
              {(projects ?? []).map((project) => (
                <li key={project.id}>
                  <span className="list-main">
                    <Link href={`/projects/${project.id}`}>{project.name}</Link>
                  </span>
                  <div
                    className="meter"
                    role="progressbar"
                    aria-valuenow={project.progress_pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${project.progress_pct}%` }} />
                  </div>
                  <span className="muted sub">
                    {project.progress_pct}% ·{" "}
                    {formatCurrency(project.amount)} ·{" "}
                    {formatNumber(project.claim_count)} claims
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

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
