import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import AddEventForm from "./AddEventForm";
import { businessToday } from "@/lib/businessDate";
import type { Profile, Clinic } from "@/lib/types";

export const dynamic = "force-dynamic";

type Entry = {
  key: string;
  label: string;
  detail?: string;
  tone: "event" | "meeting" | "deadline" | "visit" | "training" | "other" | "holiday" | "leave";
  href?: string;
};

const TONE: Record<Entry["tone"], string> = {
  event: "bg-accent/10 text-accent",
  meeting: "bg-accent/15 text-accent",
  deadline: "bg-bad/10 text-bad",
  visit: "bg-good/10 text-good",
  training: "bg-warn/10 text-warn",
  other: "bg-canvas text-muted",
  holiday: "bg-warn/15 text-warn",
  leave: "bg-canvas text-muted",
};

/** Every date in a month grid, padded to whole weeks starting Monday. */
function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startPad = (first.getUTCDay() + 6) % 7; // Monday = 0
  const days: string[] = [];
  const cursor = new Date(first);
  cursor.setUTCDate(cursor.getUTCDate() - startPad);
  for (let i = 0; i < 42; i++) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // Trim a trailing all-next-month week.
  const last = days[35];
  return Number(last.slice(5, 7)) !== month && Number(days[35].slice(8)) > 7
    ? days.slice(0, 35)
    : days;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { m?: string };
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const profile = (profileRow as Profile) ?? null;

  const today = businessToday();
  const shown = searchParams.m && /^\d{4}-\d{2}$/.test(searchParams.m) ? searchParams.m : today.slice(0, 7);
  const [year, month] = shown.split("-").map(Number);

  const days = monthGrid(year, month);
  const from = days[0];
  const to = days[days.length - 1];

  const [eventsRes, holidayRes, leaveRes, peopleRes, clinicRes] = await Promise.all([
    supabase
      .from("calendar_events")
      .select("id, title, detail, starts_on, ends_on, start_time, kind, visibility, clinic_id")
      .lte("starts_on", to)
      .or(`ends_on.gte.${from},and(ends_on.is.null,starts_on.gte.${from})`),
    supabase.from("company_holidays").select("holiday_date, name").gte("holiday_date", from).lte("holiday_date", to),
    supabase.from("leave_days").select("user_id, leave_date, kind").eq("status", "approved").gte("leave_date", from).lte("leave_date", to),
    supabase.from("profiles").select("id, full_name"),
    supabase.from("clinics").select("id, code, name, status, go_live_date, notes").order("name"),
  ]);

  const nameOf = new Map((peopleRes.data ?? []).map((p) => [p.id as string, p.full_name as string]));
  const clinicName = new Map((clinicRes.data ?? []).map((c) => [c.id as number, c.name as string]));

  const byDay = new Map<string, Entry[]>();
  const push = (day: string, e: Entry) => {
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  };

  for (const h of holidayRes.data ?? []) {
    push(h.holiday_date as string, { key: `h${h.holiday_date}`, label: h.name as string, tone: "holiday" });
  }

  for (const l of leaveRes.data ?? []) {
    push(l.leave_date as string, {
      key: `l${l.user_id}${l.leave_date}`,
      label: `${nameOf.get(l.user_id as string) ?? "Someone"} — ${l.kind}`,
      tone: "leave",
    });
  }

  for (const e of eventsRes.data ?? []) {
    const start = e.starts_on as string;
    const end = (e.ends_on as string) ?? start;
    for (const d of days) {
      if (d >= start && d <= end) {
        push(d, {
          key: `e${e.id}${d}`,
          label: `${e.start_time ? `${e.start_time} · ` : ""}${e.title}`,
          detail: [e.detail, e.clinic_id ? clinicName.get(e.clinic_id as number) : null]
            .filter(Boolean)
            .join(" · "),
          tone: (e.kind as Entry["tone"]) ?? "event",
          href: e.clinic_id ? `/clinics/${e.clinic_id}` : undefined,
        });
      }
    }
  }

  const prev = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  const title = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const upcoming = days
    .filter((d) => d >= today)
    .flatMap((d) => (byDay.get(d) ?? []).filter((e) => e.tone !== "leave").map((e) => ({ d, e })))
    .slice(0, 6);

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
            <p className="mt-1 text-sm text-muted">
              Shared events, company holidays and approved leave.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/calendar?m=${prev}`} className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-white">
              ←
            </Link>
            <span className="min-w-[9rem] text-center text-sm font-medium">{title}</span>
            <Link href={`/calendar?m=${next}`} className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-white">
              →
            </Link>
            <Link href="/calendar" className="ml-2 text-xs text-muted hover:text-ink">
              Today
            </Link>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-7 gap-px overflow-hidden rounded border border-hairline bg-hairline">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="bg-white px-2 py-1.5 text-center font-mono text-[11px] uppercase tracking-wider text-muted">
              {d}
            </div>
          ))}

          {days.map((d) => {
            const inMonth = Number(d.slice(5, 7)) === month;
            const isToday = d === today;
            const entries = byDay.get(d) ?? [];
            const weekend = [6, 0].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
            return (
              <div
                key={d}
                className={`min-h-[92px] p-1.5 ${
                  inMonth ? (weekend ? "bg-canvas" : "bg-white") : "bg-canvas/60"
                }`}
              >
                <div
                  className={`tnum mb-1 text-xs ${
                    isToday
                      ? "inline-block rounded bg-accent px-1.5 py-0.5 font-medium text-white"
                      : inMonth
                        ? "text-muted"
                        : "text-hairline"
                  }`}
                >
                  {Number(d.slice(8))}
                </div>
                <div className="space-y-1">
                  {entries.slice(0, 3).map((e) =>
                    e.href ? (
                      <Link
                        key={e.key}
                        href={e.href}
                        className={`block truncate rounded px-1.5 py-0.5 text-[11px] ${TONE[e.tone]}`}
                        title={`${e.label}${e.detail ? ` — ${e.detail}` : ""}`}
                      >
                        {e.label}
                      </Link>
                    ) : (
                      <div
                        key={e.key}
                        className={`truncate rounded px-1.5 py-0.5 text-[11px] ${TONE[e.tone]}`}
                        title={`${e.label}${e.detail ? ` — ${e.detail}` : ""}`}
                      >
                        {e.label}
                      </div>
                    )
                  )}
                  {entries.length > 3 && (
                    <div className="px-1.5 text-[11px] text-muted">+{entries.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Coming up</h2>
            {upcoming.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nothing scheduled in the rest of this month.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {upcoming.map(({ d, e }) => (
                  <li key={e.key} className="flex gap-3">
                    <span className="tnum w-24 shrink-0 text-muted">
                      {new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        timeZone: "UTC",
                      })}
                    </span>
                    <span>
                      {e.label}
                      {e.detail && <span className="block text-xs text-muted">{e.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Add an event</h2>
            {profile ? (
              <AddEventForm
                userId={profile.id}
                clinics={(clinicRes.data ?? []) as Clinic[]}
                defaultDate={shown === today.slice(0, 7) ? today : `${shown}-01`}
              />
            ) : (
              <p className="mt-3 text-sm text-muted">Sign in to add events.</p>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
