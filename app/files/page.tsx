import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import FilesClient from "./FilesClient";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
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

  const [fileRes, clinicRes, peopleRes] = await Promise.all([
    supabase
      .from("shared_files")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("clinics").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
  ]);

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        {!profile ? (
          <p className="text-sm text-muted">Sign in to see shared files.</p>
        ) : (
          <FilesClient
            me={profile}
            files={(fileRes.data ?? []) as never}
            clinics={(clinicRes.data ?? []) as { id: number; name: string }[]}
            people={(peopleRes.data ?? []) as { id: string; full_name: string }[]}
          />
        )}
      </main>
    </>
  );
}
