import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import TeamChat from "./TeamChat";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
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

  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("is_active", true)
    .order("full_name");

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-6 py-8">
        {!profile ? (
          <p className="text-sm text-muted">Sign in to use the team chat.</p>
        ) : (
          <TeamChat
            me={profile}
            people={(people ?? []) as { id: string; full_name: string; role: string }[]}
          />
        )}
      </main>
    </>
  );
}
