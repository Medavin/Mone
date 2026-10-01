import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import { manages, type Profile } from "@/lib/types";
import { DAYS_IN_AR_METHOD, PAYMENT_PER_VISIT_METHOD } from "@/lib/arMetrics";
import { DAYS_IN_AR_TARGET, OVER_120_LIMIT, TREND_TOLERANCE, monthEnd, type Snapshot } from "@/lib/results";
import { loadResults, HEALTH_LABEL, HEALTH_TONE, HEALTH_RULE, type Params, type ResultsData } from "@/lib/resultsData";
import ResultsFilters from "./ResultsFilters";
import ResultsTable, { type Col, type Row } from "./ResultsTable";
import { AddonEditor, CamAssignForm } from "./ResultsAdmin";
import {
  Card, HealthCard, Delta, Donut, Spark, Icon, ViewLink, COLUMN_COLOURS,
  money, plain, pct1, pct0, monthLabel, dateLabel,
} from "./ui";

/**
 * CLIENT & CAM RESULTS MANAGEMENT — Michelle's page, laid out as her
 * mockup of 29 Sep 2026: a side menu of sections, a blue title band with
 * the main tabs, one filter bar, then the cards.
 *
 * Every section reads ONE loader (lib/resultsData.ts), so a figure on the
 * dashboard card and the full table behind it can never disagree. Every
 * table is a ResultsTable: filter by element, filter by amount, line
 * count, and a grand total row as sum / count / average.
 */

export const dynamic = "force-dynamic";

