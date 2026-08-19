import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import NotesClient, { type Note } from "./NotesClient";
import type { Profile } from "@/lib/types";
import { manages } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NotesPage({
  searchParams,
}: {
  searchParams: { clinic?: string; month?: string };
}) {
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

  const [noteRes, clinicRes, peopleRes] = await Promise.all([
    supabase.from("meeting_notes").select("*").order("met_on", { ascending: false }),
    supabase.from("clinics").select("id, name, status").order("name"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  const clinics = (clinicRes.data ?? []) as { id: number; name: string; status: string }[];

  // Which months a clinic actually has figures for. A note is filed against
  // the month it is ABOUT, not the month it was written, so the picker offers
  // the months the report covers.
  const { data: monthRows } = await supabase
    .from("clinic_monthly")
    .select("period_month")
    .order("period_month", { ascending: false });

  const months = Array.from(
    new Set(((monthRows ?? []) as { period_month: string }[]).map((m) => m.period_month.slice(0, 7)))
  );

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="border-b border-hairline pb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Meeting notes</h1>
          <p className="mt-1 text-sm text-muted">
            What was said in a client meeting, filed against the clinic and the month it was
            about — so a September call about July&apos;s figures sits with July.
          </p>
        </div>

        <div className="mt-6">
          {!profile ? (
            <p className="text-sm text-muted">Sign in to see meeting notes.</p>
          ) : (
            <NotesClient
              me={profile.id}
              isAdmin={manages(profile.role)}
              notes={(noteRes.data ?? []) as Note[]}
              clinics={clinics}
              people={(peopleRes.data ?? []) as { id: string; full_name: string }[]}
              months={months}
              initialClinic={searchParams.clinic ?? ""}
              initialMonth={searchParams.month ?? ""}
            />
          )}
        </div>
      </main>
    </>
  );
}
