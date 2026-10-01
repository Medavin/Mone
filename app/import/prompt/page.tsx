import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import PromptImportClient from "./PromptImportClient";
import type { Profile } from "@/lib/types";
import { manages } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Import a Prompt EMR report. Today: the A/R Report. The nine Prompt
 * clients do not appear in the AdvancedMD packs, so this is how their
 * A/R reaches the Results page, the clinic page and the monthly pack.
 */
export default async function PromptImportPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles").select("id, full_name, email, role, is_active").eq("id", user?.id ?? "").maybeSingle();

  const [clinicRes, aliasRes, fcRes] = await Promise.all([
    supabase.from("clinics").select("*").order("name"),
    supabase.from("clinic_aliases").select("normalised, clinic_id").like("normalised", "prompt:%"),
    supabase.from("financial_classes").select("id, code").like("code", "P-%"),
  ]);
  const isAdmin = manages((profile as Profile | null)?.role);

  return (
    <>
      <AppHeader profile={(profile as Profile) ?? null} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="border-b border-hairline pb-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Import a Prompt report</h1>
            <Link href="/import" className="text-sm text-accent underline">Import an AdvancedMD pack instead</Link>
          </div>
          <p className="mt-1 text-sm text-muted">
            For clients that bill in Prompt. In Prompt: Reports → Revenue → <strong>A/R Report</strong>, choose All
            Facilities, set <strong>From</strong> to the earliest date and <strong>To</strong> to the month end, then download.
            The file is read on this computer; only facility totals are saved — no patient names, dates of birth or
            member IDs ever leave your browser.
          </p>
        </div>
        <div className="mt-8">
          {!isAdmin ? (
            <p className="rounded border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
              Importing is limited to administrators. The database enforces this too.
            </p>
          ) : (
            <PromptImportClient
              clinics={(clinicRes.data ?? []) as { id: number; name: string; status: string; billing_system?: string | null }[]}
              aliases={(aliasRes.data ?? []) as { normalised: string; clinic_id: number }[]}
              classes={(fcRes.data ?? []) as { id: number; code: string }[]}
            />
          )}
        </div>
      </main>
    </>
  );
}
