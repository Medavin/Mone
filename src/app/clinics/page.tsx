import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";
import { formatDate } from "@/lib/format";

import { signOut } from "./actions";

export const metadata = { title: "Clinics · MOne" };

type Clinic = Pick<
  Tables<"clinics">,
  "id" | "name" | "code" | "status" | "go_live_date"
>;

export default async function ClinicsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("clinics")
    .select("id, name, code, status, go_live_date")
    .order("name", { ascending: true });

  const clinics: Clinic[] = data ?? [];

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Clinics</h1>
          <p className="muted">
            {clinics.length > 0
              ? `${clinics.length} clinic${clinics.length === 1 ? "" : "s"} · ${user?.email ?? ""}`
              : (user?.email ?? "")}
          </p>
        </div>
        <form action={signOut}>
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </header>

      {error ? (
        <p className="error" role="alert">
          Could not load clinics: {error.message}
        </p>
      ) : clinics.length === 0 ? (
        <p className="muted">
          No clinics visible. Either the table is empty or the row-level
          security policies don&rsquo;t grant this user access.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Status</th>
                <th>Go live</th>
              </tr>
            </thead>
            <tbody>
              {clinics.map((clinic) => (
                <tr key={clinic.id}>
                  <td>
                    <Link href={`/clinics/${clinic.id}`}>{clinic.name}</Link>
                  </td>
                  <td className="muted">{clinic.code ?? "—"}</td>
                  <td>
                    <span className={`pill pill--${clinic.status}`}>
                      {clinic.status}
                    </span>
                  </td>
                  <td className="muted">{formatDate(clinic.go_live_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
