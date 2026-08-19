import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import HoursReport from "./HoursReport";
import { fetchAllRows } from "@/lib/fetchAll";
import { businessToday } from "@/lib/businessDate";
import type { Profile } from "@/lib/types";
import type { EventLike, PolicyRow, ShiftLike, SpanLike } from "@/lib/hours";

export const dynamic = "force-dynamic";

/** Everyone above the management line sees the whole team. */
const MANAGES = ["admin", "ops", "exec"];

function firstOfMonth(d: string) {
  return `${d.slice(0, 7)}-01`;
}

export default async function HoursPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; person?: string };
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

  const manages = !!profile && MANAGES.includes(profile.role);

  const today = businessToday();
  const to = searchParams.to ?? today;
  const from = searchParams.from ?? firstOfMonth(to);

  // Someone who does not manage people can only ever be looking at themselves.
  // The database enforces this too; this simply stops the page asking for
  // rows it will not be given.
  const person = manages ? searchParams.person ?? "" : profile?.id ?? "";

  const [peopleRes, policyRes, clinicRes, empRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role").eq("is_active", true).order("full_name"),
    supabase.from("time_policy").select("kind, label, billable, productive").order("kind"),
    supabase.from("clinics").select("id, name").order("name"),
    supabase.from("employees").select("id, full_name, profile_id"),
  ]);

  let shifts: ShiftLike[] = [];
  if (profile) {
    const res = await fetchAllRows<ShiftLike>((lo, hi) => {
      let q = supabase
        .from("work_shifts")
        .select("id, user_id, business_date, punched_in_at, punched_out_at, work_location")
        .gte("business_date", from)
        .lte("business_date", to)
        .order("business_date")
        .order("user_id")
        .range(lo, hi);
      if (person) q = q.eq("user_id", person);
      return q;
    });
    shifts = res.rows;
  }

  const shiftIds = shifts.map((s) => s.id);

  let events: EventLike[] = [];
  let spans: SpanLike[] = [];
  if (shiftIds.length) {
    // Chunked: a long range can hold more shift ids than one `in` list wants.
    for (let i = 0; i < shiftIds.length; i += 300) {
      const slice = shiftIds.slice(i, i + 300);
      const [e, s] = await Promise.all([
        fetchAllRows<EventLike>((lo, hi) =>
          supabase
            .from("shift_events")
            .select("shift_id, kind, started_at, ended_at, note")
            .in("shift_id", slice)
            .order("shift_id")
            .order("started_at")
            .range(lo, hi)
        ),
        fetchAllRows<SpanLike>((lo, hi) =>
          supabase
            .from("shift_clinic_spans")
            .select("shift_id, clinic_id, started_at, ended_at")
            .in("shift_id", slice)
            .order("shift_id")
            .order("started_at")
            .range(lo, hi)
        ),
      ]);
      events = events.concat(e.rows);
      spans = spans.concat(s.rows);
    }
  }

  // Rates are management-only; the policy refuses them to anyone else, so this
  // simply comes back empty rather than failing.
  const { data: rateRows } = manages
    ? await supabase
        .from("employee_rates")
        .select("employee_id, hourly_rate, currency, effective_from")
        .order("effective_from")
    : { data: [] };

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        {!profile ? (
          <p className="text-sm text-muted">Sign in to see hours.</p>
        ) : (
          <HoursReport
            me={profile}
            manages={manages}
            from={from}
            to={to}
            person={person}
            people={(peopleRes.data ?? []) as { id: string; full_name: string; role: string }[]}
            policy={(policyRes.data ?? []) as PolicyRow[]}
            clinics={(clinicRes.data ?? []) as { id: number; name: string }[]}
            employees={
              (empRes.data ?? []) as { id: number; full_name: string; profile_id: string | null }[]
            }
            rates={
              (rateRows ?? []) as {
                employee_id: number;
                hourly_rate: number;
                currency: string;
                effective_from: string;
              }[]
            }
            shifts={shifts}
            events={events}
            spans={spans}
          />
        )}
      </main>
    </>
  );
}
