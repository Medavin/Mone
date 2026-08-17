import { createBrowserClient } from "@supabase/ssr";

import { supabaseEnv } from "./env";

/** Supabase client for use in client components. */
export function createClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey);
}
