"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "That email and password do not match an account."
          : error.message
      );
      setBusy(false);
      return;
    }

    // "/" resolves each person's own landing page (my_landing_page), which is
    // set per employee and falls back to their role. Sending everyone straight
    // to /clinics — as this did — bypassed that entirely, so an admin and an
    // exec both landed on the clinic list no matter what was configured.
    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-xs uppercase tracking-wider text-muted">Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && signIn()}
          autoComplete="username"
          className="mt-1 w-full rounded-card border border-hairline bg-surface shadow-card px-3 py-2
                     outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>

      <label className="block">
        <span className="text-xs uppercase tracking-wider text-muted">Password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && signIn()}
          autoComplete="current-password"
          className="mt-1 w-full rounded-card border border-hairline bg-surface shadow-card px-3 py-2
                     outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>

      {error && (
        <p className="rounded border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <button
        onClick={signIn}
        disabled={busy || !email || !password}
        className="w-full rounded bg-accent px-4 py-2.5 font-medium text-white
                   transition hover:bg-accent/90 disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </div>
  );
}
