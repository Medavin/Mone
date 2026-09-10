import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import DataImportClient from "./DataImportClient";
import { manages, type Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DataImportPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profileRow } = await supabase
    .from("profiles").select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "").maybeSingle();
  const profile = (profileRow as Profile) ?? null;

  const [clinicRes, aliasRes, profileListRes] = await Promise.all([
    supabase.from("clinics").select("id, name").order("name"),
    supabase.from("clinic_aliases").select("normalised, clinic_id"),
    supabase.from("import_profiles").select("*").eq("is_active", true).order("times_used", { ascending: false }),
  ]);

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="border-b border-hairline pb-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Import data</h1>
            <Link href="/import" className="text-sm text-accent underline">
              Monthly pack instead
            </Link>
          </div>
          <p className="mt-1 text-sm text-muted">
            Any report with a header row — denials, CRL, payments, payers, people, inventory.
            Map it once and the next file of the same shape loads itself.
          </p>
        </div>

        <div className="mt-8">
          {!manages(profile?.role) ? (
            <p className="rounded-card border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
              Importing is limited to ops, exec and administrators. The database enforces this too.
            </p>
          ) : (
            <DataImportClient
              me={profile as Profile}
              clinics={(clinicRes.data ?? []) as { id: number; name: string }[]}
              aliases={(aliasRes.data ?? []) as { normalised: string; clinic_id: number }[]}
              savedProfiles={(profileListRes.data ?? []) as never}
            />
          )}
        </div>
      </main>
    </>
  );
}
