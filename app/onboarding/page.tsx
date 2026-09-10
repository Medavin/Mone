import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import OnboardingClient from "./OnboardingClient";
import { manages, type Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profileRow } = await supabase
    .from("profiles").select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "").maybeSingle();
  const profile = (profileRow as Profile) ?? null;

  const [obRes, clinicRes, peopleRes, stepRes, tplRes, locRes, payerRes] = await Promise.all([
    supabase.from("client_onboarding").select("*").order("created_at", { ascending: false }),
    supabase.from("clinics").select("id, name, status, go_live_date").order("name"),
    supabase.from("profiles").select("id, full_name, role").eq("is_active", true).order("full_name"),
    supabase.from("onboarding_steps").select("*").order("sort_order"),
    supabase.from("onboarding_step_templates").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("clinic_locations").select("*").order("name"),
    supabase.from("clinic_payers").select("*").order("payer_name"),
  ]);

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        {!profile ? (
          <p className="text-sm text-muted">Sign in to see client onboarding.</p>
        ) : (
          <OnboardingClient
            canEdit={manages(profile.role)}
            records={(obRes.data ?? []) as never}
            clinics={(clinicRes.data ?? []) as never}
            people={(peopleRes.data ?? []) as { id: string; full_name: string; role: string }[]}
            steps={(stepRes.data ?? []) as never}
            templates={(tplRes.data ?? []) as never}
            locations={(locRes.data ?? []) as never}
            payers={(payerRes.data ?? []) as never}
          />
        )}
      </main>
    </>
  );
}
