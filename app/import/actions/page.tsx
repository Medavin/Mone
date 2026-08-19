import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import ActionsImportClient from "./ActionsImportClient";
import type { Profile } from "@/lib/types";
import { manages } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ActionsImportPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "")
    .maybeSingle();

  const [clinicRes, typeRes, actionAliasRes, clinicAliasRes] = await Promise.all([
    supabase.from("clinics").select("id, name, status").order("name"),
    supabase.from("action_types").select("id, name, category").order("sort_order"),
    supabase.from("action_type_aliases").select("normalised, action_type_id"),
    supabase.from("clinic_aliases").select("normalised, clinic_id"),
  ]);

  const isAdmin = manages((profile as Profile | null)?.role);

  return (
    <>
      <AppHeader profile={(profile as Profile) ?? null} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="border-b border-hairline pb-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Import the collection action report
            </h1>
            <Link href="/import" className="text-sm text-accent underline">
              Import a monthly pack instead
            </Link>
          </div>
          <p className="mt-1 text-sm text-muted">
            One file covers every clinic for one month. Clinic and action names are
            typed by hand in this report, so anything unfamiliar is shown for you to
            match before a single row is written.
          </p>
        </div>

        <div className="mt-8">
          {!isAdmin ? (
            <p className="rounded border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
              Importing is limited to administrators. The database enforces this too.
            </p>
          ) : (
            <ActionsImportClient
              clinics={(clinicRes.data ?? []) as { id: number; name: string; status: string }[]}
              actionTypes={
                (typeRes.data ?? []) as { id: number; name: string; category: string | null }[]
              }
              actionAliases={
                (actionAliasRes.data ?? []) as { normalised: string; action_type_id: number }[]
              }
              clinicAliases={
                (clinicAliasRes.data ?? []) as { normalised: string; clinic_id: number }[]
              }
            />
          )}
        </div>
      </main>
    </>
  );
}
