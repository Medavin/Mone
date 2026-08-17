import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
            Momentum
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">MOne</h1>
          <p className="mt-2 text-sm text-muted">
            Accounts receivable platform.
          </p>
        </div>

        <LoginForm />
      </div>
    </main>
  );
}
