import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import PacksClient from "./PacksClient";
import { manages, type Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PacksPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profileRow } = await supabase
    .from("profiles").select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "").maybeSingle();
  const profile = (profileRow as Profile) ?? null;

  const [clinicRes, monthRes] = await Promise.all([
    supabase.from("clinics").select("id, name, status").order("name"),
    supabase.from("activity_month_list").select("period_month").order("period_month"),
  ]);

  const months = ((monthRes.data ?? []) as { period_month: string }[]).map((r) =>
    r.period_month.slice(0, 7)
  );

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        {!manages(profile?.role) ? (
          <p className="rounded-card border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
            Generating packs is limited to ops, exec and administrators.
          </p>
        ) : (
          <PacksClient
            clinics={(clinicRes.data ?? []) as { id: number; name: string; status: string }[]}
            months={months}
          />
        )}
      </main>
    </>
  );
}
