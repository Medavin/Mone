import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import {
  formatCurrency,
  formatMonth,
  formatNumber,
  statusSlug,
} from "@/lib/format";

import { signOut } from "./actions";
import { Delta } from "./delta";

export const metadata = { title: "Clinics · MOne" };

/**
 * Row caps. PostgREST applies its own default (commonly 1000), which would
 * silently truncate and quietly under-report totals, so ask for an explicit
 * limit and tell the reader when we hit it. Rows come back newest-first, so a
 * truncated fetch still yields each clinic's most recent months.
 */
const AR_ROW_CAP = 5000;
const ACTIVITY_ROW_CAP = 20000;

type Metrics = {
  charges: number;
  payments: number;
  adjustments: number;
  visits: number;
  new_patients: number;
};

function emptyMetrics(): Metrics {
  return {
    charges: 0,
    payments: 0,
    adjustments: 0,
    visits: 0,
    new_patients: 0,
  };
}

export default async function ClinicsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [clinicsResult, arResult, activityResult, camResult] =
    await Promise.all([
      supabase
        .from("clinics")
        .select("id, name, code, status")
        .order("name", { ascending: true }),
      // Pre-aggregated view: AR already totalled across financial classes.
      // No date floor — a clinic whose last import is old should still show
      // its most recent figures rather than reading as having none.
      supabase
        .from("ar_monthly_clinic_total")
        .select("clinic_id, period_month, closing_ar, bucket_120_plus")
        .order("period_month", { ascending: false })
        .limit(AR_ROW_CAP),
      supabase
        .from("activity_monthly")
        .select(
          "clinic_id, period_month, charges, payments, adjustments, visits, new_patients",
        )
        .order("period_month", { ascending: false })
        .limit(ACTIVITY_ROW_CAP),
      // Open assignment only — effective_to is null while a CAM still owns it.
      supabase
        .from("cam_assignments")
        .select("clinic_id, profiles ( full_name )")
        .is("effective_to", null),
    ]);

  const clinics = clinicsResult.data ?? [];
  const error =
    clinicsResult.error ?? arResult.error ?? activityResult.error ?? null;

  const arRowCount = arResult.data?.length ?? 0;
  const activityRowCount = activityResult.data?.length ?? 0;
  const truncated =
    arRowCount >= AR_ROW_CAP || activityRowCount >= ACTIVITY_ROW_CAP;

  /** clinic_id -> CAM name */
  const camByClinic = new Map<number, string>();
  for (const row of camResult.data ?? []) {
    const profile = row.profiles as { full_name: string } | null;
    if (row.clinic_id != null && profile?.full_name) {
      camByClinic.set(row.clinic_id, profile.full_name);
    }
  }

  /** clinic_id -> latest AR row seen */
  const arByClinic = new Map<
    number,
    { period_month: string; closing_ar: number; bucket_120_plus: number }
  >();
  for (const row of arResult.data ?? []) {
    if (row.clinic_id == null || row.period_month == null) continue;
    const current = arByClinic.get(row.clinic_id);
    if (!current || row.period_month > current.period_month) {
      arByClinic.set(row.clinic_id, {
        period_month: row.period_month,
        closing_ar: row.closing_ar ?? 0,
        bucket_120_plus: row.bucket_120_plus ?? 0,
      });
    }
  }

  /** clinic_id -> month -> summed metrics (rows arrive split by financial class) */
  const activityByClinic = new Map<number, Map<string, Metrics>>();
  for (const row of activityResult.data ?? []) {
    const months =
      activityByClinic.get(row.clinic_id) ?? new Map<string, Metrics>();
    const total = months.get(row.period_month) ?? emptyMetrics();
    total.charges += row.charges ?? 0;
    total.payments += row.payments ?? 0;
    total.adjustments += row.adjustments ?? 0;
    total.visits += row.visits ?? 0;
    total.new_patients += row.new_patients ?? 0;
    months.set(row.period_month, total);
    activityByClinic.set(row.clinic_id, months);
  }

  /**
   * Latest month and the one before it. `current` is null when the clinic has
   * no activity at all — rendering that as $0 would claim a real zero, which
   * is a different thing from having no data.
   */
  function recentMonths(clinicId: number) {
    const months = activityByClinic.get(clinicId);
    const ordered = months
      ? Array.from(months.keys()).sort((a, b) => b.localeCompare(a))
      : [];
    return {
      period: ordered[0] ?? null,
      current: ordered[0] ? (months?.get(ordered[0]) ?? null) : null,
      previous: ordered[1] ? (months?.get(ordered[1]) ?? null) : null,
    };
  }

  const totalAr = Array.from(arByClinic.values()).reduce(
    (sum, row) => sum + row.closing_ar,
    0,
  );
  const total120 = Array.from(arByClinic.values()).reduce(
    (sum, row) => sum + row.bucket_120_plus,
    0,
  );

  return (
    <main className="page page--wide">
      <header className="page-header">
        <div>
          <h1>Clinic dashboard</h1>
          <p className="muted">{user?.email ?? ""}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </header>

      {error ? (
        <p className="error" role="alert">
          Could not load dashboard: {error.message}
        </p>
      ) : clinics.length === 0 ? (
        <p className="muted">
          No clinics visible. Either the table is empty or the row-level
          security policies don&rsquo;t grant this user access.
        </p>
      ) : (
        <>
          <div className="stats">
            <div className="stat stat--lead">
              <span className="stat-label">Clinics</span>
              <span className="stat-value">{formatNumber(clinics.length)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Total AR</span>
              <span className="stat-value">{formatCurrency(totalAr)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">120+ days</span>
              <span className="stat-value">{formatCurrency(total120)}</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Clinic</th>
                  <th>CAM</th>
                  <th>Status</th>
                  <th>Period</th>
                  <th className="num">Total AR</th>
                  <th className="num">120+</th>
                  <th className="num">Charges</th>
                  <th className="num">Payments</th>
                  <th className="num">Adjustments</th>
                  <th className="num">Visits</th>
                  <th className="num">New patients</th>
                </tr>
              </thead>
              <tbody>
                {clinics.map((clinic) => {
                  const ar = arByClinic.get(clinic.id);
                  const { period, current, previous } = recentMonths(clinic.id);
                  return (
                    <tr key={clinic.id}>
                      <td>
                        <Link href={`/clinics/${clinic.id}`}>
                          {clinic.name}
                        </Link>
                        {clinic.code ? (
                          <span className="muted code"> {clinic.code}</span>
                        ) : null}
                      </td>
                      <td className="muted">
                        {camByClinic.get(clinic.id) ?? "—"}
                      </td>
                      <td>
                        <span className={`pill pill--${statusSlug(clinic.status)}`}>
                          {clinic.status}
                        </span>
                      </td>
                      <td className="muted">{formatMonth(period)}</td>
                      <td className="num">{formatCurrency(ar?.closing_ar)}</td>
                      <td className="num">
                        {formatCurrency(ar?.bucket_120_plus)}
                      </td>
                      <td className="num">
                        {formatCurrency(current?.charges)}
                        <Delta
                          current={current?.charges}
                          previous={previous?.charges}
                        />
                      </td>
                      <td className="num">
                        {formatCurrency(current?.payments)}
                        <Delta
                          current={current?.payments}
                          previous={previous?.payments}
                        />
                      </td>
                      <td className="num">
                        {formatCurrency(current?.adjustments)}
                      </td>
                      <td className="num">
                        {formatNumber(current?.visits)}
                        <Delta
                          current={current?.visits}
                          previous={previous?.visits}
                        />
                      </td>
                      <td className="num">
                        {formatNumber(current?.new_patients)}
                        <Delta
                          current={current?.new_patients}
                          previous={previous?.new_patients}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {arRowCount === 0 && activityRowCount === 0 ? (
            <p className="notes">
              Clinics loaded, but no AR or activity rows were returned. Either
              the monthly imports haven&rsquo;t run yet, or this account&rsquo;s
              row-level security policies don&rsquo;t cover those tables.
            </p>
          ) : null}

          {truncated ? (
            <p className="error" role="alert">
              Hit the {formatNumber(AR_ROW_CAP)}/
              {formatNumber(ACTIVITY_ROW_CAP)} row cap — figures may be
              incomplete. Move this aggregation into a database view.
            </p>
          ) : null}

          <p className="muted footnote">
            Figures are monthly — the database has no daily grain. &ldquo;Period&rdquo;
            is each clinic&rsquo;s most recent month of activity; arrows compare it
            with the month before.
          </p>
        </>
      )}
    </main>
  );
}
