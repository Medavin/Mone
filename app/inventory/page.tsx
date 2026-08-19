import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import InventoryClient from "./InventoryClient";
import { manages, type Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
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

  const [itemRes, assignRes, peopleRes, empRes] = await Promise.all([
    supabase.from("inventory_items").select("*").order("name"),
    supabase
      .from("inventory_assignments")
      .select("*")
      .order("issued_on", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("employees").select("id, full_name, status").order("full_name"),
  ]);

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        {!profile ? (
          <p className="text-sm text-muted">Sign in to see the inventory.</p>
        ) : (
          <InventoryClient
            me={profile}
            canEdit={manages(profile.role)}
            items={(itemRes.data ?? []) as never}
            assignments={(assignRes.data ?? []) as never}
            people={(peopleRes.data ?? []) as { id: string; full_name: string }[]}
            employees={(empRes.data ?? []) as { id: number; full_name: string; status: string }[]}
          />
        )}
      </main>
    </>
  );
}
