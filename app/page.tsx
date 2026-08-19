import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Sends each person to their own first screen.
 *
 * The choice is stored per employee (set when they are added) and falls back to
 * a sensible default for their role. Landing pages that have not been built yet
 * fall back to the portfolio dashboard rather than a 404 — the preference is
 * kept, so it starts working the day that screen exists.
 */
const ROUTES: Record<string, string> = {
  dashboard: "/dashboard",
  clinics: "/clinics",
  people: "/people",
  // Not built yet — the preference is remembered, the destination is not.
  operations: "/dashboard",
  cam: "/dashboard",
  guest: "/clinics",
};

export default async function Home() {
  const supabase = createClient();
  const { data } = await supabase.rpc("my_landing_page");
  redirect(ROUTES[(data as string) ?? "dashboard"] ?? "/dashboard");
}
