import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import ActivityClient from "./ActivityClient";
import { manages, type Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const profile = (profileRow as Profile) ?? null;
  const canSee = manages(profile?.role);

  // The most recent 500. A log is read backwards from now; loading all of
  // it would be slow and nobody scrolls to the beginning of time.
  const { data: logRows } = canSee
    ? await supabase
        .from("audit_log")
        .select("id, actor_name, action, table_name, record_id, changed, detail, at")
        .order("at", { ascending: false })
        .limit(500)
    : { data: [] };

  const { data: batchRows } = canSee
    ? await supabase
        .from("import_batches")
        .select("id, source_name, report_kind, clinic_id, period_month, status, started_at, rows_accepted, rows_rejected, undone_at")
        .order("started_at", { ascending: false })
        .limit(100)
    : { data: [] };

  const { data: clinicRows } = await supabase.from("clinics").select("id, name").order("name");

  // Who has actually opened the app. NULL last_sign_in_at means never.
  const { data: loginRows } = canSee
    ? await supabase
        .from("login_activity")
        .select("id, full_name, email, role, is_active, last_sign_in_at")
        .order("last_sign_in_at", { ascending: false, nullsFirst: false })
    : { data: [] };

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        {!canSee ? (
          <p className="rounded-card border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
            The activity log is limited to ops, exec and administrators. The database enforces this
            as well as this page.
          </p>
        ) : (
          <ActivityClient
            entries={(logRows ?? []) as never}
            batches={(batchRows ?? []) as never}
            clinics={(clinicRows ?? []) as { id: number; name: string }[]}
            logins={(loginRows ?? []) as never}
          />
        )}
      </main>
    </>
  );
}
