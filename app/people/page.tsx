import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import Panel from "@/components/Panel";
import ExportButtons from "@/components/ExportButtons";
import { businessToday, duration, localTime, minutesBetween, BUSINESS_TZ_LABEL } from "@/lib/businessDate";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: { date?: string };
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

  const date = searchParams.date ?? businessToday();

  const [peopleRes, shiftRes, eventRes, leaveRes, holidayRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role").eq("is_active", true).order("full_name"),
    supabase
      .from("work_shifts")
      .select("id, user_id, punched_in_at, punched_out_at, work_location")
      .eq("business_date", date),
    supabase.from("shift_events").select("shift_id, kind, started_at, ended_at, note"),
    supabase
      .from("leave_days")
      .select("user_id, kind")
      .eq("leave_date", date)
      .eq("status", "approved"),
    supabase.from("company_holidays").select("name").eq("holiday_date", date).maybeSingle(),
  ]);

  type ShiftRow = {
    id: number;
    user_id: string;
    punched_in_at: string;
    punched_out_at: string | null;
    work_location: string;
  };

  const staff = (peopleRes.data ?? []) as { id: string; full_name: string; role: string }[];
  const shifts = (shiftRes.data ?? []) as ShiftRow[];
  const holiday = holidayRes.data as { name: string } | null;

  const shiftByUser = new Map(shifts.map((s) => [s.user_id, s]));
  const leaveByUser = new Map(
    ((leaveRes.data ?? []) as { user_id: string; kind: string }[]).map((l) => [l.user_id, l])
  );

  const eventsByShift = new Map<number, { kind: string; started_at: string; ended_at: string | null; note: string | null }[]>();
  for (const e of (eventRes.data ?? []) as { shift_id: number; kind: string; started_at: string; ended_at: string | null; note: string | null }[]) {
    const list = eventsByShift.get(e.shift_id) ?? [];
    list.push(e);
    eventsByShift.set(e.shift_id, list);
  }

  const present = staff.filter((p) => shiftByUser.has(p.id));
  const onLeave = staff.filter((p) => leaveByUser.has(p.id));
  const absent = staff.filter((p) => !shiftByUser.has(p.id) && !leaveByUser.has(p.id));
  const atHome = present.filter((p) => shiftByUser.get(p.id)!.work_location === "home");

  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";
  const thR = "py-2 text-right font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">People</h1>
            <p className="mt-1 text-sm text-muted">
              {date === businessToday() ? "Today" : date}
              {holiday ? ` · ${holiday.name}` : ""}
            </p>
          </div>
          <form className="flex items-center gap-2">
            <input
              type="date"
              name="date"
              defaultValue={date}
              className="rounded-card border border-hairline bg-surface shadow-card px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-white"
            >
              Show
            </button>
          </form>
        </div>

        <div className="mt-6 space-y-4">
          <Panel id="attendance-counts" title="Attendance" subtitle={`${staff.length} on the team`}>
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["Present", present.length, ""],
                ["Of those, at home", atHome.length, "text-muted"],
                ["On leave", onLeave.length, ""],
                ["Not punched in", absent.length, absent.length ? "text-warn" : ""],
              ].map(([label, value, tone]) => (
                <div key={label as string} className="rounded border border-hairline p-3">
                  <div className={thL}>{label as string}</div>
                  <div className={`tnum mt-1 text-xl font-medium ${tone as string}`}>
                    {value as number}
                  </div>
                </div>
              ))}
            </div>
            {holiday && (
              <p className="mt-3 text-sm text-muted">
                {holiday.name} — nobody is expected to be punched in.
              </p>
            )}
          </Panel>

          <Panel
            id="attendance-detail"
            title="Who worked"
            subtitle={date}
            right={
              <ExportButtons
                title={`Attendance ${date}`}
                headers={["Name", "Where", "In", "Out", "On shift (min)", "Personal break (min)", "Unavoidable (min)", "Meetings (min)", "Reasons given"]}
                rows={present.map((p) => {
                  const sh = shiftByUser.get(p.id)!;
                  const list = eventsByShift.get(sh.id) ?? [];
                  const mins = (kind: string) =>
                    list
                      .filter((e) => e.kind === kind)
                      .reduce((a, e) => a + minutesBetween(e.started_at, e.ended_at), 0);
                  return [
                    p.full_name,
                    sh.work_location,
                    localTime(sh.punched_in_at),
                    sh.punched_out_at ? localTime(sh.punched_out_at) : "still on shift",
                    minutesBetween(sh.punched_in_at, sh.punched_out_at),
                    mins("break"),
                    mins("outage"),
                    mins("meeting"),
                    list
                      .filter((e) => e.note && e.kind !== "break")
                      .map((e) => `${e.kind}: ${e.note}`)
                      .join(" | "),
                  ];
                })}
              />
            }
          >
            {present.length === 0 ? (
              <p className="rounded border border-dashed border-hairline px-4 py-6 text-center text-sm text-muted">
                Nobody has punched in for this day.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={thL}>Name</th>
                    <th className={thL}>Where</th>
                    <th className={thR}>In</th>
                    <th className={thR}>Out</th>
                    <th className={thR}>On shift</th>
                    <th className={thR}>Break</th>
                    <th className={thR}>Meetings</th>
                  </tr>
                </thead>
                <tbody>
                  {present.map((p) => {
                    const s = shiftByUser.get(p.id)!;
                    const list = eventsByShift.get(s.id) ?? [];
                    const mins = (kind: string) =>
                      list
                        .filter((e) => e.kind === kind)
                        .reduce((a, e) => a + minutesBetween(e.started_at, e.ended_at), 0);
                    const breakMins = mins("break");
                    const meetMins = mins("meeting");
                    const open = list.find((e) => !e.ended_at);
                    return (
                      <tr key={p.id} className="border-b border-hairline/60">
                        <td className="py-2">
                          {p.full_name}
                          {open && (
                            <span className="ml-2 rounded bg-warn/10 px-1.5 py-0.5 text-xs text-warn">
                              {open.kind === "break" ? "on a break" : "in a meeting"}
                            </span>
                          )}
                        </td>
                        <td className="py-2">{s.work_location === "home" ? "🏠 Home" : "🏢 Office"}</td>
                        <td className="tnum py-2 text-right">{localTime(s.punched_in_at)}</td>
                        <td className="tnum py-2 text-right">
                          {s.punched_out_at ? localTime(s.punched_out_at) : "—"}
                        </td>
                        <td className="tnum py-2 text-right font-medium">
                          {duration(s.punched_in_at, s.punched_out_at)}
                        </td>
                        <td className="tnum py-2 text-right text-muted">
                          {breakMins ? `${breakMins}m` : "—"}
                        </td>
                        <td className="tnum py-2 text-right text-muted">
                          {meetMins ? `${meetMins}m` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-xs text-muted">
              Clock times are shown in your own timezone. The working day itself is anchored to{" "}
              {BUSINESS_TZ_LABEL}, so a night shift stays on one day rather than splitting across two.
            </p>
          </Panel>

          {(onLeave.length > 0 || absent.length > 0) && (
            <Panel id="attendance-away" title="Away" defaultOpen={false}>
              {onLeave.length > 0 && (
                <>
                  <h3 className={thL}>On leave</h3>
                  <ul className="mb-4 mt-2 space-y-1 text-sm">
                    {onLeave.map((p) => (
                      <li key={p.id}>
                        {p.full_name}{" "}
                        <span className="text-muted">— {leaveByUser.get(p.id)!.kind}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {absent.length > 0 && (
                <>
                  <h3 className={thL}>Not punched in</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {absent.map((p) => (
                      <li key={p.id}>{p.full_name}</li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>
          )}
        </div>
      </main>
    </>
  );
}
