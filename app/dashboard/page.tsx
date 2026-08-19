import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import Panel from "@/components/Panel";
import ExportButtons from "@/components/ExportButtons";
import Missing from "@/components/Missing";
import type { Profile } from "@/lib/types";
import { manages } from "@/lib/types";
import { businessToday } from "@/lib/businessDate";
import RegionClocks from "@/components/RegionClocks";
import DashboardFilters from "./DashboardFilters";
import { regionsFromLabels } from "@/lib/regions";
import { fetchAllRows } from "@/lib/fetchAll";

export const dynamic = "force-dynamic";

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const plain = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US");

const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

const pct = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);

/** Change between two figures, phrased for A/R where up is bad. */
function delta(now: number, before: number) {
  const diff = now - before;
  const share = before === 0 ? 0 : (diff / before) * 100;
  return { diff, share, up: diff > 0 };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { clinic?: string | string[]; from?: string; to?: string };
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

  const { data: clinicRows } = await supabase
    .from("clinics")
    .select("id, name, status")
    .order("name");
  const clinics = (clinicRows ?? []) as { id: number; name: string; status: string }[];
  const activeIds = clinics.filter((c) => c.status === "active").map((c) => c.id);

  // One clinic or several. Empty means every active clinic.
  const picked = (
    Array.isArray(searchParams.clinic)
      ? searchParams.clinic
      : searchParams.clinic
        ? [searchParams.clinic]
        : []
  )
    .map(Number)
    .filter((n) => Number.isFinite(n));

  const scopeIds = picked.length ? picked : activeIds;
  const scopeLabel =
    picked.length === 0
      ? `all ${activeIds.length} active clinics`
      : picked.length === 1
        ? clinics.find((c) => c.id === picked[0])?.name ?? "—"
        : `${picked.length} clinics`;
  const chosen = picked.length === 1 ? picked[0] : null;

  // ---- activity, aggregated per clinic per month -------------------------
  // The month list comes first and on its own, so the figures query below
  // asks only for the months actually being shown. Reading a decade of
  // clinic x month x financial-class rows and summing them here is what a
  // roll-up view is for, and it is what put this panel past Supabase's
  // 1,000-row response cap.
  const { data: monthListRows } = await supabase
    .from("activity_month_list")
    .select("period_month")
    .order("period_month");

  const months = (monthListRows ?? []).map((r) => (r.period_month as string).slice(0, 7));
  const latest = months[months.length - 1];

  // The period being looked at. Defaults to the latest single month.
  const to = searchParams.to && months.includes(searchParams.to) ? searchParams.to : latest;
  const from = searchParams.from && months.includes(searchParams.from) && searchParams.from <= to
    ? searchParams.from
    : to;

  const inRange = months.filter((m) => m >= from && m <= to);
  const spanLength = inRange.length;

  // The comparison is the SAME NUMBER OF MONTHS immediately before, so a
  // three-month window is compared against three months, not against one.
  const beforeRange = months.filter((m) => m < from).slice(-spanLength);

  // Alerts always judge the latest month against the three before it, so
  // those are fetched even when the window being viewed is older.
  const alertWindow = months.slice(-4);
  const wanted = Array.from(new Set([...inRange, ...beforeRange, ...alertWindow])).sort();

  type Agg = { charges: number; payments: number; adjustments: number; visits: number };
  const perClinicMonth = new Map<string, Agg>(); // `${clinic}|${month}`
  const perMonth = new Map<string, Agg>();

  if (wanted.length && scopeIds.length) {
    const { rows: actRows } = await fetchAllRows<{
      clinic_id: number;
      period_month: string;
      charges: number | null;
      payments: number | null;
      adjustments: number | null;
      visits: number | null;
    }>((lo, hi) =>
      supabase
        .from("activity_clinic_month")
        .select("clinic_id, period_month, charges, payments, adjustments, visits")
        .in("clinic_id", scopeIds)
        .gte("period_month", `${wanted[0]}-01`)
        .lte("period_month", `${wanted[wanted.length - 1]}-01`)
        .order("period_month")
        .order("clinic_id")
        .range(lo, hi)
    );

    for (const r of actRows) {
      const m = r.period_month.slice(0, 7);
      const add = (map: Map<string, Agg>, key: string) => {
        const a = map.get(key) ?? { charges: 0, payments: 0, adjustments: 0, visits: 0 };
        a.charges += r.charges ?? 0;
        a.payments += r.payments ?? 0;
        a.adjustments += r.adjustments ?? 0;
        a.visits += r.visits ?? 0;
        map.set(key, a);
      };
      add(perClinicMonth, `${r.clinic_id}|${m}`);
      add(perMonth, m);
    }
  }

  // Whether the chosen clinics have any figures at all in the chosen window.
  // Without this the panel prints zeros for a clinic that simply has not been
  // imported, which reads as "they billed nothing" rather than "nothing here".
  const haveRange = inRange.some((m) => perMonth.has(m));
  const havePrior = beforeRange.some((m) => perMonth.has(m));

  const sumOf = (list: string[]): Agg =>
    list.reduce(
      (a, m) => {
        const v = perMonth.get(m);
        if (v) {
          a.charges += v.charges;
          a.payments += v.payments;
          a.adjustments += v.adjustments;
          a.visits += v.visits;
        }
        return a;
      },
      { charges: 0, payments: 0, adjustments: 0, visits: 0 }
    );

  const cur = inRange.length && haveRange ? sumOf(inRange) : null;
  const prev =
    beforeRange.length === spanLength && spanLength > 0 && havePrior ? sumOf(beforeRange) : null;
  const prior = beforeRange.length ? `${beforeRange[0]} – ${beforeRange[beforeRange.length - 1]}` : null;
  const periodLabel = from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`;
  const priorLabel =
    beforeRange.length === 0
      ? "Prior"
      : beforeRange.length === 1
        ? monthLabel(beforeRange[0])
        : `${monthLabel(beforeRange[0])} – ${monthLabel(beforeRange[beforeRange.length - 1])}`;

  // ---- 120+ position ----------------------------------------------------
  // Only the latest month and the one before it are shown, so only those two
  // are fetched — again through the roll-up rather than every financial-class
  // row for every month.
  const { data: arMonthRows } = await supabase
    .from("ar_month_list")
    .select("period_month")
    .order("period_month");

  const arMonths = (arMonthRows ?? []).map((r) => (r.period_month as string).slice(0, 7));
  const arLatest = arMonths[arMonths.length - 1];
  const arPrior = arMonths[arMonths.length - 2];

  const arByMonth = new Map<string, { total: number; over120: number }>();
  const arByClinicLatest = new Map<number, { total: number; over120: number }>();

  if (arLatest && scopeIds.length) {
    const twoMonths = [arLatest, arPrior].filter(Boolean).map((m) => `${m}-01`);

    const { rows: arRows } = await fetchAllRows<{
      clinic_id: number;
      period_month: string;
      closing_ar: number | null;
      bucket_120_plus: number | null;
    }>((lo, hi) =>
      supabase
        .from("ar_clinic_month")
        .select("clinic_id, period_month, closing_ar, bucket_120_plus")
        .in("clinic_id", scopeIds)
        .in("period_month", twoMonths)
        .order("period_month")
        .order("clinic_id")
        .range(lo, hi)
    );

    for (const r of arRows) {
      const m = r.period_month.slice(0, 7);
      const a = arByMonth.get(m) ?? { total: 0, over120: 0 };
      a.total += r.closing_ar ?? 0;
      a.over120 += r.bucket_120_plus ?? 0;
      arByMonth.set(m, a);

      if (m === arLatest) {
        const b = arByClinicLatest.get(r.clinic_id) ?? { total: 0, over120: 0 };
        b.total += r.closing_ar ?? 0;
        b.over120 += r.bucket_120_plus ?? 0;
        arByClinicLatest.set(r.clinic_id, b);
      }
    }
  }

  const arCur = arLatest ? arByMonth.get(arLatest) ?? null : null;
  const arPrev = arPrior ? arByMonth.get(arPrior) ?? null : null;

  const worst120 = Array.from(arByClinicLatest.entries())
    .map(([id, v]) => ({
      id,
      name: clinics.find((c) => c.id === id)?.name ?? "—",
      over120: v.over120,
      total: v.total,
      share: pct(v.over120, v.total),
    }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.over120 - a.over120)
    .slice(0, 10);

  // ---- collection actions ----------------------------------------------
  const { rows: actionRows } = scopeIds.length
    ? await fetchAllRows<{
        clinic_id: number;
        period_month: string;
        collector_id: number | null;
        action_count: number | null;
      }>((lo, hi) =>
        supabase
          .from("collection_actions_monthly")
          .select("clinic_id, period_month, collector_id, action_count")
          .in("clinic_id", scopeIds)
          .order("period_month")
          .order("clinic_id")
          .range(lo, hi)
      )
    : { rows: [] };

  const actionMonths = Array.from(
    new Set((actionRows ?? []).map((r) => (r.period_month as string).slice(0, 7)))
  ).sort();
  const actionLatest = actionMonths[actionMonths.length - 1];
  const thisMonthActions = (actionRows ?? []).filter(
    (r) => (r.period_month as string).slice(0, 7) === actionLatest
  );
  const totalActions = thisMonthActions.reduce((a, r) => a + ((r.action_count as number) ?? 0), 0);
  const collectorCount = new Set(thisMonthActions.map((r) => r.collector_id)).size;

  // ---- alerts: a clinic well below its own recent average ---------------
  // Compares the latest month against the mean of the three before it, per
  // clinic. Its own history, not a benchmark — clinics differ too much for a
  // shared threshold to mean anything.
  type Alert = { clinic: string; metric: string; now: number; usual: number; drop: number };
  const alerts: Alert[] = [];

  if (latest) {
    for (const c of clinics) {
      if (!scopeIds.includes(c.id)) continue;
      const hist = months
        .filter((m) => m < latest)
        .slice(-3)
        .map((m) => perClinicMonth.get(`${c.id}|${m}`))
        .filter(Boolean) as Agg[];
      if (hist.length < 2) continue;

      const now = perClinicMonth.get(`${c.id}|${latest}`);
      if (!now) continue;

      for (const [metric, key] of [
        ["Charges", "charges"],
        ["Payments", "payments"],
        ["Visits", "visits"],
      ] as const) {
        const usual = hist.reduce((a, h) => a + h[key], 0) / hist.length;
        if (usual <= 0) continue;
        const drop = ((usual - now[key]) / usual) * 100;
        if (drop >= 10) {
          alerts.push({ clinic: c.name, metric, now: now[key], usual, drop });
        }
      }
    }
  }
  alerts.sort((a, b) => b.drop - a.drop);

  // ---- staff, today ------------------------------------------------------
  const bizToday = businessToday();
  const [{ data: staffRows }, { data: todayShifts }, { data: todayLeave }] = await Promise.all([
    supabase.from("profiles").select("id").eq("is_active", true),
    supabase.from("work_shifts").select("user_id, work_location").eq("business_date", bizToday),
    supabase.from("leave_days").select("user_id").eq("leave_date", bizToday).eq("status", "approved"),
  ]);
  const staffTotal = (staffRows ?? []).length;
  const staffPresent = (todayShifts ?? []).length;
  const staffHome = (todayShifts ?? []).filter((s) => s.work_location === "home").length;
  const staffLeave = (todayLeave ?? []).length;

  // Clocks for wherever the team actually sits, taken from the employee
  // records rather than hardcoded.
  const { data: regionRows } = await supabase.from("employees").select("region").neq("status", "left");
  const regions = regionsFromLabels((regionRows ?? []).map((r) => r.region as string | null));

  // ---- tasks and flags ---------------------------------------------------
  const todayIso = new Date().toISOString().slice(0, 10);
  const [{ data: taskRows }, { data: flagRows }] = await Promise.all([
    supabase.from("tasks").select("assigned_to, created_by, due_on, status"),
    supabase.from("clinic_flags").select("id").eq("status", "open"),
  ]);
  const openTasks = (taskRows ?? []).filter(
    (t) => !["done", "cancelled"].includes(t.status as string)
  );
  const inwardOpen = openTasks.filter((t) => t.assigned_to === profile?.id).length;
  const outwardOpen = openTasks.filter(
    (t) => t.created_by === profile?.id && t.assigned_to !== profile?.id
  ).length;
  const overdueCount = openTasks.filter(
    (t) => t.due_on && (t.due_on as string) < todayIso
  ).length;
  const openFlagCount = (flagRows ?? []).length;

  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";
  const thR = "py-2 text-right font-mono text-[11px] uppercase tracking-wider text-muted";

  const statRow = (label: string, key: keyof Agg, fmt: (n: number) => string) => {
    if (!cur) return null;
    const d = prev ? delta(cur[key], prev[key]) : null;
    return (
      <tr key={label} className="border-b border-hairline/60">
        <td className="py-2">
          {/* Every figure opens the clinics behind it. A number with nowhere
              to go is a report; one you can open is a tool. */}
          <Link
            href={`/dashboard/breakdown?measure=${key}&from=${from}&to=${to}${picked
              .map((id) => `&clinic=${id}`)
              .join("")}`}
            className="hover:text-accent hover:underline"
          >
            {label}
          </Link>
        </td>
        <td className="tnum py-2 text-right">{prev ? fmt(prev[key]) : "—"}</td>
        <td className="tnum py-2 text-right font-medium">{fmt(cur[key])}</td>
        <td className={`tnum py-2 text-right ${d && d.up ? "text-good" : "text-bad"}`}>
          {d ? `${d.up ? "+" : ""}${d.share.toFixed(1)}%` : "—"}
        </td>
      </tr>
    );
  };

  return (
    <>
      <AppHeader profile={profile} />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Good {new Date().getHours() < 12 ? "morning" : "afternoon"}
              {profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {latest ? `${periodLabel} · ${scopeLabel}` : "Nothing imported yet"}
            </p>
          </div>

          {months.length > 0 && (
            <DashboardFilters
              clinics={clinics}
              selected={picked}
              months={months}
              from={from}
              to={to}
            />
          )}
        </div>

        {!latest ? (
          <div className="mt-8 rounded-card border border-dashed border-hairline bg-surface p-10 text-center">
            <h2 className="text-lg font-medium">Nothing imported yet</h2>
            <p className="mt-2 text-sm text-muted">This dashboard fills in once a month is loaded.</p>
            {manages(profile?.role) && (
              <Link href="/import" className="mt-5 inline-block rounded bg-accent px-4 py-2 text-sm text-white">
                Import a month
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <Panel id="clocks" title="Where everyone is" subtitle="working hours shown in green">
              <RegionClocks regions={regions} />
            </Panel>

            {/* 1 — clinic stats */}
            <Panel
              id="stats"
              title="Clinic activity"
              subtitle={scopeLabel}
              right={
                <span className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted">{periodLabel}</span>
                  <ExportButtons
                    title={`Clinic activity ${from} to ${to}`}
                    headers={["Measure", periodLabel.split(" \u2013 ")[0] || "Previous", "Current", "Change %"]}
                    rows={
                      cur
                        ? [
                            ["Charges", prev?.charges ?? null, cur.charges, prev ? Math.round(delta(cur.charges, prev.charges).share * 10) / 10 : null],
                            ["Payments", prev?.payments ?? null, cur.payments, prev ? Math.round(delta(cur.payments, prev.payments).share * 10) / 10 : null],
                            ["Adjustments", prev?.adjustments ?? null, cur.adjustments, prev ? Math.round(delta(cur.adjustments, prev.adjustments).share * 10) / 10 : null],
                            ["Visits", prev?.visits ?? null, cur.visits, prev ? Math.round(delta(cur.visits, prev.visits).share * 10) / 10 : null],
                          ]
                        : []
                    }
                  />
                </span>
              }
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={thL}></th>
                    <th className={thR}>{priorLabel}</th>
                    <th className={thR}>{periodLabel}</th>
                    <th className={thR}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {statRow("Charges", "charges", money)}
                  {statRow("Payments", "payments", money)}
                  {statRow("Adjustments", "adjustments", money)}
                  {statRow("Visits", "visits", plain)}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted">
                {spanLength > 1
                  ? `Totalled across ${spanLength} months, compared against the ${spanLength} months before.`
                  : "Month-end figures, compared against the previous month."}{" "}
                <strong>Current-day totals are not available</strong> — everything
                here comes from the monthly packs, and a live figure needs the direct AdvancedMD
                connection.
              </p>
            </Panel>

            {/* 2 — A/R actions */}
            <Panel
              id="actions"
              title="A/R actions"
              subtitle={actionLatest ? monthLabel(actionLatest) : undefined}
              right={
                totalActions > 0 ? (
                  <Link href="/actions" className="text-xs text-accent hover:underline print:hidden">
                    Open the report →
                  </Link>
                ) : undefined
              }
            >
              {totalActions === 0 ? (
                <Missing needs="No collection action report imported yet. Once one is, this shows actions worked, how many collectors worked them, and the average each." />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded border border-hairline p-3">
                      <div className={thL}>Actions</div>
                      <div className="tnum mt-1 text-xl font-medium">{plain(totalActions)}</div>
                    </div>
                    <div className="rounded border border-hairline p-3">
                      <div className={thL}>Collectors</div>
                      <div className="tnum mt-1 text-xl font-medium">{plain(collectorCount)}</div>
                    </div>
                    <div className="rounded border border-hairline p-3">
                      <div className={thL}>Average each</div>
                      <div className="tnum mt-1 text-xl font-medium">
                        {collectorCount ? plain(Math.round(totalActions / collectorCount)) : "—"}
                      </div>
                    </div>
                    <div className="rounded border border-dashed border-hairline p-3">
                      <div className={thL}>Amount</div>
                      <div className="mt-1 text-xs text-muted">
                        Not in the source — the action report has counts, no dollars.
                      </div>
                    </div>
                  </div>
                </>
              )}
            </Panel>

            {/* 3 — staff */}
            <Panel id="staff" title="Staff" subtitle="today">
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ["Total", staffTotal, ""],
                  ["Present", staffPresent, ""],
                  ["At home", staffHome, "text-muted"],
                  ["On leave", staffLeave, ""],
                ].map(([label, value, tone]) => (
                  <div key={label as string} className="rounded border border-hairline p-3">
                    <div className={thL}>{label as string}</div>
                    <div className={`tnum mt-1 text-xl font-medium ${tone as string}`}>{value as number}</div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">
                <Link href="/people" className="text-accent hover:underline">
                  Who worked today
                </Link>{" "}
                — punch times, breaks and meetings.
              </p>
            </Panel>

            {/* 4 — tasks */}
            <Panel id="tasks" title="Tasks and reminders">
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ["Inward", inwardOpen, "assigned to you"],
                  ["Outward", outwardOpen, "you assigned"],
                  ["Overdue", overdueCount, "past their date"],
                  ["Flagged clinics", openFlagCount, "needing attention"],
                ].map(([label, value, note]) => (
                  <div key={label as string} className="rounded border border-hairline p-3">
                    <div className={thL}>{label as string}</div>
                    <div
                      className={`tnum mt-1 text-xl font-medium ${
                        label === "Overdue" && (value as number) > 0 ? "text-bad" : ""
                      }`}
                    >
                      {value as number}
                    </div>
                    <div className="text-xs text-muted">{note as string}</div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">
                <Link href="/tasks" className="text-accent hover:underline">
                  Open tasks and flags
                </Link>
              </p>
            </Panel>

            {/* 5 — alerts */}
            <Panel
              id="alerts"
              title="Alerts"
              subtitle={`${alerts.length} ${alerts.length === 1 ? "clinic" : "clinics"} below their usual numbers`}
            >
              {months.length < 3 ? (
                <Missing needs="At least three months of history are needed before a clinic can be compared against its own usual numbers. Import more months and this fills in." />
              ) : alerts.length === 0 ? (
                <p className="text-sm text-good">
                  Nothing more than 10% below its recent average this month.
                </p>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline">
                        <th className={thL}>Clinic</th>
                        <th className={thL}>Metric</th>
                        <th className={thR}>Usual</th>
                        <th className={thR}>{monthLabel(latest)}</th>
                        <th className={thR}>Down</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.map((a, i) => (
                        <tr key={i} className="border-b border-hairline/60">
                          <td className="py-2">{a.clinic}</td>
                          <td className="py-2 text-muted">{a.metric}</td>
                          <td className="tnum py-2 text-right text-muted">
                            {a.metric === "Visits" ? plain(Math.round(a.usual)) : money(a.usual)}
                          </td>
                          <td className="tnum py-2 text-right">
                            {a.metric === "Visits" ? plain(a.now) : money(a.now)}
                          </td>
                          <td
                            className={`tnum py-2 text-right font-medium ${
                              a.drop >= 25 ? "text-bad" : "text-warn"
                            }`}
                          >
                            {a.drop.toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs text-muted">
                    Each clinic is compared against the mean of its own previous three months, not
                    against other clinics — they differ too much for a shared benchmark to mean
                    anything. Red at 25% or worse.
                  </p>
                </>
              )}
            </Panel>

            {/* 6 — 120+ */}
            <Panel
              id="over120"
              title="Over 120 days"
              subtitle={arLatest ? monthLabel(arLatest) : undefined}
              right={
                <ExportButtons
                  title={`Over 120 days ${arLatest ?? ""}`}
                  headers={["Clinic", "Over 120", "Total A/R", "120+ share %"]}
                  rows={worst120.map((w) => [
                    w.name,
                    w.over120,
                    w.total,
                    w.total ? Math.round((w.over120 / w.total) * 1000) / 10 : 0,
                  ])}
                />
              }
            >
              {!arCur ? (
                <Missing needs="No A/R aging imported yet." />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-card border border-hairline border-l-4 border-l-age120 bg-age120/[0.04] p-3">
                      <div className={thL}>Over 120 days</div>
                      <div className="tnum mt-1 text-xl font-medium text-age120">{money(arCur.over120)}</div>
                    </div>
                    <div className="rounded-card border border-hairline p-3">
                      <div className={thL}>Share of all A/R</div>
                      <div className="tnum mt-1 text-xl font-medium">
                        {pct(arCur.over120, arCur.total).toFixed(1)}%
                      </div>
                    </div>
                    <div className="rounded-card border border-hairline p-3">
                      <div className={thL}>
                        {arPrior ? `Against ${monthLabel(arPrior)}` : "Change"}
                      </div>
                      {arPrev ? (
                        (() => {
                          const d = delta(arCur.over120, arPrev.over120);
                          return (
                            <div className={`tnum mt-1 text-xl font-medium ${d.up ? "text-bad" : "text-good"}`}>
                              {d.up ? "+" : ""}
                              {money(d.diff)}
                              <span className="ml-2 text-sm font-normal">
                                ({d.up ? "+" : ""}
                                {d.share.toFixed(1)}%)
                              </span>
                            </div>
                          );
                        })()
                      ) : (
                        <div className="mt-1 text-xs text-muted">Only one month loaded.</div>
                      )}
                    </div>
                  </div>

                  {worst120.length > 0 && !chosen && (
                    <>
                      <h3 className={`${thL} mt-6`}>Clinics carrying the most</h3>
                      <div className="mt-2 space-y-2">
                        {worst120.map((c) => (
                          <div key={c.id} className="flex items-center gap-3 text-sm">
                            <Link
                              href={`/clinics/${c.id}`}
                              className="w-44 shrink-0 truncate text-accent hover:underline"
                            >
                              {c.name}
                            </Link>
                            <div className="h-4 flex-1 overflow-hidden rounded-sm bg-canvas">
                              <div
                                className="h-full bg-age120/70"
                                style={{
                                  width: `${
                                    worst120[0].over120 > 0
                                      ? (c.over120 / worst120[0].over120) * 100
                                      : 0
                                  }%`,
                                }}
                              />
                            </div>
                            <div className="tnum w-28 shrink-0 text-right">{money(c.over120)}</div>
                            <div className="tnum w-14 shrink-0 text-right text-muted">
                              {c.share.toFixed(0)}%
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-xs text-muted">
                        Bars are relative to the largest. The percentage is how much of that
                        clinic&apos;s own balance is over 120 days.
                      </p>
                    </>
                  )}
                </>
              )}
            </Panel>
          </div>
        )}
      </main>
    </>
  );
}
