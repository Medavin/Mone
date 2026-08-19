import LoginForm from "./LoginForm";
import { APP_TAGLINE, APP_SUBLINE } from "@/lib/types";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          {/* The client's own logo on the one screen every person sees first. */}
          <img
            src="/momentum-logo.svg"
            alt="Momentum Billing"
            className="h-9 w-auto"
          />
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">MOne</h1>
          <p className="mt-2 text-base font-medium">{APP_TAGLINE}</p>
          <p className="mt-1 text-sm text-muted">{APP_SUBLINE}</p>
        </div>

        <LoginForm />
      </div>
    </main>
  );
}
