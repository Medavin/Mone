import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL, type Profile, manages } from "@/lib/types";
import ShiftClock from "./ShiftClock";
import NavLinks from "./NavLinks";
import FloatingChat from "./FloatingChat";
import NotificationBell from "./NotificationBell";

/**
 * Two rows on purpose. Eleven modules cannot share one line with the clock,
 * the signed-in name and a sign-out button without everything shrinking to
 * unreadable — so identity and the person sit on top, and navigation gets a
 * line of its own where the items can breathe.
 */
export default async function AppHeader({ profile }: { profile: Profile | null }) {
  // The clock needs the clinic list so time can be attributed while it is
  // being worked, rather than reconstructed afterwards from memory.
  const supabase = createClient();
  const { data: clinicRows } = profile
    ? await supabase.from("clinics").select("id, name").eq("status", "active").order("name")
    : { data: [] };
  const clinics = (clinicRows ?? []) as { id: number; name: string }[];

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-hairline bg-surface/95 backdrop-blur">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex h-14 items-center justify-between gap-4">
          {/* Momentum Billing's own logo. The full lock-up where there is room;
              the three-swoosh mark alone where there is not. Both are the real
              brand files, not a redraw. */}
          <div className="flex items-center gap-3">
            <img
              src="/momentum-logo.svg"
              alt="Momentum Billing"
              className="hidden h-7 w-auto sm:block"
            />
            <img
              src="/momentum-mark.svg"
              alt="Momentum Billing"
              className="h-7 w-auto sm:hidden"
            />
            <span className="h-5 w-px bg-hairline" aria-hidden="true" />
            <span className="text-lg font-semibold tracking-tight">MOne</span>
          </div>

          <div className="flex items-center gap-4">
            {profile && <ShiftClock userId={profile.id} clinics={clinics} />}
            {profile && <NotificationBell userId={profile.id} />}
            {profile && (
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-sm font-medium">{profile.full_name}</div>
                <div className="text-xs text-muted">{ROLE_LABEL[profile.role]}</div>
              </div>
            )}
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-full border border-hairline px-3 py-1.5 text-sm text-muted
                           transition hover:border-ink hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        <NavLinks isAdmin={manages(profile?.role)} />
      </div>
      </header>

      {/* A SIBLING of the header, never a child. The header uses backdrop-blur,
          and a backdrop-filter makes that element the containing block for any
          fixed-position descendant — a bubble inside it would be trapped in the
          header strip. */}
      {profile && <FloatingChat userId={profile.id} />}
    </>
  );
}
