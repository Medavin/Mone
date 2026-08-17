import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { supabaseEnv } from "./env";

/**
 * Supabase client for server components, route handlers and server actions.
 * Create a new one per request — never share it across requests.
 */
export function createClient() {
  // Read cookies before anything else can throw, so the caller is marked as a
  // dynamic route rather than failing during static prerendering at build time.
  const cookieStore = cookies();
  const { url, anonKey } = supabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components cannot set cookies. The middleware refreshes the
          // session on every request, so this is safe to ignore here.
        }
      },
    },
  });
}
