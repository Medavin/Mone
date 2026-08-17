import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import type { Clinic, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ClinicsPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "")
    .maybeSingle();

  const { data: clinics, error } = await supabase
    .from("clinics")
    .select("id, code, name, status, go_live_date, notes")
    .order("name");

  const rows = (clinics ?? []) as Clinic[];

  return (
    <>
      <AppHeader profile={(profile as Profile) ?? null} />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-end justify-between border-b border-hairline pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Clinics</h1>
            <p className="mt-1 text-sm text-muted">
              Every clinic you have access to.
            </p>
          </div>
          <span className="font-mono tnum text-sm text-muted">
            {rows.length} total
          </span>
        </div>

        {!profile && (
          <p className="mt-6 rounded border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
            You are signed in, but you have no profile row, so the database
            returns nothing. An administrator needs to add you to the profiles
            table.
          </p>
        )}

        {error && (
          <p className="mt-6 rounded border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
            The clinics could not be loaded: {error.message}
          </p>
        )}

        {profile && !error && rows.length === 0 && (
          <p className="mt-6 text-sm text-muted">
            No clinics yet. Run migration 003 to load them.
          </p>
        )}

        {rows.length > 0 && (
          <table className="mt-6 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="w-10 py-2 font-mono text-[11px] uppercase tracking-wider text-muted">
                  #
                </th>
                <th className="py-2 font-mono text-[11px] uppercase tracking-wider text-muted">
                  Clinic
                </th>
                <th className="py-2 font-mono text-[11px] uppercase tracking-wider text-muted">
                  Status
                </th>
                <th className="py-2 font-mono text-[11px] uppercase tracking-wider text-muted">
                  Note
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr
                  key={c.id}
                  className="border-b border-hairline/60 hover:bg-white"
                >
                  <td className="py-2.5 font-mono tnum text-xs text-muted">
                    {String(i + 1).padStart(2, "0")}
                  </td>
                  <td className="py-2.5 font-medium">{c.name}</td>
                  <td className="py-2.5">
                    <span
                      className={
                        c.status === "active"
                          ? "text-good"
                          : "text-muted"
                      }
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2.5 text-muted">{c.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
