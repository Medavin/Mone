import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import TasksClient, { type Task, type Flag } from "./TasksClient";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
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

  const [taskRes, flagRes, peopleRes, clinicRes, empRes] = await Promise.all([
    supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    supabase.from("clinic_flags").select("*").order("raised_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("clinics").select("id, name").eq("status", "active").order("name"),
    supabase.from("employees").select("department").neq("status", "left"),
  ]);

  // Departments already in use, offered as team suggestions rather than a
  // separate list somebody has to maintain.
  const teams = Array.from(
    new Set(((empRes.data ?? []) as { department: string | null }[]).map((e) => e.department).filter(Boolean) as string[])
  ).sort();

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="border-b border-hairline pb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Tasks and flags</h1>
          <p className="mt-1 text-sm text-muted">
            Work you owe, work you have sent out, and clinics needing attention.
          </p>
        </div>

        <div className="mt-6">
          {!profile ? (
            <p className="text-sm text-muted">Sign in to see your tasks.</p>
          ) : (
            <TasksClient
              me={profile.id}
              tasks={(taskRes.data ?? []) as Task[]}
              flags={(flagRes.data ?? []) as Flag[]}
              people={(peopleRes.data ?? []) as { id: string; full_name: string }[]}
              clinics={(clinicRes.data ?? []) as { id: number; name: string }[]}
              teams={teams}
            />
          )}
        </div>
      </main>
    </>
  );
}
