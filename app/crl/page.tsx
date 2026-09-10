import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import CrlClient from "./CrlClient";
import { fetchAllRows } from "@/lib/fetchAll";
import { manages, type Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CrlPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; view?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profileRow } = await supabase
    .from("profiles").select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "").maybeSingle();
  const profile = (profileRow as Profile) ?? null;

  const today = new Date().toISOString().slice(0, 10);
  const to = searchParams.to ?? today;
  const from = searchParams.from ?? `${today.slice(0, 7)}-01`;

  const [clinicRes, peopleRes, collectorRes] = await Promise.all([
    supabase.from("clinics").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name, role").eq("is_active", true).order("full_name"),
    supabase.from("collectors").select("id, code, display_name"),
  ]);

  const { rows } = await fetchAllRows<Record<string, unknown>>((lo, hi) =>
    supabase.from("crl_entries").select("*")
      .gte("entry_date", from).lte("entry_date", to)
      .order("entry_date", { ascending: false }).range(lo, hi)
  );

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        {!profile ? (
          <p className="text-sm text-muted">Sign in to see the CRL.</p>
        ) : (
          <CrlClient
            canEdit={manages(profile.role)}
            from={from} to={to} view={searchParams.view ?? "list"}
            entries={rows as never}
            clinics={(clinicRes.data ?? []) as { id: number; name: string }[]}
            people={(peopleRes.data ?? []) as { id: string; full_name: string; role: string }[]}
            collectors={(collectorRes.data ?? []) as { id: number; code: string; display_name: string | null }[]}
          />
        )}
      </main>
    </>
  );
}
