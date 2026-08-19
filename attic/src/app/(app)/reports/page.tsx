import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";

import { ReportView } from "./report-view";

export const metadata = { title: "Reports · MOne" };

export default async function ReportsPage() {
  const supabase = createClient();
  const [{ data: clinics }, { data: batches }] = await Promise.all([
    supabase.from("clinics").select("id, name").order("name"),
    supabase
      .from("import_batches")
      .select(
        "id, source_name, period_month, status, rows_read, rows_accepted, rows_rejected, started_at, error_detail, clinics ( name )",
      )
      .order("started_at", { ascending: false })
      .limit(15),
  ]);

  return (
    <main className="page page--wide">
      <header className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="muted">
            Read a monthly clinic report workbook, check it, then load it.
          </p>
        </div>
      </header>

      <ReportView clinics={clinics ?? []} />

      <section>
        <h2>Import history</h2>
        {(batches ?? []).length === 0 ? (
          <p className="muted">Nothing has been imported yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Clinic</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th className="num">Read</th>
                  <th className="num">Accepted</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {(batches ?? []).map((batch) => (
                  <tr key={batch.id}>
                    <td>
                      {batch.source_name}
                      {batch.error_detail ? (
                        <span className="stale sub">{batch.error_detail}</span>
                      ) : null}
                    </td>
                    <td className="muted">
                      {(batch.clinics as { name: string } | null)?.name ?? "—"}
                    </td>
                    <td className="muted">{batch.period_month}</td>
                    <td>
                      <span className={`pill pill--${batch.status}`}>
                        {batch.status}
                      </span>
                    </td>
                    <td className="num">{batch.rows_read}</td>
                    <td className="num">{batch.rows_accepted}</td>
                    <td className="muted">{formatDate(batch.started_at)}</td>
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
