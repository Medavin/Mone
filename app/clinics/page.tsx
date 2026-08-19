import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import ExportButtons from "@/components/ExportButtons";
import { fetchAllRows } from "@/lib/fetchAll";
import type { Clinic, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });

/**
 * A card per clinic, carrying the figures somebody would otherwise have to
 * open the clinic to find.
 *
 * A list of names answers "which clinics exist", which nobody needed to ask.
 * The question this page is actually opened with is "which clinic needs me
 * today", and that needs the vitals on the card: what is outstanding, how much
 * of it has aged past four months, whether it moved the right way, and whether
 * anyone has flagged it.
 */
export default async function ClinicsPage({
  searchParams,
}: {
  searchParams: { sort?: string; show?: string };
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "")
    .maybeSingle();

  const { data: clinics, error } = await supabase
    .from("clinics")
    .select("id, code, name, status, go_live_date, notes")
    .order("name");

  const rows = (clinics ?? []) as Clinic[];

  // The two most recent months that have A/R at all, so a card can show a
  // direction of travel rather than a lone figure.
  const { data: arMonthRows } = await supabase
    .from("ar_month_list")
    .select("period_month")
    .order("period_month");

  const arMonths = ((arMonthRows ?? []) as { period_month: string }[]).map((r) =>
    r.period_month.slice(0, 7)
  );
  const latest = arMonths[arMonths.length - 1];
  const prior = arMonths[arMonths.length - 2];

  type ArRow = {
    clinic_id: number;
    period_month: string;
    closing_ar: number | null;
    bucket_120_plus: number | null;
  };

  let ar: ArRow[] = [];
  if (latest) {
    const months = [latest, prior].filter(Boolean).map((m) => `${m}-01`);
    const res = await fetchAllRows<ArRow>((lo, hi) =>
      supabase
        .from("ar_clinic_month")
        .select("clinic_id, period_month, closing_ar, bucket_120_plus")
        .in("period_month", months)
        .order("period_month")
        .order("clinic_id")
        .range(lo, hi)
    );
    ar = res.rows;
  }

  const at = (clinicId: number, month?: string) =>
    month ? ar.find((r) => r.clinic_id === clinicId && r.period_month.slice(0, 7) === month) : undefined;

  // Open flags, so a card can say a clinic has already been raised.
  const { data: flagRows } = await supabase
    .from("clinic_flags")
    .select("clinic_id, severity")
    .neq("status", "resolved");

  const flagsByClinic = new Map<number, string[]>();
  for (const f of (flagRows ?? []) as { clinic_id: number; severity: string }[]) {
    flagsByClinic.set(f.clinic_id, [...(flagsByClinic.get(f.clinic_id) ?? []), f.severity]);
  }

  const cards = rows.map((c) => {
    const now = at(c.id, latest);
    const was = at(c.id, prior);
    const total = now?.closing_ar ?? null;
    const over120 = now?.bucket_120_plus ?? null;
    const before = was?.closing_ar ?? null;
    const flags = flagsByClinic.get(c.id) ?? [];
    return {
      ...c,
      total,
      over120,
      share: total && over120 !== null ? (over120 / total) * 100 : null,
      change: total !== null && before ? ((total - before) / before) * 100 : null,
      flags,
      worst: flags.includes("urgent") ? "urgent" : flags.includes("concern") ? "concern" : flags[0],
    };
  });

  const showAll = searchParams.show === "all";
  const visible = cards.filter((c) => (showAll ? true : c.status === "active"));

  const sort = searchParams.sort ?? "name";
  visible.sort((a, b) => {
    if (sort === "ar") return (b.total ?? -1) - (a.total ?? -1);
    if (sort === "over120") return (b.over120 ?? -1) - (a.over120 ?? -1);
    if (sort === "share") return (b.share ?? -1) - (a.share ?? -1);
    return a.name.localeCompare(b.name);
  });

  const withData = visible.filter((c) => c.total !== null).length;

  const tone = (severity?: string) =>
    severity === "urgent" ? "text-bad" : severity === "concern" ? "text-warn" : "text-muted";

  const SORTS: [string, string][] = [
    ["name", "Name"],
    ["ar", "A/R"],
    ["over120", "120+"],
    ["share", "120+ share"],
  ];

  return (
    <>
      <AppHeader profile={(profile as Profile) ?? null} />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Clinics</h1>
            <p className="mt-1 text-sm text-muted">
              {latest
                ? `Figures are ${monthLabel(latest)}, the most recent month imported.`
                : "No months imported yet, so the cards show names only."}
            </p>
          </div>
          <ExportButtons
            title="Clinics"
            headers={["Clinic", "Code", "Status", "Closing A/R", "Over 120", "120+ share %", "Change vs prior %"]}
            rows={visible.map((c) => [
              c.name,
              c.code ?? "",
              c.status,
              c.total,
              c.over120,
              c.share === null ? null : Math.round(c.share * 10) / 10,
              c.change === null ? null : Math.round(c.change * 10) / 10,
            ])}
          />
        </div>

        {!profile && (
          <p className="mt-6 rounded-card border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
            You are signed in, but you have no profile row, so the database returns nothing. An
            administrator needs to add you to the profiles table.
          </p>
        )}

        {error && (
          <p className="mt-6 rounded-card border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
            The clinics could not be loaded: {error.message}
          </p>
        )}

        {/* controls */}
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm print:hidden">
          <span className="eyebrow">Sort by</span>
          {SORTS.map(([k, label]) => (
            <Link
              key={k}
              href={`/clinics?sort=${k}${showAll ? "&show=all" : ""}`}
              className={sort === k ? "font-medium text-accent" : "text-muted hover:text-ink"}
            >
              {label}
            </Link>
          ))}
          <span className="flex-1" />
          <Link
            href={`/clinics?sort=${sort}${showAll ? "" : "&show=all"}`}
            className="text-muted underline hover:text-ink"
          >
            {showAll ? "Active only" : "Include closed clinics"}
          </Link>
          <span className="tnum text-xs text-muted">
            {visible.length} shown · {withData} with figures
          </span>
        </div>

        {visible.length === 0 ? (
          <p className="mt-8 text-sm text-muted">
            No clinics to show. Add one under Settings → Clinics.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((c) => (
              <Link
                key={c.id}
                href={`/clinics/${c.id}`}
                className="group rounded-card border border-hairline bg-surface p-5 shadow-card transition
                           hover:border-accent/40 hover:shadow-lift"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium group-hover:text-accent">{c.name}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {c.code ?? "no code"}
                      {c.status !== "active" && (
                        <span className="ml-2 rounded bg-canvas px-1.5 py-0.5">{c.status}</span>
                      )}
                    </div>
                  </div>
                  {c.flags.length > 0 && (
                    <span className={`text-xs ${tone(c.worst)}`} title={`${c.flags.length} open flag(s)`}>
                      ⚑ {c.flags.length}
                    </span>
                  )}
                </div>

                {c.total === null ? (
                  <p className="mt-4 rounded border border-dashed border-hairline px-3 py-4 text-center text-xs text-muted">
                    Nothing imported for this clinic yet
                  </p>
                ) : (
                  <>
                    <div className="mt-4 flex items-baseline gap-3">
                      <span className="tnum text-2xl font-medium">{money(c.total)}</span>
                      {c.change !== null && (
                        <span
                          className={`tnum text-xs ${
                            c.change > 0 ? "text-bad" : c.change < 0 ? "text-good" : "text-muted"
                          }`}
                          title={`Against ${prior ? monthLabel(prior) : "the prior month"}`}
                        >
                          {c.change > 0 ? "▲" : c.change < 0 ? "▼" : ""}
                          {Math.abs(c.change).toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <div className="eyebrow mt-0.5">Outstanding A/R</div>

                    {/* The aging bar: the darker portion is money past 120 days. */}
                    <div className="mt-4">
                      <div className="flex h-2 overflow-hidden rounded bg-canvas">
                        <div
                          className="h-2 bg-age0"
                          style={{ width: `${Math.max(0, 100 - (c.share ?? 0))}%` }}
                        />
                        <div className="h-2 bg-age120" style={{ width: `${c.share ?? 0}%` }} />
                      </div>
                      <div className="mt-1.5 flex items-baseline justify-between text-xs">
                        <span className="text-muted">Over 120 days</span>
                        <span className="tnum">
                          <span className="text-age120">{money(c.over120 ?? 0)}</span>
                          <span className="ml-2 text-muted">{(c.share ?? 0).toFixed(0)}%</span>
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </Link>
            ))}
          </div>
        )}

        <p className="mt-8 text-xs text-muted">
          A rise in A/R is shown in red and a fall in green, because on this page the figure is money
          still owed — not revenue. Green is not always good elsewhere in the app, so the direction
          is labelled rather than left to the colour.
        </p>
      </main>
    </>
  );
}
