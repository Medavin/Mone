import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import SourcesClient from "./SourcesClient";
import { manages, type Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profileRow } = await supabase
    .from("profiles").select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "").maybeSingle();
  const profile = (profileRow as Profile) ?? null;

  const [srcRes, qRes, keyRes, clinicRes, ipRes, linkRes] = await Promise.all([
    supabase.from("data_sources").select("*").order("name"),
    supabase.from("source_queries").select("*").order("name"),
    supabase.from("ingest_keys").select("id, source_id, label, is_active, last_used_at, created_at"),
    supabase.from("clinics").select("id, name, amd_office_key").order("name"),
    supabase.from("import_profiles").select("id, name, target_table").eq("is_active", true).order("name"),
    supabase.from("data_source_clinics").select("source_id, clinic_id, office_key"),
  ]);

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        {!manages(profile?.role) ? (
          <p className="rounded-card border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
            Data sources are limited to ops, exec and administrators.
          </p>
        ) : (
          <SourcesClient
            me={profile as Profile}
            sources={(srcRes.data ?? []) as never}
            queries={(qRes.data ?? []) as never}
            keys={(keyRes.data ?? []) as never}
            clinics={(clinicRes.data ?? []) as never}
            profiles={(ipRes.data ?? []) as never}
            links={(linkRes.data ?? []) as never}
          />
        )}
      </main>
    </>
  );
}
