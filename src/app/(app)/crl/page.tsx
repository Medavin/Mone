import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import type { CrlStatus } from "@/lib/supabase/pending.types";

import { setCrlStatus } from "./actions";
import { NewEntryForm } from "./new-entry-form";
import { SchemaNotice } from "../schema-notice";

export const metadata = { title: "CRL · MOne" };

/** Open work first — closed requests are history, not a to-do list. */
const STATUS_ORDER: CrlStatus[] = ["open", "pending", "answered", "closed"];

const NEXT_STATUS: Partial<Record<CrlStatus, { to: CrlStatus; label: string }>> = {
  open: { to: "pending", label: "Mark pending" },
  pending: { to: "answered", label: "Mark answered" },
  answered: { to: "closed", label: "Close" },
};

/** Days a request has been waiting, so the oldest ones are obvious. */
function ageInDays(opened: string) {
  const ms = Date.now() - new Date(opened).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export default async function CrlPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const supabase = createClient();
  const filter = STATUS_ORDER.includes(searchParams.status as CrlStatus)
    ? (searchParams.status as CrlStatus)
    : null;

  const [{ data: clinics }, { data: entries, error }] = await Promise.all([
    supabase.from("clinics").select("id, name").order("name"),
    (filter
      ? supabase
          .from("crl_entries")
          .select(
            "id, clinic_id, requested_from, request_type, detail, status, opened_at, clinics ( name )",
          )
          .eq("status", filter)
      : supabase
          .from("crl_entries")
          .select(
            "id, clinic_id, requested_from, request_type, detail, status, opened_at, clinics ( name )",
          )
    ).order("opened_at", { ascending: true }),
  ]);

  const rows = entries ?? [];
  const counts = new Map<CrlStatus, number>();
  for (const row of rows) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }

  return (
    <main className="page page--wide">
      <header className="page-header">
        <div>
          <h1>Client request log</h1>
          <p className="muted">
            Accounts in AR waiting on information from the clinic or the
            patient.
          </p>
        </div>
        <NewEntryForm clinics={clinics ?? []} />
      </header>

      <nav className="filters">
        <a href="/crl" className={filter ? "" : "active"}>
          All
        </a>
        {STATUS_ORDER.map((status) => (
          <a
            key={status}
            href={`/crl?status=${status}`}
            className={filter === status ? "active" : ""}
          >
            {status.replace("_", " ")}
            {counts.get(status) ? ` (${counts.get(status)})` : ""}
          </a>
        ))}
      </nav>

      {error ? (
        <SchemaNotice
          feature="client request log"
          tables={["crl_entries"]}
          message={error.message}
        />
      ) : null}

      {error ? null : rows.length === 0 ? (
        <p className="muted">
          Nothing here. Requests you raise against a clinic&rsquo;s AR will
          appear in this list.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Clinic</th>
                <th>From</th>
                <th>Type</th>
                <th>Detail</th>
                <th>Status</th>
                <th>Opened</th>
                <th className="num">Age</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const next = NEXT_STATUS[entry.status];
                const age = ageInDays(entry.opened_at);
                return (
                  <tr key={entry.id}>
                    <td>
                      {(entry.clinics as { name: string } | null)?.name ?? "—"}
                    </td>
                    <td className="muted">{entry.requested_from}</td>
                    <td className="muted">{entry.request_type ?? "—"}</td>
                    <td className="detail-cell">{entry.detail}</td>
                    <td>
                      <span className={`pill pill--${entry.status}`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="muted">{formatDate(entry.opened_at)}</td>
                    <td className={`num ${age >= 14 ? "stale" : "muted"}`}>
                      {age}d
                    </td>
                    <td>
                      {next ? (
                        <form action={setCrlStatus}>
                          <input type="hidden" name="id" value={entry.id} />
                          <input type="hidden" name="status" value={next.to} />
                          <button type="submit" className="secondary small">
                            {next.label}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
