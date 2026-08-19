/**
 * Turning punches into hours.
 *
 * Kept as pure functions with no database in sight, because these are the
 * numbers Momentum bills on. They have to be checkable by reading them, and
 * testable without a login.
 *
 * THE MODEL
 *   on shift        = punch-out (or now) minus punch-in
 *   meeting         = production, per Pravin — never a deduction
 *   personal break  = the employee's own break
 *   outage          = unavoidable: network down, system failure
 *   working         = on shift, minus every event span
 *
 * Which of those is billable is NOT decided here. It comes from the
 * time_policy table, which the admin controls. Hard-coding it would mean a
 * developer is needed the day the policy changes.
 */

export type PolicyRow = { kind: string; label: string; billable: boolean; productive: boolean };

export type ShiftLike = {
  id: number;
  user_id: string;
  business_date: string;
  punched_in_at: string;
  punched_out_at: string | null;
  work_location: string;
};

export type EventLike = {
  shift_id: number;
  kind: string;
  started_at: string;
  ended_at: string | null;
  note?: string | null;
};

/**
 * What was said about a day's outages and meetings, as one readable line.
 * A recorded reason nobody can find is the same as no reason at all, so the
 * note travels all the way to the report and the export.
 */
export function reasonsFor(events: EventLike[], shiftId: number) {
  return events
    .filter((e) => e.shift_id === shiftId && e.note && e.kind !== "break")
    .map((e) => `${e.kind === "outage" ? "Outage" : "Meeting"}: ${e.note}`)
    .join(" · ");
}

export type SpanLike = {
  shift_id: number;
  clinic_id: number;
  started_at: string;
  ended_at: string | null;
};

export type DayTotals = {
  shiftId: number;
  userId: string;
  date: string;
  location: string;
  inAt: string;
  outAt: string | null;
  onShift: number; // minutes
  meeting: number;
  personalBreak: number;
  outage: number;
  working: number; // on shift minus every event
  billable: number;
  open: boolean; // still on shift
};

const MIN = 60_000;

/** Minutes between two instants, floored at zero. An open span runs to now. */
export function minutesOf(from: string, to: string | null, now = Date.now()) {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : now;
  return Math.max(0, Math.round((end - start) / MIN));
}

/** Minutes as `7h 25m`, or `—` for nothing. Never a bare decimal: nobody reads 7.42 as hours. */
export function hm(mins: number) {
  if (!mins) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m ? `${m}m` : ""}`.trim() : `${m}m`;
}

/** Decimal hours to two places — what a spreadsheet and an invoice want. */
export function decimalHours(mins: number) {
  return Math.round((mins / 60) * 100) / 100;
}

/**
 * One day, one person. Events are subtracted from the shift; whether each
 * kind is then added back as billable comes from the policy.
 */
export function totalsForShift(
  shift: ShiftLike,
  events: EventLike[],
  policy: Map<string, PolicyRow>,
  now = Date.now()
): DayTotals {
  const mine = events.filter((e) => e.shift_id === shift.id);

  const onShift = minutesOf(shift.punched_in_at, shift.punched_out_at, now);
  const sum = (kind: string) =>
    mine.filter((e) => e.kind === kind).reduce((t, e) => t + minutesOf(e.started_at, e.ended_at, now), 0);

  const meeting = sum("meeting");
  const personalBreak = sum("break");
  const outage = sum("outage");

  // Everything not inside an event span.
  const working = Math.max(0, onShift - meeting - personalBreak - outage);

  const bill = (kind: string) => policy.get(kind)?.billable ?? false;
  const billable =
    (bill("work") ? working : 0) +
    (bill("meeting") ? meeting : 0) +
    (bill("outage") ? outage : 0) +
    (bill("break") ? personalBreak : 0);

  return {
    shiftId: shift.id,
    userId: shift.user_id,
    date: shift.business_date,
    location: shift.work_location,
    inAt: shift.punched_in_at,
    outAt: shift.punched_out_at,
    onShift,
    meeting,
    personalBreak,
    outage,
    working,
    billable,
    open: !shift.punched_out_at,
  };
}

export function emptyTotals() {
  return { onShift: 0, meeting: 0, personalBreak: 0, outage: 0, working: 0, billable: 0, days: 0 };
}

export function addTotals(a: ReturnType<typeof emptyTotals>, d: DayTotals) {
  a.onShift += d.onShift;
  a.meeting += d.meeting;
  a.personalBreak += d.personalBreak;
  a.outage += d.outage;
  a.working += d.working;
  a.billable += d.billable;
  a.days += 1;
  return a;
}

/**
 * The hourly rate in force on a given date: the latest rate that started on or
 * before it. A raise in April must not silently re-price March.
 */
export function rateOn(
  rates: { employee_id: number; hourly_rate: number; effective_from: string }[],
  employeeId: number,
  date: string
): number | null {
  const applicable = rates
    .filter((r) => r.employee_id === employeeId && r.effective_from <= date)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return applicable.length ? Number(applicable[0].hourly_rate) : null;
}

/** Minutes per clinic for one shift, from the clinic spans. */
export function clinicMinutes(spans: SpanLike[], shiftId: number, now = Date.now()) {
  const out = new Map<number, number>();
  for (const s of spans) {
    if (s.shift_id !== shiftId) continue;
    out.set(s.clinic_id, (out.get(s.clinic_id) ?? 0) + minutesOf(s.started_at, s.ended_at, now));
  }
  return out;
}

/** Inclusive list of business dates between two, as YYYY-MM-DD. */
export function dateRange(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
