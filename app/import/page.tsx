import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import ImportClient from "./ImportClient";
import type { Clinic, Profile } from "@/lib/types";
import { manages } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "")
    .maybeSingle();

  const { data: clinics } = await supabase
    .from("clinics")
    .select("id, code, name, status, go_live_date, notes")
    .order("name");

  const { data: classes } = await supabase
    .from("financial_classes")
    .select("id, code, name")
    .order("sort_order");

  const isAdmin = manages((profile as Profile | null)?.role);

  return (
    <>
      <AppHeader profile={(profile as Profile) ?? null} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="border-b border-hairline pb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Import a month</h1>
          <p className="mt-1 text-sm text-muted">
            Reads the AdvancedMD monthly pack and loads the figures. Nothing is written
            until you have seen what was found.
          </p>
          <p className="mt-3 text-sm">
            <Link href="/import/actions" className="text-accent underline">
              Import the collection action report instead
            </Link>
            <span className="text-muted"> — a different file, covering every clinic for one month.</span>
          </p>
        </div>

        <div className="mt-8">
          {!isAdmin ? (
            <p className="rounded border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
              Importing is limited to administrators. The database enforces this, so the
              figures are safe either way.
            </p>
          ) : (
            <ImportClient
              clinics={(clinics ?? []) as Clinic[]}
              financialClasses={(classes ?? []) as { id: number; code: string; name: string }[]}
            />
          )}
        </div>
      </main>
    </>
  );
}
