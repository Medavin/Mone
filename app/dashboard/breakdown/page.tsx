import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import ExportButtons from "@/components/ExportButtons";
import { fetchAllRows } from "@/lib/fetchAll";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * What is behind a number on the dashboard.
 *
 * A figure with nowhere to go is a report; a figure you can open is a tool.
 * "Charges 646,675, down 12%" is the beginning of a question, not the end of
 * one — the useful next words are always "which clinics", and until now
 * answering that meant opening thirty-eight pages.
 */

const MEASURES = {
  charges: { label: "Charges", money: true },
  payments: { label: "Payments", money: true },
  adjustments: { label: "Adjustments", money: true },
  visits: { label: "Visits", money: false },
} as const;

type MeasureKey = keyof typeof MEASURES;

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const plain = (n: number) => Math.round(n).toLocaleString("en-US");

const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export default async function BreakdownPage({
  searchParams,
}: {
  searchParams: { measure?: string; from?: string; to?: string; clinic?: string | string[] };
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

  const measure: MeasureKey =
    searchParams.measure && searchParams.measure in MEASURES
      ? (searchParams.measure as MeasureKey)
      : "charges";
  const meta = MEASURES[measure];
  const fmt = meta.money ? money : plain;

  const { data: clinicRows } = await supabase.from("clinics").select("id, name, status").order("name");
  const clinics = (clinicRows ?? []) as { id: number; name: string; status: string }[];

  const picked = searchParams.clinic
    ? (Array.isArray(searchParams.clinic) ? searchParams.clinic : [searchParams.clinic]).map(Number)
    : [];
  const scopeIds = picked.length
    ? picked
    : clinics.filter((c) => c.status === "active").map((c) => c.id);

  const { data: monthRows } = await supabase
    .from("activity_month_list")
    .select("period_month")
    .order("period_month");
  const months = ((monthRows ?? []) as { period_month: string }[]).map((r) =>
    r.period_month.slice(0, 7)
  );

  const latest = months[months.length - 1];
  const to = searchParams.to && months.includes(searchParams.to) ? searchParams.to : latest;
  const from =
    searchParams.from && months.includes(searchParams.from) && searchParams.from <= to
      ? searchParams.from
      : to;

  const inRange = months.filter((m) => m >= from && m <= to);
  const beforeRange = months.filter((m) => m < from).slice(-inRange.length);
  const wanted = [...beforeRange, ...inRange];

  type Row = {
    clinic_id: number;
    period_month: string;
    charges: number | null;
    payments: number | null;
    adjustments: number | null;
    visits: number | null;
  };

  let rows: Row[] = [];
  if (wanted.length && scopeIds.length) {
    const res = await fetchAllRows<Row>((lo, hi) =>
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
    rows = res.rows;
  }

  const sumFor = (clinicId: number, monthList: string[]) =>
    rows
      .filter((r) => r.clinic_id === clinicId && monthList.includes(r.period_month.slice(0, 7)))
      .reduce((t, r) => t + (r[measure] ?? 0), 0);

  const perClinic = clinics
    .filter((c) => scopeIds.includes(c.id))
    .map((c) => {
      const now = sumFor(c.id, inRange);
      const before = beforeRange.length ? sumFor(c.id, beforeRange) : null;
      return {
        id: c.id,
        name: c.name,
        now,
        before,
        change: before ? ((now - before) / before) * 100 : null,
        touched: rows.some((r) => r.clinic_id === c.id && inRange.includes(r.period_month.slice(0, 7))),
      };
    })
    .filter((c) => c.touched)
    .sort((a, b) => b.now - a.now);

  const total = perClinic.reduce((t, c) => t + c.now, 0);
  const biggest = perClinic[0]?.now ?? 0;

  // The movers, which is usually the reason somebody opened this at all.
  const movers = perClinic
    .filter((c) => c.change !== null && Math.abs(c.change) >= 10 && (c.before ?? 0) > 0)
    .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))
    .slice(0, 5);

  const periodLabel =
    inRange.length > 1 ? `${monthLabel(from)} – ${monthLabel(to)}` : monthLabel(to ?? "");

  const backParams = new URLSearchParams();
  if (from) backParams.set("from", from);
  if (to) backParams.set("to", to);
  for (const id of picked) backParams.append("clinic", String(id));

  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";
  const thR = "py-2 text-right font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Link href={`/dashboard?${backParams.toString()}`} className="text-sm text-accent hover:underline print:hidden">
          ← Portfolio
        </Link>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{meta.label} by clinic</h1>
            <p className="mt-1 text-sm text-muted">
              {periodLabel}
              {beforeRange.length ? ` · compared against the ${beforeRange.length} month${beforeRange.length === 1 ? "" : "s"} before` : ""}
            </p>
          </div>
          <ExportButtons
            title={`${meta.label} by clinic ${from} to ${to}`}
            headers={["Clinic", `${meta.label} (current)`, `${meta.label} (prior)`, "Change %", "Share %"]}
            rows={perClinic.map((c) => [
              c.name,
              c.now,
              c.before,
              c.change === null ? null : Math.round(c.change * 10) / 10,
              total ? Math.round((c.now / total) * 1000) / 10 : 0,
            ])}
          />
        </div>

        {/* switch measure without going back */}
        <nav className="mt-4 flex flex-wrap gap-1 border-b border-hairline print:hidden">
          {(Object.keys(MEASURES) as MeasureKey[]).map((k) => {
            const p = new URLSearchParams(backParams);
            p.set("measure", k);
            return (
              <Link
                key={k}
                href={`/dashboard/breakdown?${p.toString()}`}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  k === measure
                    ? "border-accent font-medium text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {MEASURES[k].label}
              </Link>
            );
          })}
        </nav>

        {perClinic.length === 0 ? (
          <p className="mt-8 rounded-card border border-dashed border-hairline bg-surface p-10 text-center text-sm text-muted">
            No clinic has {meta.label.toLowerCase()} in this period. Either nothing is imported for
            it, or the range is wrong.
          </p>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Total", fmt(total)],
                ["Clinics", String(perClinic.length)],
                ["Largest", perClinic[0] ? perClinic[0].name : "—"],
                [
                  "Top three",
                  total
                    ? `${Math.round(
                        (perClinic.slice(0, 3).reduce((t, c) => t + c.now, 0) / total) * 100
                      )}%`
                    : "—",
                ],
              ].map(([label, value]) => (
                <div key={label} className="rounded-card border border-hairline bg-surface px-4 py-3 shadow-card">
                  <div className="eyebrow">{label}</div>
                  <div className="tnum mt-1 truncate text-lg font-medium">{value}</div>
                </div>
              ))}
            </div>

            {movers.length > 0 && (
              <section className="mt-6 rounded-card border border-hairline bg-surface p-5 shadow-card">
                <h2 className="eyebrow">What moved</h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {movers.map((m) => (
                    <li key={m.id}>
                      <Link href={`/clinics/${m.id}`} className="text-accent hover:underline">
                        {m.name}
                      </Link>{" "}
                      <span className={(m.change ?? 0) > 0 ? "text-good" : "text-bad"}>
                        {(m.change ?? 0) > 0 ? "▲" : "▼"} {Math.abs(m.change ?? 0).toFixed(0)}%
                      </span>{" "}
                      <span className="text-muted">
                        {fmt(m.before ?? 0)} → {fmt(m.now)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted">
                  Anything that moved by a tenth or more. Direction is shown but not judged —
                  whether a fall in {meta.label.toLowerCase()} is good depends on why.
                </p>
              </section>
            )}

            <table className="mt-6 w-full text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={thL}>Clinic</th>
                  <th className={thR}>Prior</th>
                  <th className={thR}>{periodLabel}</th>
                  <th className={thR}>Change</th>
                  <th className={thR}>Share</th>
                  <th className={thL} />
                </tr>
              </thead>
              <tbody>
                {perClinic.map((c) => (
                  <tr key={c.id} className="border-b border-hairline/60">
                    <td className="py-2">
                      <Link href={`/clinics/${c.id}?month=${to}`} className="hover:text-accent">
                        {c.name}
                      </Link>
                    </td>
                    <td className="tnum py-2 text-right text-muted">
                      {c.before === null ? "—" : fmt(c.before)}
                    </td>
                    <td className="tnum py-2 text-right font-medium">{fmt(c.now)}</td>
                    <td
                      className={`tnum py-2 text-right ${
                        c.change === null ? "text-muted" : c.change > 0 ? "text-good" : "text-bad"
                      }`}
                    >
                      {c.change === null ? "—" : `${c.change > 0 ? "+" : ""}${c.change.toFixed(1)}%`}
                    </td>
                    <td className="tnum py-2 text-right text-muted">
                      {total ? ((c.now / total) * 100).toFixed(1) : 0}%
                    </td>
                    <td className="w-1/4 py-2 pl-4">
                      <div className="h-2 rounded bg-canvas">
                        <div
                          className="h-2 rounded bg-accent/60"
                          style={{ width: `${biggest ? (c.now / biggest) * 100 : 0}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-4 text-xs text-muted">
              Clinics with nothing imported for this period are left out rather than shown as zero —
              a zero would say they billed nothing, which is a different claim from having no data.
            </p>
          </>
        )}
      </main>
    </>
  );
}