const SECTIONS = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "client", label: "Client View", icon: "client" },
  { key: "cam", label: "CAM View", icon: "cam" },
  { key: "collector", label: "Collector View", icon: "collector" },
  { key: "clients", label: "Clients", icon: "clients" },
  { key: "ar", label: "AR Snapshot", icon: "ar" },
  { key: "denials", label: "Denials", icon: "denials" },
  { key: "crl", label: "CRL Compliance", icon: "crl" },
  { key: "camtasks", label: "CAM Tasks", icon: "camtasks" },
  { key: "collectortasks", label: "Collector Tasks", icon: "collectortasks" },
  { key: "utilization", label: "Utilization", icon: "utilization" },
  { key: "reports", label: "Reports", icon: "reports" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

const TABS: SectionKey[] = ["ar", "denials", "crl", "camtasks", "collectortasks", "utilization"];

export default async function ResultsPage({ searchParams }: { searchParams: Params }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profileRow } = await supabase
    .from("profiles").select("id, full_name, email, role, is_active").eq("id", user?.id ?? "").maybeSingle();
  const profile = (profileRow as Profile) ?? null;
  const isManager = manages(profile?.role);

  const section: SectionKey = (SECTIONS.find((s) => s.key === searchParams.section)?.key ?? "dashboard") as SectionKey;
  const d = await loadResults(supabase as never, searchParams);

  // Links keep every filter and change only what they name.
  const keep: Record<string, string> = {};
  for (const k of ["start", "end", "cam", "client", "collector", "view", "system"] as const) {
    const v = searchParams[k];
    if (v) keep[k] = v;
  }
  const href = (s: SectionKey, extra: Record<string, string> = {}) =>
    `/results?${new URLSearchParams({ ...keep, section: s, ...extra })}`;

  const latestMonth = d.months[d.months.length - 1] ?? d.today.slice(0, 7);
  const ytd = { start: `${latestMonth.slice(0, 4)}-01-01`, end: monthEnd(latestMonth) };
  const current = SECTIONS.find((s) => s.key === section)!;

  return (
    <>
      <AppHeader profile={profile} />
      <div className="mx-auto flex max-w-[1500px] gap-0 lg:gap-5 lg:px-4 lg:py-4">
        {/* ---------------- side menu ---------------- */}
        <aside className="hidden w-52 shrink-0 lg:block">
          <nav className="sticky top-4 rounded-card border border-hairline bg-surface p-2 shadow-card">
            <div className="mb-2 flex items-center gap-2 px-2 pb-2 pt-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/momentum-logo.svg" alt="Momentum" className="h-7" />
            </div>
            {SECTIONS.map((s) => {
              const on = s.key === section;
              return (
                <Link
                  key={s.key}
                  href={href(s.key)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                    on ? "bg-accentSoft font-semibold text-accent" : "text-ink/80 hover:bg-canvas hover:text-ink"
                  }`}
                >
                  <span className={on ? "text-brandMid" : "text-muted"}><Icon name={s.icon} className="h-[18px] w-[18px]" /></span>
                  {s.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-4 lg:px-0 lg:py-0">
          {/* ---------------- title band ---------------- */}
          <div className="relative overflow-hidden rounded-card bg-gradient-to-r from-accentDeep via-accent to-brandMid px-5 py-4 text-white shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Client &amp; CAM Results Management</h1>
                <nav className="mt-1 flex flex-wrap gap-x-1 text-sm text-white/80">
                  {TABS.map((t, i) => {
                    const s = SECTIONS.find((x) => x.key === t)!;
                    return (
                      <span key={t} className="flex items-center gap-1">
                        {i > 0 && <span className="text-white/40">•</span>}
                        <Link href={href(t)} className={`hover:text-white ${section === t ? "font-semibold text-white underline underline-offset-4" : ""}`}>
                          {s.label}
                        </Link>
                      </span>
                    );
                  })}
                </nav>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-ink shadow">
                <span className="text-brandMid"><Icon name="calendar" /></span>
                <div className="leading-tight">
                  <div className="text-[11px] text-muted">Today</div>
                  <div className="text-sm font-semibold">
                    {new Date(`${d.today}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* section picker for small screens, where the side menu is hidden */}
          <div className="mt-3 flex gap-1 overflow-x-auto pb-1 lg:hidden">
            {SECTIONS.map((s) => (
              <Link key={s.key} href={href(s.key)} className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${s.key === section ? "bg-accent text-white" : "bg-surface text-muted"}`}>
                {s.label}
              </Link>
            ))}
          </div>

          {/* ---------------- filters ---------------- */}
          <div className="mt-4">
            <ResultsFilters
              section={section}
              start={d.start} end={d.end} ytd={ytd}
              cams={d.camNames} cam={d.filters.cam}
              clients={d.clientList} client={d.filters.clientId}
              collectors={d.collectorNames} collector={d.filters.collector}
              view={d.filters.view}
              systems={d.systems} system={d.filters.system}
            />
          </div>

          <p className="mt-2 text-xs text-muted">
            <strong className="text-ink">{current.label}</strong> · {d.scopeLabel} · {dateLabel(d.start)} – {dateLabel(d.end)}
            {d.periodMonths.length ? ` · ${d.periodMonths.length} month${d.periodMonths.length === 1 ? "" : "s"} of A/R figures` : " · no A/R figures in this range"}
            {d.camNames.length === 0 && " · ⚠ no CAMs set yet — run migration 030"}
          </p>

          <div className="mt-4 space-y-5">
            {section === "dashboard" && <Dashboard d={d} href={href} isManager={isManager} />}
            {section === "client" && <ClientView d={d} href={href} />}
            {section === "cam" && <CamView d={d} href={href} />}
            {section === "collector" && <CollectorView d={d} />}
            {section === "clients" && <ClientsSection d={d} href={href} isManager={isManager} />}
            {section === "ar" && <ArSection d={d} href={href} />}
            {section === "denials" && <DenialsSection d={d} />}
            {section === "crl" && <CrlSection d={d} />}
            {section === "camtasks" && <CamTasksSection d={d} />}
            {section === "collectortasks" && <CollectorTasksSection d={d} />}
            {section === "utilization" && <UtilizationSection d={d} isManager={isManager} />}
            {section === "reports" && <ReportsSection href={href} />}
          </div>
        </main>
      </div>
    </>
  );
}

type Href = (s: SectionKey, extra?: Record<string, string>) => string;

/* =====================================================================
   Shared building blocks
   ===================================================================== */

const METRICS: { key: string; label: string; get: (s: Snapshot) => string; raw: (s: Snapshot) => number | null; red?: (s: Snapshot) => boolean; note?: string }[] = [
  { key: "visits", label: "Visits", get: (s) => plain(s.visits), raw: (s) => s.visits },
  { key: "payments", label: "Payments", get: (s) => money(s.payments), raw: (s) => s.payments },
  { key: "arChange", label: "Change in AR", get: (s) => money(s.arChange), raw: (s) => s.arChange, red: (s) => (s.arChange ?? 0) > 0, note: "A rise in A/R shows red: less was collected than billed." },
  { key: "ppv", label: "Avg Payment per Visit", get: (s) => money(s.paymentPerVisit), raw: (s) => s.paymentPerVisit, note: PAYMENT_PER_VISIT_METHOD },
  { key: "days", label: "Days in AR", get: (s) => plain(s.daysInAr), raw: (s) => s.daysInAr, red: (s) => s.daysInAr !== null && s.daysInAr > DAYS_IN_AR_TARGET, note: DAYS_IN_AR_METHOD },
  { key: "o120", label: "% 120+ in Carrier AR", get: (s) => pct1(s.over120Share), raw: (s) => s.over120Share, red: (s) => s.over120Share !== null && s.over120Share >= OVER_120_LIMIT, note: "Insurance 120+ over insurance A/R, at the last month" },
  { key: "insNet", label: "Total Insurance Net AR", get: (s) => money(s.insNetAr), raw: (s) => s.insNetAr, note: "Insurance side only, at the last month" },
];

/** The YTD snapshot exactly as in the mockup: metrics down, clients (or CAMs) across. */
function SnapshotTable({ d, href }: { d: ResultsData; href: Href }) {
  const byCam = d.filters.view === "cam";
  const cols: { key: string; top: string | null; label: string; sub: string | null; snap: Snapshot; link?: string }[] = [
    { key: "all", top: null, label: d.filters.clientId ? "Selected" : "All Clients", sub: `${d.withData.length} with figures`, snap: d.combined },
    ...(byCam
      ? d.camSnapshots.map((c) => ({ key: `cam-${c.cam}`, top: `${c.clients} client${c.clients === 1 ? "" : "s"}`, label: c.cam, sub: null, snap: c.snap, link: c.cam === "No CAM" ? href("dashboard", { cam: "__none" }) : href("dashboard", { cam: c.cam }) }))
      : d.rows.map((r) => ({
          key: String(r.id), top: r.code, label: r.name,
          sub: [r.cam, r.system === "prompt" ? "Prompt" : null].filter(Boolean).join(" · ") || null,
          snap: r.snap, link: `/clinics/${r.id}?month=${d.to}`,
        }))),
  ];
  const exportRows: Row[] = METRICS.map((m) => {
    const row: Row = { metric: m.label };
    cols.forEach((c) => {
      const v = m.raw(c.snap);
      row[c.key] = v === null ? null : Math.round(v * 100) / 100;
    });
    return row;
  });
  return (
    <Card
      title="YTD Dashboard Snapshot"
      icon="doc"
      sub={`As of ${dateLabel(d.end)}`}
      right={<ViewLink href={href("ar")}>View in AR Tool</ViewLink>}
      footer={`Source: AdvancedMD monthly packs, last imported ${dateLabel(d.lastPack)}. Visits, payments and change in A/R add up across the months; A/R balances are the last month's; every ratio is recomputed from its parts, never averaged across clients. Days in A/R and payment per visit use provisional formulas until Monty and David confirm Momentum's own.`}
    >
      {d.withData.length === 0 ? (
        <p className="rounded border border-dashed border-hairline px-4 py-6 text-center text-sm text-muted">
          No A/R figures for these clients in this date range. Pick another range, or import their monthly packs.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[11rem] border-b border-hairline bg-canvas/70 px-3 py-2 text-left text-xs font-bold text-ink">Metric</th>
                {cols.map((c, i) => (
                  <th
                    key={c.key}
                    className={`min-w-[8.5rem] border-b border-hairline px-3 py-2 text-center align-bottom ${c.key === "all" ? "bg-accentSoft" : "bg-canvas/40"}`}
                    style={{ borderTop: `3px solid ${c.key === "all" ? "#004A80" : COLUMN_COLOURS[(i - 1) % COLUMN_COLOURS.length]}` }}
                  >
                    {c.top && <div className="text-[11px] font-semibold text-muted">{c.top}</div>}
                    {c.link ? (
                      <Link href={c.link} className="font-bold text-ink hover:text-brandMid hover:underline">{c.label}</Link>
                    ) : (
                      <span className="font-bold text-ink">{c.label}</span>
                    )}
                    {c.sub && <div className="text-[10px] font-normal text-muted">{c.sub}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.key}>
                  <td className="sticky left-0 z-10 border-b border-hairline/70 bg-surface px-3 py-2 font-medium" title={m.note}>
                    {m.label}{m.note && <span className="ml-1 cursor-help text-[10px] text-muted">ⓘ</span>}
                  </td>
                  {cols.map((c) => (
                    <td
                      key={c.key}
                      className={`tnum border-b border-hairline/70 px-3 py-2 text-center ${c.key === "all" ? "bg-accentSoft/70 font-bold" : ""} ${m.red?.(c.snap) ? "text-bad" : ""}`}
                    >
                      {m.get(c.snap)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3">
            <details className="text-xs">
              <summary className="cursor-pointer text-brandMid">Filter, total or export this table</summary>
              <div className="mt-2">
                <ResultsTable
                  title={`Dashboard snapshot ${d.start} to ${d.end}`}
                  cols={[{ key: "metric", label: "Metric" }, ...cols.map((c) => ({ key: c.key, label: c.label, type: "number" as const, ratio: true }))]}
                  rows={exportRows}
                  compact
                />
              </div>
            </details>
          </div>
        </div>
      )}
    </Card>
  );
}

function portfolioCols(withCollector = true): Col[] {
  return [
    { key: "client", label: "Client" },
    { key: "cam", label: "CAM" },
    ...(withCollector ? [{ key: "collector", label: "Collector" } as Col] : []),
    { key: "days", label: "Days in AR", type: "days", ratio: true },
    { key: "ar", label: "Total AR", type: "money" },
    { key: "o120", label: "% 120+ ins.", type: "percent", ratio: true },
    { key: "crl", label: "CRL Compliance", type: "percent", ratio: true, hint: "Share of the period's CRL requests answered or closed" },
    { key: "health", label: "Overall Health", type: "chip", hint: HEALTH_RULE },
  ];
}
function portfolioRows(d: ResultsData, href: Href): Row[] {
  return d.rows.map((r) => ({
    client: { v: r.name, href: href("dashboard", { client: String(r.id) }), sub: r.system === "prompt" ? "Prompt" : undefined },
    cam: r.cam ?? "not set",
    collector: r.collector,
    days: r.snap.daysInAr,
    ar: r.closingAr,
    o120: r.snap.over120Share === null ? null : Math.round(r.snap.over120Share * 10) / 10,
    crl: r.crlRate === null ? null : Math.round(r.crlRate),
    health: {
      v: r.health === "unknown" && r.system === "prompt" ? "Prompt — no figures" : HEALTH_LABEL[r.health],
      tone: HEALTH_TONE[r.health],
    },
  }));
}
const portfolioTotals = (d: ResultsData) => ({
  days: d.combined.daysInAr,
  o120: d.combined.over120Share,
  crl: d.crlNow.rate,
});

function camCols(): Col[] {
  return [
    { key: "cam", label: "CAM" },
    { key: "received", label: "Received", type: "number" },
    { key: "solved", label: "Solved", type: "number" },
    { key: "pending", label: "Pending", type: "number" },
    { key: "age", label: "Avg. Age (days)", type: "days", ratio: true },
    { key: "sent", label: "Sent to CAM", type: "number", hint: "Collection actions recorded as 'Sent to CAM' for this CAM's clients" },
  ];
}
function camRows(d: ResultsData, href: Href): Row[] {
  return d.camWork.map(([nm, r]) => ({
    cam: { v: nm, href: href("camtasks", { cam: nm }) },
    received: r.received, solved: r.resolved, pending: r.pending,
    age: r.pending ? Math.round((r.pendingAge / r.pending) * 10) / 10 : null,
    sent: r.sentToCam,
  }));
}

function collectorCols(): Col[] {
  return [
    { key: "collector", label: "Collector" },
    { key: "actions", label: "Actions", type: "number" },
    { key: "clients", label: "Clients", type: "number" },
    { key: "sent", label: "Sent to CAM", type: "number" },
    { key: "top", label: "Most frequent action" },
  ];
}
function collectorRows(d: ResultsData, href: Href): Row[] {
  return d.collectors.map(([nm, g]) => {
    const top = Array.from(g.top.entries()).sort((a, b) => b[1] - a[1])[0];
    return {
      collector: { v: nm, href: href("collectortasks", { collector: nm }) },
      actions: g.actions, clients: g.clients.size, sent: g.sentToCam,
      top: top ? `${top[0]} (${top[1]})` : null,
    };
  });
}

/* =====================================================================
   DASHBOARD — the mockup, card for card
   ===================================================================== */

function Dashboard({ d, href, isManager }: { d: ResultsData; href: Href; isManager: boolean }) {
  const withFig = d.rows.filter((r) => r.health !== "unknown");
  const onTrack = withFig.filter((r) => r.health === "on_track").length;
  const arPct = withFig.length ? (onTrack / withFig.length) * 100 : null;

  const camResolved = d.camWork.reduce((t, [, r]) => t + r.resolved, 0);
  const camPending = d.camWork.reduce((t, [, r]) => t + r.pending, 0);
  const camPct = camResolved + camPending ? (camResolved / (camResolved + camPending)) * 100 : null;

  const amdClients = d.rows.filter((r) => r.system !== "prompt");
  const worked = amdClients.filter((r) => r.actions > 0).length;
  const collPct = amdClients.length && d.collectors.length ? (worked / amdClients.length) * 100 : null;
  const totalActions = d.collectors.reduce((t, [, g]) => t + g.actions, 0);

  const deniedTotal = d.denials.length;
  const addonUnits = d.addonUse.reduce((t, [, u]) => t + u.units, 0);
  const addonCharges = d.addonUse.reduce((t, [, u]) => t + u.charges, 0);
  const addonPaidKnown = d.addonUse.some(([, u]) => u.paid !== null);
  const addonPaid = d.addonUse.reduce((t, [, u]) => t + (u.paid ?? 0), 0);

  return (
    <>
      {/* Overall health */}
      <section>
        <h2 className="mb-2 text-lg font-bold text-ink">Overall Health</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <HealthCard
            title="AR Health (YTD)" icon="health" href={href("clients")}
            pct={arPct} pctLabel="clients on track"
            text={withFig.length ? `${onTrack} of ${withFig.length} clients within all three A/R targets.` : "No A/R figures in this range yet."}
          />
          <HealthCard
            title="Client Responsiveness (CRL)" icon="people" href={href("crl")}
            pct={d.crlNow.rate} pctLabel="answered or closed"
            text={d.crlNow.requests ? `${d.crlNow.pending} still pending${d.crlNow.oldestDays !== null ? `, oldest ${d.crlNow.oldestDays} days` : ""}.` : "No CRL requests in this range."}
          />
          <HealthCard
            title="CAM Workload" icon="doc" href={href("camtasks")}
            pct={camPct} pctLabel="tasks resolved"
            text={camResolved + camPending ? `${camPending} pending across ${d.camWork.filter(([, r]) => r.pending).length} CAMs at period end.` : "No tasks assigned to CAMs yet."}
          />
          <HealthCard
            title="Collector Workload" icon="people" href={href("collectortasks")}
            pct={collPct} pctLabel="clients worked"
            text={totalActions ? `${plain(totalActions)} actions by ${d.collectors.length} collectors.` : "No collection action report for this range."}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted">
          Status bands on every card: 80% and above On track · 60–79% Watch closely · below 60% Needs attention. Provisional until Michelle and Monty agree the rules.
        </p>
      </section>

      <SnapshotTable d={d} href={href} />

      {/* Four cards */}
      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-[1fr_1.2fr_0.85fr_0.85fr]">
        <Card title="Top Denial Reasons" icon="denials" sub="(selected range)" right={<ViewLink href={href("denials")}>View Details</ViewLink>}
          footer="Grouped by each code's category. Counted per denial row.">
          {d.denialRate && (
            <div className="mb-3 flex items-baseline justify-between rounded-lg bg-canvas/60 px-3 py-2 text-sm">
              <span><strong className="tnum text-lg">{plain(d.denialRate.denied)}</strong> denied of {plain(d.denialRate.claims)} claims</span>
              <span className={`tnum font-bold ${(d.denialRate.rate ?? 0) >= 5 ? "text-bad" : "text-good"}`}>{pct1(d.denialRate.rate)}</span>
            </div>
          )}
          {d.denialGroups.length === 0 ? (
            d.denialRate ? (
              <div className="space-y-1.5 text-sm">
                {d.denialRate.byClient.sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)).slice(0, 4).map((c) => (
                  <div key={c.id} className="flex justify-between"><span className="truncate">{c.name}</span><span className="tnum text-xs text-muted">{c.denied} · {pct1(c.rate)}</span></div>
                ))}
                <p className="pt-1 text-[11px] text-muted">Reasons not loaded yet — the Remit Allocation Report gives the rate only. Reasons need a report with reason codes.</p>
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted">No denials recorded for these clients in this range. They arrive from the AdvancedMD Denial Module (Settings → Import any report), or Prompt&apos;s Remit Allocation Report for the rate.</p>
            )
          ) : (
            <div className="space-y-2.5">
              {d.denialGroups.slice(0, 5).map(([k, g]) => {
                const share = (g.count / deniedTotal) * 100;
                return (
                  <div key={k} className="grid grid-cols-[1fr_6rem_2.5rem_2.5rem] items-center gap-2 text-sm">
                    <span className="truncate" title={k}>{k}</span>
                    <span className="h-3 rounded-sm bg-accentSoft"><span className="block h-3 rounded-sm bg-brandMid" style={{ width: `${share}%` }} /></span>
                    <span className="tnum text-right text-xs">{Math.round(share)}%</span>
                    <span className="tnum text-right text-xs text-muted">{g.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Client Request Log (CRL) Compliance" icon="people" right={<ViewLink href={href("crl")}>View</ViewLink>}
          footer="Response = the day the client answered minus the request day. Compliance = share of the period's requests answered or closed.">
          {d.crlError ? (
            <p className="py-4 text-center text-sm text-muted">The CRL is missing its date columns — run migration 030.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                ["Requests This Period", plain(d.crlNow.requests), <Delta key="a" now={d.crlNow.requests} prev={d.crlPrev.requests} upIsGood={false} />],
                ["Avg. Response Days", d.crlNow.avgResponse === null ? "—" : d.crlNow.avgResponse.toFixed(1), <Delta key="b" now={d.crlNow.avgResponse} prev={d.crlPrev.avgResponse} upIsGood={false} unit="abs" />],
                ["Pending End of Period", plain(d.crlNow.pending), <Delta key="c" now={d.crlNow.pending} prev={d.crlPrev.pending} upIsGood={false} />],
                ["Oldest Open Item", d.crlNow.oldestDays === null ? "—" : `${d.crlNow.oldestDays}`, <span key="d" className="text-[11px] text-muted">days</span>],
                ["Compliance %", pct0(d.crlNow.rate), <Delta key="e" now={d.crlNow.rate} prev={d.crlPrev.rate} upIsGood unit="abs" />],
              ].map(([l, v, delta]) => (
                <div key={l as string} className="rounded-lg border border-hairline p-2 text-center">
                  <div className="text-[10px] font-semibold leading-tight text-muted">{l}</div>
                  <div className="tnum my-1 text-xl font-bold">{v}</div>
                  {delta}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Patients Over 25 Visits" icon="people" sub={d.over25 ? `(${d.over25.year}, to ${dateLabel(d.over25.asOf)})` : "(YTD)"}
          footer={d.over25
            ? `Completed visits counted from 1 January, per client — ${d.over25.clients} of ${d.rows.length} clients reporting so far. Only the two counts are stored, never patient details.`
            : "Needs a per-client count. For Prompt clients: import the Visits Revenue Report from 1 January. For AdvancedMD clients: a two-number query (patients over 25 completed visits, and all patients seen)."}>
          <div className="flex items-center gap-4">
            <Donut part={d.over25?.over ?? null} total={d.over25?.patients ?? null} label={d.over25 ? `${plain(d.over25.over)} patients` : "no data yet"} />
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-brandMid" /> Patients &gt; 25 Visits <strong className="tnum ml-1">{plain(d.over25?.over)}</strong></div>
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-accentSoft" /> Patients ≤ 25 Visits <strong className="tnum ml-1">{d.over25 ? plain(d.over25.patients - d.over25.over) : "—"}</strong></div>
              <div className="pt-1 text-xs text-muted">Total Unique Patients</div>
              <div className="tnum text-xl font-bold">{plain(d.over25?.patients)}</div>
            </div>
          </div>
        </Card>

        <Card title="Add-On Code Utilization" icon="utilization" sub="(range)" right={<ViewLink href={href("utilization")}>View</ViewLink>}
          footer={addonPaidKnown ? "Billed and paid by CPT code. Paid comes from Prompt's Revenue by CPT Code report; AdvancedMD clients show billed only until a payments-by-code report is connected." : "Billed charges from Service Details in the monthly pack. Payments by code need a transaction-level report."}>
          {d.addonTableMissing ? (
            <p className="py-4 text-center text-sm text-muted">Run migration 030 to create the add-on code list.</p>
          ) : d.addons.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No add-on codes chosen yet. Momentum picks them under Utilization.</p>
          ) : (
            <>
              <div className={`grid gap-2 text-center ${addonPaidKnown ? "grid-cols-3" : "grid-cols-2"}`}>
                <div><div className="tnum text-xl font-bold">{plain(addonUnits)}</div><div className="text-[11px] text-muted">Add-On Units</div></div>
                <div><div className="tnum text-xl font-bold">{money(addonCharges)}</div><div className="text-[11px] text-muted">Billed</div></div>
                {addonPaidKnown && <div><div className="tnum text-xl font-bold text-good">{money(addonPaid)}</div><div className="text-[11px] text-muted">Paid</div></div>}
              </div>
              <div className="mt-3 text-xs font-semibold">Top Add-On CPT Codes</div>
              <table className="mt-1 w-full text-xs">
                <thead><tr className="border-b border-hairline text-muted"><th className="py-1 text-left font-medium">CPT Code</th><th className="py-1 text-right font-medium">Units</th><th className="py-1 text-right font-medium">{addonPaidKnown ? "Paid" : "Charges"}</th></tr></thead>
                <tbody>
                  {d.addonUse.slice(0, 4).map(([code, u]) => (
                    <tr key={code} className="border-b border-hairline/50"><td className="tnum py-1">{code}</td><td className="tnum py-1 text-right">{plain(u.units)}</td><td className="tnum py-1 text-right">{money(addonPaidKnown ? u.paid : u.charges)}</td></tr>
                  ))}
                  {d.addonUse.length === 0 && <tr><td colSpan={3} className="py-2 text-center text-muted">None billed in this range.</td></tr>}
                </tbody>
              </table>
            </>
          )}
        </Card>
      </section>

      {/* Bottom row */}
      <section className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-12">
        <Card className="2xl:col-span-3" title="CAM Tasks" icon="camtasks" sub="(Across Selected Clients)" right={<ViewLink href={href("camtasks")}>View All</ViewLink>}>
          <ResultsTable title="CAM tasks" cols={camCols().filter((c) => c.key !== "sent")} rows={camRows(d, href)} compact pageSize={5}
            empty="No tasks assigned to a CAM yet. Tasks count once CAMs have logins and work is assigned on the Tasks page." />
        </Card>
        <Card className="2xl:col-span-3" title="Collector Tasks" icon="collectortasks" sub="(Across Selected Clients)" right={<ViewLink href={href("collectortasks")}>View All</ViewLink>}>
          <ResultsTable title="Collector work" cols={collectorCols().filter((c) => c.key !== "top" && c.key !== "sent")} rows={collectorRows(d, href)} compact pageSize={5}
            empty="No collection action report imported for this range." />
        </Card>
        <Card className="xl:col-span-2 2xl:col-span-6" title="Client Portfolio" icon="clients" sub="(Results for Selected Filters)" right={<ViewLink href={href("clients")}>View All Clients</ViewLink>}
          footer={HEALTH_RULE}>
          <ResultsTable title="Client portfolio" cols={portfolioCols()} rows={portfolioRows(d, href)} totals={portfolioTotals(d)} compact pageSize={6}
            empty="No active clients match these filters." />
        </Card>
      </section>
      {isManager && d.camNames.length === 0 && (
        <p className="text-xs text-warn">No CAMs are set yet. Run migration 030, then reload.</p>
      )}
    </>
  );
}

/* =====================================================================
   The other sections — each is the full table behind a dashboard card
   ===================================================================== */

function ClientView({ d, href }: { d: ResultsData; href: Href }) {
  const rows: Row[] = d.rows.map((r) => ({
    client: { v: r.name, href: href("dashboard", { client: String(r.id) }) },
    cam: r.cam, system: r.system === "prompt" ? "Prompt" : "AdvancedMD",
    visits: r.snap.visits, payments: r.snap.payments, arChange: r.snap.arChange,
    ppv: r.snap.paymentPerVisit === null ? null : Math.round(r.snap.paymentPerVisit * 100) / 100,
    days: r.snap.daysInAr,
    o120: r.snap.over120Share === null ? null : Math.round(r.snap.over120Share * 10) / 10,
    insNet: r.snap.insNetAr, asOf: monthLabel(r.snap.asOf),
  }));
  return (
    <>
      <SnapshotTable d={d} href={href} />
      <Card title="Every client, every measure" icon="client" footer="One row per client. Totals for ratio columns are the company figure recomputed from its parts when the table is unfiltered.">
        <ResultsTable
          title={`Client view ${d.start} to ${d.end}`}
          cols={[
            { key: "client", label: "Client" }, { key: "cam", label: "CAM" }, { key: "system", label: "System" },
            { key: "visits", label: "Visits", type: "number" }, { key: "payments", label: "Payments", type: "money" },
            { key: "arChange", label: "Change in AR", type: "money" }, { key: "ppv", label: "Avg Pmt / Visit", type: "money", ratio: true },
            { key: "days", label: "Days in AR", type: "days", ratio: true }, { key: "o120", label: "% 120+", type: "percent", ratio: true },
            { key: "insNet", label: "Ins. Net AR", type: "money" }, { key: "asOf", label: "Balances as of" },
          ]}
          rows={rows}
          totals={{ ppv: d.combined.paymentPerVisit, days: d.combined.daysInAr, o120: d.combined.over120Share }}
        />
      </Card>
    </>
  );
}

function CamView({ d, href }: { d: ResultsData; href: Href }) {
  const work = new Map(d.camWork);
  const rows: Row[] = d.camSnapshots.map((c) => {
    const w = work.get(c.cam);
    const openCrl = d.rows.filter((r) => (r.cam ?? "No CAM") === c.cam).reduce((t, r) => t + r.crlOpen, 0);
    return {
      cam: { v: c.cam, href: c.cam === "No CAM" ? href("dashboard", { cam: "__none" }) : href("dashboard", { cam: c.cam }) },
      clients: c.clients, visits: c.snap.visits, payments: c.snap.payments, arChange: c.snap.arChange,
      days: c.snap.daysInAr, o120: c.snap.over120Share === null ? null : Math.round(c.snap.over120Share * 10) / 10,
      insNet: c.snap.insNetAr, crl: openCrl, pending: w?.pending ?? null,
    };
  });
  return (
    <Card title="Results by CAM" icon="cam" footer="Each CAM's figures are recomputed from their clients' numbers — not an average of their clients' percentages. Click a CAM to open the dashboard for their clients.">
      <ResultsTable
        title={`CAM view ${d.start} to ${d.end}`}
        cols={[
          { key: "cam", label: "CAM" }, { key: "clients", label: "Clients", type: "number" },
          { key: "visits", label: "Visits", type: "number" }, { key: "payments", label: "Payments", type: "money" },
          { key: "arChange", label: "Change in AR", type: "money" }, { key: "days", label: "Days in AR", type: "days", ratio: true },
          { key: "o120", label: "% 120+", type: "percent", ratio: true }, { key: "insNet", label: "Ins. Net AR", type: "money" },
          { key: "crl", label: "Open CRL", type: "number" }, { key: "pending", label: "Pending tasks", type: "number" },
        ]}
        rows={rows}
        totals={{ days: d.combined.daysInAr, o120: d.combined.over120Share }}
      />
    </Card>
  );
}

function CollectorView({ d }: { d: ResultsData }) {
  return (
    <Card title="Collector work in detail" icon="collector"
      footer={`Source: collection action report, last imported ${dateLabel(d.lastActions)}. One row per collector, action and client.`}>
      <ResultsTable
        title={`Collector detail ${d.start} to ${d.end}`}
        cols={[
          { key: "collector", label: "Collector" }, { key: "action", label: "Action" }, { key: "category", label: "Category" },
          { key: "clinic", label: "Client" }, { key: "count", label: "Actions", type: "number" },
        ]}
        rows={d.actionDetail.map((a) => ({ ...a }))}
        empty="No collection action report imported for this range."
        pageSize={50}
      />
    </Card>
  );
}

function ClientsSection({ d, href, isManager }: { d: ResultsData; href: Href; isManager: boolean }) {
  return (
    <Card title="Client Portfolio" icon="clients" footer={`${HEALTH_RULE} Days in A/R target ${DAYS_IN_AR_TARGET}; 120+ under ${OVER_120_LIMIT}%; trend flagged when days in A/R rise more than ${TREND_TOLERANCE}% against the client's own previous three months.`}>
      {isManager && (
        <div className="mb-3 rounded-lg bg-canvas/60 p-3">
          <CamAssignForm
            clients={d.rows.map((r) => ({ id: r.id, name: r.name, cam: r.cam, assignmentId: r.camAssignmentId }))}
            parties={d.parties}
          />
        </div>
      )}
      <ResultsTable
        title={`Client portfolio ${d.end}`}
        cols={[...portfolioCols(), { key: "trend", label: "Days in AR trend %", type: "percent", ratio: true }, { key: "open", label: "Open CRL", type: "number" }]}
        rows={portfolioRows(d, href).map((r, i) => ({
          ...r,
          trend: d.rows[i].sig.change === null ? null : Math.round(d.rows[i].sig.change!),
          open: d.rows[i].crlOpen,
        }))}
        totals={portfolioTotals(d)}
      />
      <div className="mt-4 text-xs font-semibold text-ink">Days in A/R, month by month</div>
      <div className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {d.rows.filter((r) => r.snap.monthsWithData > 0).map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 border-b border-hairline/60 py-1 text-xs">
            <span className="truncate">{r.name}</span>
            <Spark values={r.trend.map((t) => t.days)} limit={DAYS_IN_AR_TARGET} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function ArSection({ d, href }: { d: ResultsData; href: Href }) {
  const rows: Row[] = d.monthly.map((m) => ({
    month: monthLabel(m.month),
    visits: m.snap.visits, payments: m.snap.payments, arChange: m.snap.arChange,
    ppv: m.snap.paymentPerVisit === null ? null : Math.round(m.snap.paymentPerVisit * 100) / 100,
    days: m.snap.daysInAr,
    o120: m.snap.over120Share === null ? null : Math.round(m.snap.over120Share * 10) / 10,
    insNet: m.snap.insNetAr,
  }));
  return (
    <>
      <SnapshotTable d={d} href={href} />
      <Card title="Month by month" icon="ar" sub={d.scopeLabel}
        footer="Each month for the selected clients together. Summing the balance columns across months would mean nothing, so the total row shows the period's own figure for those.">
        <ResultsTable
          title={`AR by month ${d.start} to ${d.end}`}
          cols={[
            { key: "month", label: "Month" }, { key: "visits", label: "Visits", type: "number" }, { key: "payments", label: "Payments", type: "money" },
            { key: "arChange", label: "Change in AR", type: "money" }, { key: "ppv", label: "Avg Pmt / Visit", type: "money", ratio: true },
            { key: "days", label: "Days in AR", type: "days", ratio: true }, { key: "o120", label: "% 120+", type: "percent", ratio: true },
            { key: "insNet", label: "Ins. Net AR", type: "money", ratio: true },
          ]}
          rows={rows}
          totals={{ ppv: d.combined.paymentPerVisit, days: d.combined.daysInAr, o120: d.combined.over120Share, insNet: d.combined.insNetAr }}
          empty="No A/R figures for this range."
        />
      </Card>
    </>
  );
}

function DenialsSection({ d }: { d: ResultsData }) {
  const total = d.denials.length;
  return (
    <>
      {d.denialRate && (
        <section className="grid gap-4 xl:grid-cols-2">
          <Card title="Denial rate by client" icon="denials"
            footer="Denied claims over claims returned by the payer, by month of service. Recent months always look better — most of their claims have not come back yet. Source: Prompt Remit Allocation Report.">
            <ResultsTable
              title={`Denial rate by client ${d.start} to ${d.end}`}
              cols={[
                { key: "client", label: "Client" }, { key: "claims", label: "Claims", type: "number" },
                { key: "denied", label: "Denied", type: "number" }, { key: "rate", label: "Rate", type: "percent", ratio: true },
                { key: "amount", label: "Denied $", type: "money" }, { key: "reversals", label: "Reversals", type: "number" },
              ]}
              rows={d.denialRate.byClient.map((c) => ({
                client: c.name, claims: c.claims, denied: c.denied,
                rate: c.rate === null ? null : Math.round(c.rate * 10) / 10, amount: Math.round(c.amount), reversals: c.reversals,
              }))}
              totals={{ rate: d.denialRate.rate }}
            />
          </Card>
          <Card title="Denial rate by month" icon="calendar">
            <ResultsTable
              title={`Denial rate by month ${d.start} to ${d.end}`}
              cols={[
                { key: "month", label: "Month of service" }, { key: "claims", label: "Claims", type: "number" },
                { key: "denied", label: "Denied", type: "number" }, { key: "rate", label: "Rate", type: "percent", ratio: true },
              ]}
              rows={d.denialRate.byMonth.map((m) => ({ month: monthLabel(m.month), claims: m.claims, denied: m.denied, rate: m.rate === null ? null : Math.round(m.rate * 10) / 10 }))}
              totals={{ rate: d.denialRate.rate }}
            />
          </Card>
        </section>
      )}
      <Card title="Denials by reason" icon="denials" footer="Category comes from the denial code list (Denials page → codes). Still to agree: count by claim, visit or line, and which adjustments are not true denials.">
        <ResultsTable
          title={`Denial reasons ${d.start} to ${d.end}`}
          cols={[
            { key: "reason", label: "Reason" }, { key: "preventable", label: "Preventable" },
            { key: "count", label: "Denials", type: "number" }, { key: "share", label: "Share", type: "percent", ratio: true },
            { key: "amount", label: "Amount", type: "money" },
          ]}
          rows={d.denialGroups.map(([k, g]) => ({
            reason: k, preventable: g.preventable === null ? "—" : g.preventable ? "Yes" : "No",
            count: g.count, share: total ? Math.round((g.count / total) * 1000) / 10 : null, amount: Math.round(g.amount),
          }))}
          totals={{ share: total ? 100 : null }}
          empty="No denials recorded for these clients in this range."
        />
      </Card>
      <Card title="Every denial" icon="doc" footer="Patient names are deliberately not shown here.">
        <ResultsTable
          title={`Denials ${d.start} to ${d.end}`}
          cols={[
            { key: "date", label: "Date" }, { key: "clinic", label: "Client" }, { key: "category", label: "Reason" },
            { key: "code", label: "Code" }, { key: "carrier", label: "Carrier" }, { key: "claim", label: "Claim" },
            { key: "status", label: "Status" }, { key: "amount", label: "Amount", type: "money" },
          ]}
          rows={d.denials.map((x) => ({
            date: x.denial_date, clinic: x.clinic, category: x.category, code: x.denial_code, carrier: x.carrier,
            claim: x.claim_no, status: x.status, amount: x.amount === null ? null : Number(x.amount),
          }))}
          pageSize={50}
          empty="No denials recorded for these clients in this range."
        />
      </Card>
    </>
  );
}

function CrlSection({ d }: { d: ResultsData }) {
  const stats: [string, string][] = [
    ["Requests this period", plain(d.crlNow.requests)],
    ["Avg. response days", d.crlNow.avgResponse === null ? "—" : d.crlNow.avgResponse.toFixed(1)],
    ["Pending end of period", plain(d.crlNow.pending)],
    ["Oldest open item", d.crlNow.oldestDays === null ? "—" : `${d.crlNow.oldestDays} days`],
    ["Compliance %", pct0(d.crlNow.rate)],
  ];
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {stats.map(([l, v]) => (
          <div key={l} className="rounded-card border border-hairline bg-surface p-4 text-center shadow-card">
            <div className="text-xs font-semibold text-muted">{l}</div>
            <div className="tnum mt-1 text-2xl font-bold">{v}</div>
          </div>
        ))}
      </section>
      {d.crlNow.oldestDate && (
        <p className="text-xs text-muted">Oldest open request: {dateLabel(d.crlNow.oldestDate)} at {d.crlNow.oldestClinic ?? "—"}.</p>
      )}
      <Card title="Requests in the period, and everything still open" icon="crl"
        footer="Enter the day a client replied on the CRL page (Clinics → CRL). No pass/fail grade until a response target is agreed.">
        <ResultsTable
          title={`CRL ${d.start} to ${d.end}`}
          cols={[
            { key: "date", label: "Requested" }, { key: "clinic", label: "Client" }, { key: "sent", label: "Sent to" },
            { key: "issue", label: "Issue" }, { key: "insurance", label: "Insurance" }, { key: "state", label: "Status", type: "chip" },
            { key: "replied", label: "Client replied" }, { key: "waited", label: "Days waited", type: "days", ratio: true },
            { key: "amount", label: "Amount", type: "money" },
          ]}
          rows={d.crlList.map((c) => ({
            date: c.entry_date, clinic: c.clinic, sent: c.sent_to, issue: c.issue, insurance: c.insurance,
            state: { v: c.open ? "Open" : "Closed", tone: c.open ? "warn" : "good" },
            replied: c.responded_on, waited: c.waited, amount: c.amount === null ? null : Number(c.amount),
          }))}
          pageSize={50}
          empty={d.crlError ? "Run migration 030 first." : "No CRL entries for these clients in this range."}
        />
      </Card>
    </>
  );
}

function CamTasksSection({ d }: { d: ResultsData }) {
  const href: Href = () => "#";
  return (
    <>
      <Card title="CAM workload" icon="camtasks"
        footer="Received = created in the range; Solved = completed in the range; Pending = open at the end of the range, older carry-over included. EMR messaging is not connected yet.">
        <ResultsTable title={`CAM workload ${d.start} to ${d.end}`} cols={camCols()} rows={camRows(d, href).map((r) => ({ ...r, cam: (r.cam as { v: string }).v }))}
          empty="No tasks assigned to a CAM yet." />
      </Card>
      <Card title="The tasks" icon="doc">
        <ResultsTable
          title={`CAM tasks ${d.start} to ${d.end}`}
          cols={[
            { key: "cam", label: "CAM" }, { key: "title", label: "Task" }, { key: "clinic", label: "Client" },
            { key: "created", label: "Received" }, { key: "due", label: "Due" }, { key: "done", label: "Completed" },
            { key: "status", label: "Status", type: "chip" }, { key: "age", label: "Age (days)", type: "days", ratio: true },
          ]}
          rows={d.camTaskList.map((t) => ({
            cam: t.cam, title: t.title, clinic: t.clinic, created: t.created_at.slice(0, 10), due: t.due_on,
            done: t.completed_at?.slice(0, 10) ?? null,
            status: { v: t.status.replace("_", " "), tone: t.status === "done" ? "good" : t.status === "blocked" ? "bad" : "warn" },
            age: t.age,
          }))}
          pageSize={50}
          empty="No CAM tasks in this range."
        />
      </Card>
    </>
  );
}

function CollectorTasksSection({ d }: { d: ResultsData }) {
  const href: Href = () => "#";
  return (
    <>
      <Card title="Collector workload" icon="collectortasks"
        footer="Counts of actions worked. The source report has no received/solved/pending state per task and no latest note — those need the AdvancedMD collections module export (and Prompt's notes for Prompt clients), expected weekly via ODBC.">
        <ResultsTable title={`Collector workload ${d.start} to ${d.end}`} cols={collectorCols()}
          rows={collectorRows(d, href).map((r) => ({ ...r, collector: (r.collector as { v: string }).v }))}
          empty="No collection action report imported for this range." />
      </Card>
      <CollectorView d={d} />
    </>
  );
}

function UtilizationSection({ d, isManager }: { d: ResultsData; isManager: boolean }) {
  return (
    <>
      <Card title="Add-on codes" icon="utilization" footer="Billed charges and units from Service Details in the monthly pack. Payments by code and a provider split need a transaction-level report.">
        {d.addonTableMissing ? (
          <p className="text-sm text-muted">Run migration 030 to create the add-on code list.</p>
        ) : (
          <ResultsTable
            title={`Add-on codes ${d.start} to ${d.end}`}
            cols={[
              { key: "code", label: "CPT" }, { key: "desc", label: "Description" },
              { key: "units", label: "Units", type: "number" }, { key: "charges", label: "Billed", type: "money" },
              { key: "paid", label: "Paid", type: "money" }, { key: "perUnit", label: "Paid / unit", type: "money", ratio: true },
              { key: "clients", label: "Clients billing it", type: "number" },
            ]}
            rows={d.addonUse.map(([code, u]) => ({
              code, desc: u.desc, units: u.units, charges: Math.round(u.charges),
              paid: u.paid === null ? null : Math.round(u.paid), perUnit: u.paid !== null && u.units ? Math.round((u.paid / u.units) * 100) / 100 : null,
              clients: u.clients.size,
            }))}
            empty={d.addons.length ? "None of the chosen codes were billed in this range." : "No add-on codes chosen yet — add them below."}
          />
        )}
        {isManager && !d.addonTableMissing && <AddonEditor codes={d.addons} />}
      </Card>
      <Card title="Add-on use by client" icon="clients">
        <ResultsTable
          title={`Add-on codes by client ${d.start} to ${d.end}`}
          cols={[{ key: "client", label: "Client" }, { key: "cam", label: "CAM" }, { key: "units", label: "Units", type: "number" }, { key: "charges", label: "Billed", type: "money" }, { key: "paid", label: "Paid", type: "money" }]}
          rows={d.rows.filter((r) => d.addonByClient.has(r.id)).map((r) => {
            const a = d.addonByClient.get(r.id)!;
            return { client: r.name, cam: r.cam, units: a.units, charges: Math.round(a.charges), paid: a.paid === null ? null : Math.round(a.paid) };
          })}
          empty="No add-on codes billed by these clients in this range."
        />
      </Card>
    </>
  );
}

function ReportsSection({ href }: { href: Href }) {
  const items: [SectionKey, string, string][] = [
    ["client", "Client results", "Every client with every snapshot measure. Excel or CSV from the table."],
    ["cam", "CAM results", "Each CAM's clients combined, recomputed."],
    ["ar", "A/R by month", "The selected clients month by month."],
    ["denials", "Denials", "By reason, and every denial row."],
    ["crl", "CRL", "Requests, replies and what is still open."],
    ["camtasks", "CAM tasks", "Received, solved, pending — and the tasks themselves."],
    ["collectortasks", "Collector work", "Actions by collector, action and client."],
    ["utilization", "Add-on codes", "Units and charges by code and by client."],
  ];
  return (
    <Card title="Reports" icon="reports" footer="Every table has Excel and CSV buttons, and exports exactly what is on screen after filters. The client-facing monthly workbook is under Clinics → Monthly packs.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([k, t, desc]) => (
          <Link key={k} href={href(k)} className="rounded-lg border border-hairline p-3 transition hover:border-brandMid hover:shadow-card">
            <div className="flex items-center gap-2 font-semibold text-ink"><span className="text-brandMid"><Icon name={k} /></span>{t}</div>
            <p className="mt-1 text-xs text-muted">{desc}</p>
          </Link>
        ))}
        <Link href="/packs" className="rounded-lg border border-hairline p-3 transition hover:border-brandMid hover:shadow-card">
          <div className="flex items-center gap-2 font-semibold text-ink"><span className="text-brandMid"><Icon name="doc" /></span>Monthly packs</div>
          <p className="mt-1 text-xs text-muted">The nine-sheet client workbook, any clinic, any period.</p>
        </Link>
      </div>
    </Card>
  );
}
