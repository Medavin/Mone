import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import PortalDirectory from "./PortalDirectory";
import { manages, type Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PortalsPage() {
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

  const [portalRes, linkRes, clinicRes] = await Promise.all([
    supabase.from("portals").select("*").order("name"),
    supabase.from("portal_clinics").select("portal_id, clinic_id"),
    supabase.from("clinics").select("id, name").order("name"),
  ]);

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        {!profile ? (
          <p className="text-sm text-muted">Sign in to see the portal directory.</p>
        ) : (
          <PortalDirectory
            canEdit={manages(profile.role)}
            portals={(portalRes.data ?? []) as never}
            links={(linkRes.data ?? []) as { portal_id: number; clinic_id: number }[]}
            clinics={(clinicRes.data ?? []) as { id: number; name: string }[]}
          />
        )}
      </main>
    </>
  );
}
