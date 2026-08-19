import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import NewsClient, { type Announcement } from "./NewsClient";
import type { Profile } from "@/lib/types";
import { manages } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
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

  const [annRes, readRes, peopleRes] = await Promise.all([
    supabase
      .from("announcements")
      .select("*")
      .order("pinned", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase.from("announcement_reads").select("announcement_id").eq("user_id", user?.id ?? ""),
    supabase.from("profiles").select("id, full_name"),
  ]);

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="border-b border-hairline pb-4">
          <h1 className="text-2xl font-semibold tracking-tight">News and policy</h1>
          <p className="mt-1 text-sm text-muted">
            Announcements, policies and anything worth everyone knowing.
          </p>
        </div>

        <div className="mt-6">
          {!profile ? (
            <p className="text-sm text-muted">Sign in to read announcements.</p>
          ) : (
            <NewsClient
              me={profile.id}
              isAdmin={manages(profile.role)}
              items={(annRes.data ?? []) as Announcement[]}
              readIds={((readRes.data ?? []) as { announcement_id: number }[]).map((r) => r.announcement_id)}
              people={(peopleRes.data ?? []) as { id: string; full_name: string }[]}
            />
          )}
        </div>
      </main>
    </>
  );
}
