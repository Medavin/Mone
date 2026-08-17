import { ROLE_LABEL, type Profile } from "@/lib/types";

export default function AppHeader({ profile }: { profile: Profile | null }) {
  return (
    <header className="border-b border-hairline bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">MOne</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
            Momentum
          </span>
        </div>

        <div className="flex items-center gap-4">
          {profile && (
            <div className="text-right leading-tight">
              <div className="text-sm font-medium">{profile.full_name}</div>
              <div className="text-xs text-muted">{ROLE_LABEL[profile.role]}</div>
            </div>
          )}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded border border-hairline px-3 py-1.5 text-sm
                         transition hover:border-ink hover:bg-canvas"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
