import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · MOne" };

/** Only allow same-origin paths, so `?redirectTo=` can't bounce users off-site. */
function safeRedirect(value: string | string[] | undefined) {
  if (typeof value !== "string") return "/clinics";
  if (!value.startsWith("/") || value.startsWith("//")) return "/clinics";
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { redirectTo?: string | string[]; error?: string | string[] };
}) {
  const redirectTo = safeRedirect(searchParams.redirectTo);
  const callbackError =
    typeof searchParams.error === "string" ? searchParams.error : null;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(redirectTo);
  }

  return (
    <main className="page page--narrow">
      <h1>MOne</h1>
      <p className="muted">Sign in to continue.</p>
      {callbackError ? (
        <p className="error" role="alert">
          {callbackError === "missing_code"
            ? "That sign-in link was invalid or has already been used."
            : callbackError}
        </p>
      ) : null}
      <LoginForm redirectTo={redirectTo} />
    </main>
  );
}
