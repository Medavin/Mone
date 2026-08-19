import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import AdminClient from "./AdminClient";
import type { Clinic, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "")
    .maybeSingle();

    // ops and exec sit ABOVE admin in this business and have full rights.
  const isAdmin = ["admin", "ops", "exec"].includes((profile as Profile | null)?.role ?? "");

  const [clinicsRes, aliasRes, typeRes, typeAliasRes, empRes, profRes, policyRes, rateRes, peopleRes] = await Promise.all([
    supabase.from("clinics").select("*").order("name"),
    supabase.from("clinic_aliases").select("id, normalised, raw_example, clinic_id, source").order("raw_example"),
    supabase.from("action_types").select("id, name, category, sort_order").order("sort_order"),
    supabase.from("action_type_aliases").select("id, normalised, raw_example, action_type_id").order("raw_example"),
    supabase.from("employees").select("*").order("full_name"),
    supabase.from("profiles").select("id, full_name, email, role").order("full_name"),
    supabase.from("time_policy").select("kind, label, billable, productive, note").order("kind"),
    supabase
      .from("employee_rates")
      .select("employee_id, hourly_rate, currency, effective_from")
      .order("effective_from"),
    supabase.from("clinic_people").select("*").order("clinic_id").order("sort_order"),
  ]);

  return (
    <>
      <AppHeader profile={(profile as Profile) ?? null} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="border-b border-hairline pb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted">
            Employees, clinics, and the name mappings the imports rely on.
          </p>
        </div>

        <div className="mt-8">
          {!isAdmin ? (
            <p className="rounded border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
              Settings are limited to administrators. The database enforces this.
            </p>
          ) : (
            <AdminClient
              clinics={(clinicsRes.data ?? []) as Clinic[]}
              aliases={(aliasRes.data ?? []) as never}
              actionTypes={(typeRes.data ?? []) as never}
              actionAliases={(typeAliasRes.data ?? []) as never}
              employees={(empRes.data ?? []) as never}
              profiles={(profRes.data ?? []) as never}
              timePolicy={(policyRes.data ?? []) as never}
              rates={(rateRes.data ?? []) as never}
              clinicPeople={(peopleRes.data ?? []) as never}
            />
          )}
        </div>
      </main>
    </>
  );
}
