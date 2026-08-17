import { createClient } from "@/lib/supabase/server";

import { signOut } from "./actions";

export const metadata = { title: "Clinics · MOne" };

type Clinic = Record<string, unknown>;

/** Renders a cell for whatever shape the column happens to hold. */
function formatCell(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default async function ClinicsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The columns aren't pinned down yet, so select everything RLS allows and
  // derive the table headers from the rows that come back.
  const { data, error } = await supabase.from("clinics").select("*");
  const clinics = (data ?? []) as Clinic[];
  const columns = clinics.length > 0 ? Object.keys(clinics[0]) : [];

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Clinics</h1>
          <p className="muted">Signed in as {user?.email ?? "unknown"}</p>
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
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clinics.map((clinic, index) => (
                <tr key={String(clinic.id ?? index)}>
                  {columns.map((column) => (
                    <td key={column}>{formatCell(clinic[column])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
