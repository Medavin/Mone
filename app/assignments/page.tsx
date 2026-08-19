import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import AssignmentMatrix from "./AssignmentMatrix";
import { fetchAllRows } from "@/lib/fetchAll";
import { manages, type Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
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

  const [clinicRes, fnRes, partyRes] = await Promise.all([
    supabase.from("clinics").select("id, name, status").order("name"),
    supabase.from("work_functions").select("id, code, label, sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("work_parties").select("id, name, kind, profile_id, is_active").order("name"),
  ]);

  // clinics x functions is 38 x 12 = 456 rows today and grows with both,
  // so it is paged like every other fact read in this app.
  const { rows: owners } = await fetchAllRows<{
    id: number;
    clinic_id: number;
    function_id: number;
    party_id: number;
    note: string | null;
  }>((lo, hi) =>
    supabase
      .from("clinic_function_owners")
      .select("id, clinic_id, function_id, party_id, note")
      .order("clinic_id")
      .order("function_id")
      .range(lo, hi)
  );

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-[100rem] px-6 py-10">
        {!profile ? (
          <p className="text-sm text-muted">Sign in to see assignments.</p>
        ) : (
          <AssignmentMatrix
            canEdit={manages(profile.role)}
            clinics={(clinicRes.data ?? []) as { id: number; name: string; status: string }[]}
            functions={
              (fnRes.data ?? []) as { id: number; code: string; label: string; sort_order: number }[]
            }
            parties={
              (partyRes.data ?? []) as {
                id: number;
                name: string;
                kind: string;
                profile_id: string | null;
                is_active: boolean;
              }[]
            }
            owners={owners}
          />
        )}
      </main>
    </>
  );
}
