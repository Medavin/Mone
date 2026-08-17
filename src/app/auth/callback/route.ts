import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for email links — password recovery, email confirmation and
 * OAuth. Supabase sends a one-time `code` here, which we exchange for a
 * session before forwarding the user on.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  // Only same-origin paths, so the link can't be used as an open redirect.
  const redirectTo =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/clinics";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}${redirectTo}`);
}
