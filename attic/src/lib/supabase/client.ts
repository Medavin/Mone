import { createBrowserClient } from "@supabase/ssr";

import type { AppDatabase } from "./pending.types";
import { supabaseEnv } from "./env";

/** Supabase client for use in client components. */
export function createClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient<AppDatabase>(url, anonKey);
}
