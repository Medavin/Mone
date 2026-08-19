"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import TableControls from "@/components/TableControls";
import Missing from "@/components/Missing";
import { localTime } from "@/lib/businessDate";
import {
  addTotals,
  clinicMinutes,
  decimalHours,
  emptyTotals,
  hm,
  rateOn,
  reasonsFor,
  totalsForShift,
  type DayTotals,
  type EventLike,
  type PolicyRow,
  type ShiftLike,
  type SpanLike,
} from "@/lib/hours";
import type { Profile } from "@/lib/types";

type Person = { id: string; full_name: string; role: string };
type Employee = { id: number; full_name: string; profile_id: string | null };
type Rate = { employee_id: number; hourly_rate: number; currency: string; effective_from: string };

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function HoursReport({
  me,
  manages,
  from,
  to,
  person,
  people,
  policy,
  clinics,
  employees,
  rates,
  shifts,
  events,
  spans,
}: {
  me: Profile;
  manages: boolean;
  from: string;
  to: string;
  person: string;
  people: Person[];
  policy: PolicyRow[];
  clinics: { id: number; name: string }[];
  employees: Employee[];
  rates: Rate[];
  shifts: ShiftLike[];
  events: EventLike[];
  spans: SpanLike[];
}) {
  const [view, setView] = useState<"people" | "days" | "clinics">(
    person ? "days" : manages ? "people" : "days"
  );

  const policyMap = useMemo(() => new Map(policy.map((p) => [p.kind, p])), [policy]);
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people]);
  const clinicName = useMemo(() => new Map(clinics.map((c) => [c.id, c.name])), [clinics]);
  const empByProfile = useMemo(
    () => new Map(employees.filter((e) => e.profile_id).map((e) => [e.profile_id as string, e])),
    [employees]
  );

  // One row per shift, then rolled up whichever way is being looked at.
  const days: DayTotals[] = useMemo(
    () => shifts.map((s) => totalsForShift(s, events, policyMap)),
    [shifts, events, policyMap]
  );

  const grand = useMemo(() => days.reduce((a, d) => addTotals(a, d), emptyTotals()), [days]);

  const perPerson = useMemo(() => {
    const m = new Map<string, ReturnType<typeof emptyTotals>>();
    for (const d of days) {
      if (!m.has(d.userId)) m.set(d.userId, emptyTotals());
      addTotals(m.get(d.userId)!, d);
    }
    return Array.from(m.entries())
      .map(([userId, t]) => {
        const emp = empByProfile.get(userId);
        // The rate in force at the END of the range — a range that straddles a
        // rate change is priced at the later rate, and the copy says so.
        const rate = emp ? rateOn(rates, emp.id, to) : null;
        return {
          userId,
          name: nameOf.get(userId) ?? "—",
          ...t,
          rate,
          amount: rate === null ? null : Math.round(decimalHours(t.billable) * rate),
        };
      })
      .sort((a, b) => b.billable - a.billable);
  }, [days, empByProfile, rates, to, nameOf]);

  const perClinic = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of shifts) {
      // Array.from rather than iterating the Map directly — the tsconfig
      // target here does not allow Map iteration without downlevelIteration.
      for (const [clinicId, mins] of Array.from(clinicMinutes(spans, s.id).entries())) {
        m.set(clinicId, (m.get(clinicId) ?? 0) + mins);
      }
    }
    return Array.from(m.entries())
      .map(([clinicId, mins]) => ({
        clinicId,
        name: clinicName.get(clinicId) ?? "—",
        minutes: mins,
      }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [shifts, spans, clinicName]);

  const trackedClinicMinutes = perClinic.reduce((t, c) => t + c.minutes, 0);

  const th = "py-2 text-right font-mono text-[11px] uppercase tracking-wider text-muted";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";

  const billableKinds = policy.filter((p) => p.billable).map((p) => p.label);
  const unbillableKinds = policy.filter((p) => !p.billable).map((p) => p.label);

  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams({ from, to });
    if (person) p.set("person", person);
    for (const [k, v] of Object.entries(over)) v ? p.set(k, v) : p.delete(k);
    return `/hours?${p.toString()}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hours</h1>
          <p className="mt-1 text-sm text-muted">
            {manages
              ? "Time worked across the team, and what of it is billable."
              : "Your own time. Only ops, exec and admin see the whole team."}
          </p>
        </div>

        <form method="get" className="flex flex-wrap items-end gap-2 print:hidden">
          <label className="block">
            <span className="eyebrow">From</span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="mt-1 block rounded border border-hairline px-2 py-1 text-sm"
            />
          </label>
          <label className="block">
            <span className="eyebrow">To</span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="mt-1 block rounded border border-hairline px-2 py-1 text-sm"
            />
          </label>
          {manages && (
            <label className="block">
              <span className="eyebrow">Person</span>
              <select
                name="person"
                defaultValue={person}
                className="mt-1 block rounded border border-hairline px-2 py-1 text-sm"
              >
                <option value="">Everyone</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="rounded bg-accent px-3 py-1.5 text-sm text-white">Show</button>
        </form>
      </div>

      {shifts.length === 0 ? (
        <div className="mt-8">
          <Missing needs="Nobody punched in during this period. Pick a wider range, or check that the people you expect have logins linked to their employee record — an employee without a login cannot use the clock." />
        </div>
      ) : (
        <>
          {/* headline */}
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["On shift", hm(grand.onShift), ""],
              ["Working", hm(grand.working), ""],
              ["Meetings", hm(grand.meeting), "counted as production"],
              ["Personal breaks", hm(grand.personalBreak), ""],
              ["Unavoidable", hm(grand.outage), "outages, failures"],
              ["Billable", hm(grand.billable), `${decimalHours(grand.billable)} h`],
            ].map(([label, value, note], i) => (
              <div
                key={label}
                className={`rounded-card border border-hairline bg-surface px-4 py-3 shadow-card ${
                  i === 5 ? "border-l-4 border-l-accent" : ""
                }`}
              >
                <div className="eyebrow">{label}</div>
                <div className="tnum mt-1 text-lg font-medium">{value}</div>
                {note && <div className="mt-0.5 text-xs text-muted">{note}</div>}
              </div>
            ))}
          </div>

          <p className="mt-3 text-sm text-muted">
            Billable currently means {billableKinds.join(", ").toLowerCase() || "nothing"}
            {unbillableKinds.length
              ? `; ${unbillableKinds.join(" and ").toLowerCase()} ${
                  unbillableKinds.length === 1 ? "is" : "are"
                } excluded`
              : ""}
            .{" "}
            {manages && (
              <Link href="/admin?tab=hours" className="text-accent underline">
                Change what counts
              </Link>
            )}
          </p>

          {/* views */}
          <nav className="mt-8 flex flex-wrap gap-1 border-b border-hairline print:hidden">
            {([
              ["people", "By person"],
              ["days", "By day"],
              ["clinics", "By clinic"],
            ] as const).map(([k, label]) =>
              k === "people" && !manages ? null : (
                <button
                  key={k}
                  onClick={() => setView(k)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                    view === k
                      ? "border-accent font-medium text-ink"
                      : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              )
            )}
          </nav>

          {view === "people" && manages && (
            <section className="mt-4">
              <TableControls
                title={`Hours by person ${from} to ${to}`}
                rows={perPerson}
                note={rates.length ? "amounts use the rate in force at the end of the range" : undefined}
                columns={[
                  { header: "Person", value: (r) => r.name },
                  { header: "Days", value: (r) => r.days },
                  { header: "On shift (h)", value: (r) => decimalHours(r.onShift) },
                  { header: "Working (h)", value: (r) => decimalHours(r.working) },
                  { header: "Meetings (h)", value: (r) => decimalHours(r.meeting) },
                  { header: "Personal break (h)", value: (r) => decimalHours(r.personalBreak) },
                  { header: "Unavoidable (h)", value: (r) => decimalHours(r.outage) },
                  { header: "Billable (h)", value: (r) => decimalHours(r.billable) },
                  { header: "Rate", value: (r) => r.rate ?? "" },
                  { header: "Amount", value: (r) => r.amount ?? "" },
                ]}
              />
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={thL}>Person</th>
                    <th className={th}>Days</th>
                    <th className={th}>On shift</th>
                    <th className={th}>Working</th>
                    <th className={th}>Meetings</th>
                    <th className={th}>Break</th>
                    <th className={th}>Unavoidable</th>
                    <th className={th}>Billable</th>
                    {rates.length > 0 && <th className={th}>Amount</th>}
                  </tr>
                </thead>
                <tbody>
                  {perPerson.map((r) => (
                    <tr key={r.userId} className="border-b border-hairline/60">
                      <td className="py-2">
                        <Link href={link({ person: r.userId })} className="text-accent hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      <td className="tnum py-2 text-right">{r.days}</td>
                      <td className="tnum py-2 text-right">{hm(r.onShift)}</td>
                      <td className="tnum py-2 text-right">{hm(r.working)}</td>
                      <td className="tnum py-2 text-right">{hm(r.meeting)}</td>
                      <td className="tnum py-2 text-right text-muted">{hm(r.personalBreak)}</td>
                      <td className="tnum py-2 text-right text-warn">{hm(r.outage)}</td>
                      <td className="tnum py-2 text-right font-medium">{hm(r.billable)}</td>
                      {rates.length > 0 && (
                        <td className="tnum py-2 text-right">
                          {r.amount === null ? (
                            <span className="text-xs text-muted">no rate</span>
                          ) : (
                            money(r.amount)
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rates.length === 0 && (
                <p className="mt-3 text-xs text-muted">
                  No hourly rates are set, so no amounts are shown. Rates are set per person under
                  Settings → Employees, and are held as a history, so changing one does not re-price
                  a month already invoiced.
                </p>
              )}
            </section>
          )}

          {view === "days" && (
            <section className="mt-4">
              <TableControls
                title={`Hours by day ${from} to ${to}`}
                rows={days}
                columns={[
                  { header: "Date", value: (d) => d.date },
                  { header: "Person", value: (d) => nameOf.get(d.userId) ?? "" },
                  { header: "In", value: (d) => localTime(d.inAt) },
                  { header: "Out", value: (d) => (d.outAt ? localTime(d.outAt) : "still on shift") },
                  { header: "Where", value: (d) => d.location },
                  { header: "On shift (h)", value: (d) => decimalHours(d.onShift) },
                  { header: "Working (h)", value: (d) => decimalHours(d.working) },
                  { header: "Meetings (h)", value: (d) => decimalHours(d.meeting) },
                  { header: "Personal break (h)", value: (d) => decimalHours(d.personalBreak) },
                  { header: "Unavoidable (h)", value: (d) => decimalHours(d.outage) },
                  { header: "Billable (h)", value: (d) => decimalHours(d.billable) },
                  { header: "Reasons given", value: (d) => reasonsFor(events, d.shiftId) },
                ]}
              />
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={thL}>Date</th>
                    {!person && <th className={thL}>Person</th>}
                    <th className={thL}>In</th>
                    <th className={thL}>Out</th>
                    <th className={th}>On shift</th>
                    <th className={th}>Working</th>
                    <th className={th}>Meetings</th>
                    <th className={th}>Break</th>
                    <th className={th}>Unavoidable</th>
                    <th className={th}>Billable</th>
                    <th className={thL}>Reasons given</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.shiftId} className="border-b border-hairline/60">
                      <td className="py-2 whitespace-nowrap">{d.date}</td>
                      {!person && <td className="py-2">{nameOf.get(d.userId) ?? "—"}</td>}
                      <td className="py-2">{localTime(d.inAt)}</td>
                      <td className="py-2">
                        {d.outAt ? (
                          localTime(d.outAt)
                        ) : (
                          <span className="text-xs text-good">on shift</span>
                        )}
                      </td>
                      <td className="tnum py-2 text-right">{hm(d.onShift)}</td>
                      <td className="tnum py-2 text-right">{hm(d.working)}</td>
                      <td className="tnum py-2 text-right">{hm(d.meeting)}</td>
                      <td className="tnum py-2 text-right text-muted">{hm(d.personalBreak)}</td>
                      <td className="tnum py-2 text-right text-warn">{hm(d.outage)}</td>
                      <td className="tnum py-2 text-right font-medium">{hm(d.billable)}</td>
                      <td className="py-2 pl-4 text-xs text-muted">{reasonsFor(events, d.shiftId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted">
                Reasons are what the person typed when they started an outage or a meeting. A blank
                one is not an error — it means nothing was written down, which is itself worth
                seeing when an outage is being charged for.
              </p>
            </section>
          )}

          {view === "clinics" && (
            <section className="mt-4">
              {perClinic.length === 0 ? (
                <Missing needs="No clinic was set on any shift in this period. Use the clinic button on the clock to start on a clinic and to switch during the day — until that is used, hours cannot be split by clinic." />
              ) : (
                <>
                  <TableControls
                    title={`Hours by clinic ${from} to ${to}`}
                    rows={perClinic}
                    columns={[
                      { header: "Clinic", value: (c) => c.name },
                      { header: "Hours", value: (c) => decimalHours(c.minutes) },
                      {
                        header: "Share of tracked",
                        value: (c) =>
                          trackedClinicMinutes
                            ? Math.round((c.minutes / trackedClinicMinutes) * 1000) / 10
                            : 0,
                      },
                    ]}
                  />
                  <table className="mt-3 w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline">
                        <th className={thL}>Clinic</th>
                        <th className={th}>Hours</th>
                        <th className={th}>Share</th>
                        <th className={thL} />
                      </tr>
                    </thead>
                    <tbody>
                      {perClinic.map((c) => (
                        <tr key={c.clinicId} className="border-b border-hairline/60">
                          <td className="py-2">
                            <Link href={`/clinics/${c.clinicId}`} className="text-accent hover:underline">
                              {c.name}
                            </Link>
                          </td>
                          <td className="tnum py-2 text-right">{hm(c.minutes)}</td>
                          <td className="tnum py-2 text-right text-muted">
                            {trackedClinicMinutes
                              ? ((c.minutes / trackedClinicMinutes) * 100).toFixed(1)
                              : 0}
                            %
                          </td>
                          <td className="w-1/3 py-2 pl-4">
                            <div className="h-2 rounded bg-canvas">
                              <div
                                className="h-2 rounded bg-accent/60"
                                style={{
                                  width: `${
                                    perClinic[0].minutes
                                      ? (c.minutes / perClinic[0].minutes) * 100
                                      : 0
                                  }%`,
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs text-muted">
                    {hm(trackedClinicMinutes)} of {hm(grand.onShift)} on shift is attributed to a
                    clinic. The rest was worked without a clinic set — that gap is not an error, it is
                    time nobody said belonged anywhere.
                  </p>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
