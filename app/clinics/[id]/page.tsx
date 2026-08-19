import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetchAll";
import AppHeader from "@/components/AppHeader";
import ExportButtons from "@/components/ExportButtons";
import TrendChart from "@/components/TrendChart";
import type { Profile } from "@/lib/types";
import { buildInsights, headlineSentence, type MonthFacts } from "@/lib/insights";

export const dynamic = "force-dynamic";

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthLabel = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });

const pct = (part: number, whole: number) =>
  whole === 0 ? "—" : `${((part / whole) * 100).toFixed(1)}%`;

const TABS = [
  { key: "summary", label: "Summary" },
  { key: "profile", label: "Profile" },
  { key: "ar", label: "A/R" },
  { key: "activity", label: "Activity" },
  { key: "carriers", label: "Carriers" },
  { key: "services", label: "Services" },
  { key: "referrals", label: "Referrals" },
  { key: "history", label: "History" },
] as const;

type TabKey = (typeof TABS)[number]["key"];
type Row = Record<string, number>;

export default async function ClinicPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { month?: string; tab?: string; span?: string; fc?: string };
}) {
  const supabase = createClient();
  const clinicId = Number(params.id);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "")
    .maybeSingle();

  const { data: clinic } = await supabase
    .from("clinics")
    .select("*")
    .eq("id", clinicId)
    .maybeSingle();

  if (!clinic) notFound();

  const { data: monthRows } = await supabase
    .from("clinic_monthly")
    .select("period_month")
    .eq("clinic_id", clinicId)
    .order("period_month", { ascending: false });

  const months = (monthRows ?? []).map((m) => (m.period_month as string).slice(0, 7));
  const selected =
    searchParams.month && months.includes(searchParams.month) ? searchParams.month : months[0];
  const period = selected ? `${selected}-01` : null;

  const tab: TabKey = (TABS.find((t) => t.key === searchParams.tab)?.key ?? "summary") as TabKey;

  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    if (selected) p.set("month", selected);
    p.set("tab", tab);
    if (searchParams.span) p.set("span", searchParams.span);
    if (searchParams.fc) p.set("fc", searchParams.fc);
    for (const [k, v] of Object.entries(over)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `/clinics/${clinicId}?${p.toString()}`;
  };

  const { data: classes } = await supabase
    .from("financial_classes")
    .select("id, code, name")
    .order("sort_order");
  const className = new Map(
    (classes ?? []).map((c) => [c.id as number, { code: c.code as string, name: c.name as string }])
  );

  // The aging buckets are the first thing anyone reads on these screens, so the
// column headings carry the ramp: cool is fresh money, hot has been sitting.
const AGE_TINT: Record<string, { color: string } | undefined> = {
  Current: { color: "#0E8577" },
  "30": { color: "#4E9A4B" },
  "60": { color: "#C08D21" },
  "90": { color: "#CB6B22" },
  "120+": { color: "#A93226" },
};

const noRows = { data: [] as Row[] };

  const [summaryRes, arRes, actRes, splitRes] = await Promise.all([
    period
      ? supabase
          .from("clinic_monthly")
          .select("*")
          .eq("clinic_id", clinicId)
          .eq("period_month", period)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    period
      ? supabase.from("ar_monthly").select("*").eq("clinic_id", clinicId).eq("period_month", period)
      : Promise.resolve(noRows),
    period
      ? supabase.from("activity_monthly").select("*").eq("clinic_id", clinicId).eq("period_month", period)
      : Promise.resolve(noRows),
    period
      ? supabase.from("ar_split_monthly").select("*").eq("clinic_id", clinicId).eq("period_month", period)
      : Promise.resolve(noRows),
  ]);

  const summary = summaryRes.data as Record<string, number | null> | null;
  const ar = (arRes.data ?? []) as Row[];
  const act = (actRes.data ?? []) as Row[];
  const split = (splitRes.data ?? []) as Record<string, unknown>[];

  const actById = new Map(act.map((a) => [a.financial_class_id, a]));
  const totalAr = ar.reduce((s, r) => s + (r.closing_ar ?? 0), 0);
  const total120 = ar.reduce((s, r) => s + (r.bucket_120_plus ?? 0), 0);
  const totalCharges = act.reduce((s, r) => s + (r.charges ?? 0), 0);
  const totalPayments = act.reduce((s, r) => s + (r.payments ?? 0), 0);
  const totalAdjust = act.reduce((s, r) => s + (r.adjustments ?? 0), 0);
  const totalUnits = act.reduce((s, r) => s + (r.units ?? 0), 0);
  const ranked = [...ar].sort((a, b) => (b.closing_ar ?? 0) - (a.closing_ar ?? 0));

  // Through the roll-up view, not the raw table. One clinic's decade of
  // history is over 1,200 financial-class rows, which is past Supabase's
  // response cap — the oldest months came back and the newest silently did
  // not. The view is one row per month.
  const { rows: historyRows } = await fetchAllRows<{
    period_month: string;
    charges: number | null;
    payments: number | null;
    adjustments: number | null;
    visits: number | null;
    new_patients: number | null;
  }>((lo, hi) =>
    supabase
      .from("activity_clinic_month")
      .select("period_month, charges, payments, adjustments, visits, new_patients")
      .eq("clinic_id", clinicId)
      .order("period_month")
      .range(lo, hi)
  );

  const byMonth = new Map<
    string,
    { charges: number; payments: number; adjustments: number; visits: number; newPatients: number }
  >();
  for (const r of historyRows ?? []) {
    const m = (r.period_month as string).slice(0, 7);
    const acc = byMonth.get(m) ?? {
      charges: 0,
      payments: 0,
      adjustments: 0,
      visits: 0,
      newPatients: 0,
    };
    acc.charges += (r.charges as number) ?? 0;
    acc.payments += (r.payments as number) ?? 0;
    acc.adjustments += (r.adjustments as number) ?? 0;
    acc.visits += (r.visits as number) ?? 0;
    acc.newPatients += (r.new_patients as number) ?? 0;
    byMonth.set(m, acc);
  }
  const allTrendMonths = Array.from(byMonth.keys()).sort();

  const spans = [
    { key: "12", label: "1 year", take: 12 },
    { key: "36", label: "3 years", take: 36 },
    { key: "all", label: "All", take: Number.MAX_SAFE_INTEGER },
  ];
  const span = spans.find((o) => o.key === searchParams.span) ?? spans[1];
  const trendMonths = allTrendMonths.slice(Math.max(0, allTrendMonths.length - span.take));
  const trend = trendMonths.map((m) => byMonth.get(m)!);

  const last12Months = allTrendMonths.slice(-12);
  const last12 = last12Months.map((m) => byMonth.get(m)!);
  const billed12 = last12.reduce((a, t) => a + t.charges, 0);
  const collected12 = last12.reduce((a, t) => a + t.payments, 0);

  let carrierRows: Row[] = [];
  let carrierNameById = new Map<number, string>();
  const { data: peopleRows } =
    tab === "profile"
      ? await supabase
          .from("clinic_people")
          .select("*")
          .eq("clinic_id", clinicId)
          .order("kind")
          .order("sort_order")
          .order("full_name")
      : { data: [] };

  const people = (peopleRows ?? []) as {
    id: number;
    kind: string;
    full_name: string;
    title: string | null;
    credential: string | null;
    npi: string | null;
    email: string | null;
    phone: string | null;
    is_primary: boolean;
    is_active: boolean;
    note: string | null;
  }[];

  if (tab === "carriers" && period) {
    const { data } = await supabase
      .from("carrier_ar_monthly")
      .select("carrier_id, bucket_current, bucket_30, bucket_60, bucket_90, bucket_120_plus, total_ar")
      .eq("clinic_id", clinicId)
      .eq("period_month", period)
      .order("total_ar", { ascending: false });
    carrierRows = (data ?? []) as Row[];
    const { data: names } = await supabase.from("carriers").select("id, name");
    carrierNameById = new Map((names ?? []).map((c) => [c.id as number, c.name as string]));
  }

  let serviceRows: Row[] = [];
  let procById = new Map<number, { code: string; desc: string }>();
  if (tab === "services" && period) {
    let q = supabase
      .from("service_monthly")
      .select("procedure_id, financial_class_id, units, charges")
      .eq("clinic_id", clinicId)
      .eq("period_month", period);
    if (searchParams.fc) q = q.eq("financial_class_id", Number(searchParams.fc));
    const { data } = await q;
    serviceRows = (data ?? []) as Row[];
    const { data: procs } = await supabase.from("procedures").select("id, code, description");
    procById = new Map(
      (procs ?? []).map((p) => [
        p.id as number,
        { code: p.code as string, desc: (p.description as string) ?? "" },
      ])
    );
  }

  let referralRows: Row[] = [];
  let refById = new Map<number, { name: string; city: string }>();
  if (tab === "referrals" && period) {
    const { data } = await supabase
      .from("referrals_monthly")
      .select("referring_provider_id, new_patients_mtd, visits_mtd, visits_ytd, ytd_charges")
      .eq("clinic_id", clinicId)
      .eq("period_month", period)
      .order("visits_mtd", { ascending: false })
      .limit(40);
    referralRows = (data ?? []) as Row[];
    const { data: refs } = await supabase.from("referring_providers").select("id, name, city");
    refById = new Map(
      (refs ?? []).map((r) => [
        r.id as number,
        { name: r.name as string, city: (r.city as string) ?? "" },
      ])
    );
  }

  // ---- the written summary -------------------------------------------------
  // Built from the figures already loaded above, so the page and the
  // downloadable report say exactly the same thing.
  const { data: allCarriers } = period
    ? await supabase
        .from("carrier_ar_monthly")
        .select("carrier_id, bucket_120_plus, total_ar")
        .eq("clinic_id", clinicId)
        .eq("period_month", period)
    : { data: [] };

  const { data: carrierNamesAll } = await supabase.from("carriers").select("id, name");
  const nameOfCarrier = new Map((carrierNamesAll ?? []).map((c) => [c.id as number, c.name as string]));

  const staleCarriers = ((allCarriers ?? []) as Row[])
    .filter((c) => (c.total_ar ?? 0) > 5000 && (c.bucket_120_plus ?? 0) / (c.total_ar ?? 1) > 0.9)
    .map((c) => ({
      name: nameOfCarrier.get(c.carrier_id) ?? "—",
      total: c.total_ar ?? 0,
      over120: c.bucket_120_plus ?? 0,
    }))
    .sort((a, b) => b.total - a.total);

  const facts: MonthFacts | null = selected
    ? {
        month: selected,
        openingAr: summary?.opening_ar ?? null,
        closingAr: summary?.closing_ar ?? null,
        arChange: summary?.ar_change ?? null,
        charges: summary?.charges ?? null,
        adjustments: summary?.adjustments ?? null,
        paymentsPatient: summary?.payments_patient ?? null,
        paymentsInsurance: summary?.payments_insurance ?? null,
        patientsWithBalance: summary?.patients_with_balance ?? null,
        classes: ar.map((r) => ({
          code: className.get(r.financial_class_id)?.code ?? "",
          name: className.get(r.financial_class_id)?.name ?? "",
          total: r.closing_ar ?? 0,
          over120: r.bucket_120_plus ?? 0,
        })),
        split: split.map((sp) => ({
          payerType: sp.payer_type as string,
          total: (sp.total_ar as number) ?? 0,
          unapplied: (sp.unapplied as number) ?? 0,
        })),
        staleCarriers,
        history: allTrendMonths.map((m) => ({ month: m, ...byMonth.get(m)! })),
      }
    : null;

  const insights = facts ? buildInsights(facts) : [];
  const lede = facts ? headlineSentence(facts, clinic.name as string) : "";

  const toneClass: Record<string, string> = {
    good: "border-l-good",
    watch: "border-l-warn",
    bad: "border-l-bad",
    neutral: "border-l-muted",
  };

  const th = "py-2 text-right font-mono text-[11px] uppercase tracking-wider text-muted";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <>
      <AppHeader profile={(profile as Profile) ?? null} />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <Link href="/clinics" className="font-mono text-xs text-muted hover:text-ink">
          ← All clinics
        </Link>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{clinic.name}</h1>
            {selected && <p className="mt-1 text-sm text-muted">{monthLabel(period!)}</p>}
          </div>

          {months.length > 0 && (
            <form className="flex items-center gap-2">
              <input type="hidden" name="tab" value={tab} />
              <select
                name="month"
                defaultValue={selected}
                className="rounded-card border border-hairline bg-surface shadow-card px-3 py-1.5 text-sm"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(`${m}-01`)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-white"
              >
                Show
              </button>
            </form>
          )}

          <Link
            href={`/notes?clinic=${clinicId}${selected ? `&month=${selected}` : ""}`}
            className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-white"
          >
            Meeting notes
          </Link>

          {selected && (
            <a
              href={`/clinics/${clinicId}/report?month=${selected}`}
              className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90"
            >
              ↓ Download report
            </a>
          )}
        </div>

        {!selected ? (
          <div className="mt-8 rounded-card border border-dashed border-hairline bg-surface p-10 text-center">
            <h2 className="text-lg font-medium">Nothing imported for {clinic.name}</h2>
            <p className="mt-2 text-sm text-muted">
              This page fills in once a month has been loaded for this clinic.
            </p>
            <Link
              href="/import"
              className="mt-5 inline-block rounded bg-accent px-4 py-2 text-sm text-white"
            >
              Import a month
            </Link>
          </div>
        ) : (
          <>
            <nav className="mt-6 flex flex-wrap gap-1 border-b border-hairline">
              {TABS.map((t) => (
                <Link
                  key={t.key}
                  href={`/clinics/${clinicId}?month=${selected}&tab=${t.key}`}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                    t.key === tab
                      ? "border-accent font-medium text-ink"
                      : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </nav>

            {tab === "summary" && (
              <div className="mt-8 space-y-10">
                <section>
                  <p className="rounded-card border border-hairline bg-surface shadow-card p-5 text-[17px] leading-relaxed">
                    {lede}
                  </p>

                  <h2 className={`${thL} mt-8`}>What this month says</h2>
                  <div className="mt-2 space-y-2">
                    {insights.map((i, n) => (
                      <div
                        key={n}
                        className={`rounded border border-hairline border-l-[3px] bg-white px-4 py-3 ${
                          toneClass[i.tone]
                        }`}
                      >
                        <div className="font-medium">{i.headline}</div>
                        {i.detail && <div className="mt-1 text-sm text-muted">{i.detail}</div>}
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h2 className={thL}>Change in A/R</h2>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-card border border-hairline bg-surface shadow-card p-4">
                      <div className="text-xs text-muted">Beginning</div>
                      <div className="tnum mt-1 text-xl">{money(summary?.opening_ar)}</div>
                    </div>
                    <div className="rounded-card border border-hairline bg-surface shadow-card p-4">
                      <div className="text-xs text-muted">Increase / (decrease)</div>
                      <div
                        className={`tnum mt-1 text-xl ${
                          (summary?.ar_change ?? 0) > 0 ? "text-bad" : "text-good"
                        }`}
                      >
                        {(summary?.ar_change ?? 0) > 0 ? "+" : ""}
                        {money(summary?.ar_change)}
                      </div>
                    </div>
                    <div className="rounded-card border border-hairline bg-surface shadow-card p-4">
                      <div className="text-xs text-muted">Ending</div>
                      <div className="tnum mt-1 text-xl">{money(summary?.closing_ar)}</div>
                    </div>
                  </div>
                </section>

                <section>
                  <h2 className={thL}>Transaction summary</h2>
                  <table className="mt-3 w-full max-w-lg text-sm">
                    <tbody>
                      {[
                        ["Charges", summary?.charges],
                        ["Adjustments", summary?.adjustments],
                        ["Patient payments", summary?.payments_patient],
                        ["Insurance payments", summary?.payments_insurance],
                      ].map(([label, v]) => (
                        <tr key={label as string} className="border-b border-hairline/60">
                          <td className="py-2">{label as string}</td>
                          <td className="tnum py-2 text-right">{money(v as number)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-hairline font-medium">
                        <td className="py-2">Total payments</td>
                        <td className="tnum py-2 text-right">
                          {money(
                            (summary?.payments_patient ?? 0) + (summary?.payments_insurance ?? 0)
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </section>

                <section>
                  <h2 className={thL}>Patient balances</h2>
                  <div className="mt-3 flex flex-wrap gap-8">
                    <div>
                      <div className="text-xs text-muted">Patients with a balance</div>
                      <div className="tnum text-xl">
                        {summary?.patients_with_balance?.toLocaleString() ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">Average balance</div>
                      <div className="tnum text-xl">{money(summary?.average_patient_balance)}</div>
                    </div>
                  </div>
                </section>

                {split.length > 0 && (
                  <section>
                    <h2 className={thL}>Current A/R — insurance and patient</h2>
                    <table className="mt-3 w-full text-sm">
                      <thead>
                        <tr className="border-b border-hairline">
                          <th className={thL}></th>
                          {[
                            "Current",
                            "Over 30",
                            "Over 60",
                            "Over 90",
                            "Over 120",
                            "Total",
                            "Unapplied",
                            "Net",
                          ].map((h) => (
                            <th key={h} className={th}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {split.map((s) => (
                          <tr key={s.payer_type as string} className="border-b border-hairline/60">
                            <td className="py-2 capitalize">{s.payer_type as string}</td>
                            <td className="tnum py-2 text-right">{money(s.bucket_current as number)}</td>
                            <td className="tnum py-2 text-right">{money(s.bucket_30 as number)}</td>
                            <td className="tnum py-2 text-right">{money(s.bucket_60 as number)}</td>
                            <td className="tnum py-2 text-right">{money(s.bucket_90 as number)}</td>
                            <td className="tnum py-2 text-right text-bad">
                              {money(s.bucket_120_plus as number)}
                            </td>
                            <td className="tnum py-2 text-right">{money(s.total_ar as number)}</td>
                            <td className="tnum py-2 text-right text-muted">
                              {money(s.unapplied as number)}
                            </td>
                            <td className="tnum py-2 text-right font-medium">
                              {money(s.net_ar as number)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-xs text-muted">
                      Unapplied is money received but not yet posted to a claim, which is why total
                      and net differ.
                    </p>
                  </section>
                )}

                {last12Months.length > 1 && (
                  <section>
                    <h2 className={thL}>Monthly activity — last 12 months</h2>
                    <div className="mt-3 rounded-card border border-hairline bg-surface shadow-card p-4">
                      <div className="mb-2 flex flex-wrap gap-4 text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-0.5 w-4 bg-accent" /> Charges
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-0.5 w-4 bg-good" /> Payments
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-0.5 w-4 bg-warn" /> Adjustments
                        </span>
                      </div>
                      <TrendChart
                        months={last12Months}
                        series={[
                          { label: "Charges", color: "#12586B", values: last12.map((t) => t.charges) },
                          { label: "Payments", color: "#2F6B4F", values: last12.map((t) => t.payments) },
                          {
                            label: "Adjustments",
                            color: "#B4761A",
                            values: last12.map((t) => Math.abs(t.adjustments)),
                          },
                        ]}
                      />
                      <p className="mt-3 border-t border-hairline pt-3 text-sm text-muted">
                        {money(billed12)} billed, {money(collected12)} collected —{" "}
                        <span className="font-medium text-ink">
                          {billed12 > 0 ? ((collected12 / billed12) * 100).toFixed(1) : "—"}%
                        </span>
                        . Adjustments are drawn as positive so the three lines compare.
                      </p>
                    </div>
                  </section>
                )}
              </div>
            )}

            {tab === "profile" && (
              <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
                <section className="rounded-card border border-hairline bg-surface p-5 shadow-card">
                  <h2 className="text-base font-medium">{clinic.name}</h2>
                  {clinic.specialty && (
                    <p className="mt-0.5 text-sm text-muted">{clinic.specialty}</p>
                  )}

                  <dl className="mt-4 space-y-3 text-sm">
                    {[
                      [
                        "Address",
                        [clinic.address_line1, clinic.address_line2, [clinic.city, clinic.state, clinic.postal_code].filter(Boolean).join(" ")]
                          .filter(Boolean)
                          .join("\n"),
                      ],
                      ["Phone", clinic.phone],
                      ["Fax", clinic.fax],
                      ["Email", clinic.email],
                      ["Website", clinic.website],
                      ["Group NPI", clinic.group_npi],
                      ["Tax ID", clinic.tax_id],
                      ["AdvancedMD office", clinic.amd_office_key],
                      ["Code", clinic.code],
                      ["Status", clinic.status],
                      ["Went live", clinic.go_live_date],
                    ].map(([label, value]) => (
                      <div key={label as string} className="grid grid-cols-[9rem_1fr] gap-3">
                        <dt className="eyebrow pt-0.5">{label as string}</dt>
                        <dd className={value ? "whitespace-pre-line" : "text-muted"}>
                          {(value as string) || "—"}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {clinic.profile_note && (
                    <p className="mt-4 whitespace-pre-line border-l-2 border-accent pl-3 text-sm">
                      {clinic.profile_note}
                    </p>
                  )}

                  <p className="mt-5 text-xs text-muted">
                    These details are entered by hand under Settings → Clinics. They do not come
                    from the monthly pack, which carries figures and nothing else.
                  </p>
                </section>

                <section className="rounded-card border border-hairline bg-surface p-5 shadow-card">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-base font-medium">People</h2>
                    <ExportButtons
                      title={`${clinic.name} people`}
                      headers={["Kind", "Name", "Credential", "Title", "NPI", "Email", "Phone", "Primary"]}
                      rows={people.map((p) => [
                        p.kind,
                        p.full_name,
                        p.credential ?? "",
                        p.title ?? "",
                        p.npi ?? "",
                        p.email ?? "",
                        p.phone ?? "",
                        p.is_primary ? "yes" : "",
                      ])}
                    />
                  </div>

                  {people.length === 0 ? (
                    <p className="mt-4 rounded border border-dashed border-hairline px-4 py-8 text-center text-sm text-muted">
                      Nobody recorded for this clinic yet. Contacts and treating providers are added
                      under Settings → Clinics.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-6">
                      {[
                        ["contact", "Contacts"],
                        ["owner", "Owner"],
                        ["billing", "Billing"],
                        ["front_desk", "Front desk"],
                        ["provider", "Providers"],
                        ["other", "Other"],
                      ].map(([kind, label]) => {
                        const group = people.filter((p) => p.kind === kind && p.is_active);
                        if (group.length === 0) return null;
                        return (
                          <div key={kind as string}>
                            <h3 className="eyebrow">{label as string}</h3>
                            <ul className="mt-2 space-y-2">
                              {group.map((p) => (
                                <li key={p.id} className="text-sm">
                                  <span className="font-medium">{p.full_name}</span>
                                  {p.credential && (
                                    <span className="ml-1.5 text-muted">{p.credential}</span>
                                  )}
                                  {p.is_primary && (
                                    <span className="ml-2 rounded bg-accentSoft px-1.5 py-0.5 text-[10px] text-accent">
                                      primary
                                    </span>
                                  )}
                                  <div className="text-xs text-muted">
                                    {[p.title, p.npi ? `NPI ${p.npi}` : null].filter(Boolean).join(" · ")}
                                  </div>
                                  <div className="text-xs">
                                    {p.email && (
                                      <a href={`mailto:${p.email}`} className="text-accent hover:underline">
                                        {p.email}
                                      </a>
                                    )}
                                    {p.email && p.phone && <span className="text-muted"> · </span>}
                                    {p.phone && <span className="text-muted">{p.phone}</span>}
                                  </div>
                                  {p.note && <div className="mt-0.5 text-xs text-muted">{p.note}</div>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {people.some((p) => !p.is_active) && (
                    <p className="mt-4 text-xs text-muted">
                      People who have left are kept but not shown — a provider who treated patients
                      last year still explains last year&apos;s claims.
                    </p>
                  )}
                </section>
              </div>
            )}

            {tab === "ar" && (
              <div className="mt-8 space-y-8">
                <div className="flex justify-end">
                  <ExportButtons
                    title={`${clinic.name} A-R ${selected}`}
                    headers={["Financial class", "Current", "30", "60", "90", "120+", "Total", "Share %"]}
                    rows={ranked.map((r) => [
                      r.className,
                      r.bucket_current ?? 0,
                      r.bucket_30 ?? 0,
                      r.bucket_60 ?? 0,
                      r.bucket_90 ?? 0,
                      r.bucket_120_plus ?? 0,
                      r.closing_ar ?? 0,
                      totalAr ? Math.round(((r.closing_ar ?? 0) / totalAr) * 1000) / 10 : 0,
                    ])}
                  />
                </div>
                <section className="rounded-card border border-hairline bg-surface shadow-card p-5">
                  <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
                    <div>
                      <div className={thL}>Over 120 days</div>
                      <div className="tnum text-2xl font-medium text-bad">{money(total120)}</div>
                    </div>
                    <div className="text-sm text-muted">
                      <span className="tnum font-medium text-ink">{pct(total120, totalAr)}</span> of all
                      outstanding A/R is more than four months old.
                      {ranked[0] && (ranked[0].closing_ar ?? 0) / totalAr > 0.4 && (
                        <>
                          {" "}
                          <span className="font-medium text-ink">
                            {className.get(ranked[0].financial_class_id)?.name}
                          </span>{" "}
                          alone accounts for {pct(ranked[0].closing_ar ?? 0, totalAr)}.
                        </>
                      )}
                    </div>
                  </div>
                </section>

                <section>
                  <h2 className={thL}>A/R aging by financial class</h2>
                  <table className="mt-3 w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline">
                        <th className={thL}>Class</th>
                        {["Current", "30", "60", "90", "120+", "Total", "Share"].map((h) => (
                          <th key={h} className={th} style={AGE_TINT[h]}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ranked.map((r) => {
                        const c = className.get(r.financial_class_id);
                        const stale =
                          (r.closing_ar ?? 0) > 0 &&
                          (r.bucket_120_plus ?? 0) / (r.closing_ar ?? 1) > 0.8;
                        return (
                          <tr key={r.financial_class_id} className="border-b border-hairline/60">
                            <td className="py-2">
                              <span className="font-mono text-xs text-muted">{c?.code}</span> {c?.name}
                            </td>
                            <td className="tnum py-2 text-right">{money(r.bucket_current)}</td>
                            <td className="tnum py-2 text-right">{money(r.bucket_30)}</td>
                            <td className="tnum py-2 text-right">{money(r.bucket_60)}</td>
                            <td className="tnum py-2 text-right">{money(r.bucket_90)}</td>
                            <td
                              className={`tnum py-2 text-right ${stale ? "font-medium text-bad" : ""}`}
                            >
                              {money(r.bucket_120_plus)}
                            </td>
                            <td className="tnum py-2 text-right font-medium">{money(r.closing_ar)}</td>
                            <td className="tnum py-2 text-right text-muted">
                              {pct(r.closing_ar ?? 0, totalAr)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-hairline font-medium">
                        <td className="py-2">Grand total</td>
                        <td colSpan={4}></td>
                        <td className="tnum py-2 text-right text-bad">{money(total120)}</td>
                        <td className="tnum py-2 text-right">{money(totalAr)}</td>
                        <td className="tnum py-2 text-right text-muted">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </section>

                <section>
                  <h2 className={thL}>Where the balance sits</h2>
                  <div className="mt-3 space-y-2">
                    {ranked
                      .filter((r) => (r.closing_ar ?? 0) > 0)
                      .map((r) => {
                        const c = className.get(r.financial_class_id);
                        const width = totalAr > 0 ? ((r.closing_ar ?? 0) / totalAr) * 100 : 0;
                        const stalePart =
                          (r.closing_ar ?? 0) > 0
                            ? ((r.bucket_120_plus ?? 0) / (r.closing_ar ?? 1)) * 100
                            : 0;
                        return (
                          <div key={r.financial_class_id} className="flex items-center gap-3 text-sm">
                            <div className="w-48 shrink-0 truncate text-muted">{c?.name}</div>
                            <div className="h-4 flex-1 overflow-hidden rounded-sm bg-hairline">
                              <div className="h-full bg-accent/25" style={{ width: `${width}%` }}>
                                <div className="h-full bg-bad/60" style={{ width: `${stalePart}%` }} />
                              </div>
                            </div>
                            <div className="tnum w-32 shrink-0 text-right">{money(r.closing_ar)}</div>
                          </div>
                        );
                      })}
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    Bar length is the class&apos;s share of total A/R; the darker portion inside it is
                    the part over 120 days.
                  </p>
                </section>
              </div>
            )}

            {tab === "activity" && (
              <div className="mt-8 space-y-8">
                <div className="grid gap-3 sm:grid-cols-4">
                  {[
                    ["Units", totalUnits.toLocaleString()],
                    ["Charges", money(totalCharges)],
                    ["Payments", money(totalPayments)],
                    ["Adjustments", money(totalAdjust)],
                  ].map(([l, v]) => (
                    <div key={l} className="rounded-card border border-hairline bg-surface shadow-card p-4">
                      <div className={thL}>{l}</div>
                      <div className="tnum mt-1 text-lg font-medium">{v}</div>
                    </div>
                  ))}
                </div>

                <section>
                  <h2 className={thL}>Financial activity by class</h2>
                  <table className="mt-3 w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline">
                        <th className={thL}>Class</th>
                        {["Units", "Charges", "Charge mix", "Payments", "Payment mix", "Adjustments"].map(
                          (h) => (
                            <th key={h} className={th}>
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {ranked.map((r) => {
                        const a = actById.get(r.financial_class_id);
                        const c = className.get(r.financial_class_id);
                        if (!a) return null;
                        return (
                          <tr key={r.financial_class_id} className="border-b border-hairline/60">
                            <td className="py-2">
                              <span className="font-mono text-xs text-muted">{c?.code}</span> {c?.name}
                            </td>
                            <td className="tnum py-2 text-right">{(a.units ?? 0).toLocaleString()}</td>
                            <td className="tnum py-2 text-right">{money(a.charges)}</td>
                            <td className="tnum py-2 text-right text-muted">
                              {pct(a.charges ?? 0, totalCharges)}
                            </td>
                            <td className="tnum py-2 text-right">{money(a.payments)}</td>
                            <td className="tnum py-2 text-right text-muted">
                              {pct(a.payments ?? 0, totalPayments)}
                            </td>
                            <td className="tnum py-2 text-right">{money(a.adjustments)}</td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-hairline font-medium">
                        <td className="py-2">Grand total</td>
                        <td className="tnum py-2 text-right">{totalUnits.toLocaleString()}</td>
                        <td className="tnum py-2 text-right">{money(totalCharges)}</td>
                        <td className="tnum py-2 text-right text-muted">100%</td>
                        <td className="tnum py-2 text-right">{money(totalPayments)}</td>
                        <td className="tnum py-2 text-right text-muted">100%</td>
                        <td className="tnum py-2 text-right">{money(totalAdjust)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted">
                    Mix percentages are computed here, not stored, so they stay true if the month is
                    re-imported.
                  </p>
                </section>
              </div>
            )}

            {tab === "carriers" && (
              <div className="mt-8">
                <div className="mb-3 flex justify-end">
                  <ExportButtons
                    title={`${clinic.name} carriers ${selected}`}
                    headers={["Carrier", "Current", "30", "60", "90", "120+", "Total"]}
                    rows={carrierRows.map((c) => [
                      c.name ?? "",
                      c.bucket_current ?? 0,
                      c.bucket_30 ?? 0,
                      c.bucket_60 ?? 0,
                      c.bucket_90 ?? 0,
                      c.bucket_120_plus ?? 0,
                      c.total_ar ?? 0,
                    ])}
                  />
                </div>
                {carrierRows.length === 0 ? (
                  <p className="rounded-card border border-dashed border-hairline bg-surface p-8 text-center text-sm text-muted">
                    No carrier detail imported for {monthLabel(period!)}.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted">
                      {carrierRows.length} carriers,{" "}
                      {money(carrierRows.reduce((a, c) => a + (c.total_ar ?? 0), 0))} outstanding. This
                      is the insurance side only — patient balances are not attributed to a carrier.
                    </p>
                    <table className="mt-3 w-full text-sm">
                      <thead>
                        <tr className="border-b border-hairline">
                          <th className={thL}>Carrier</th>
                          {["Current", "30", "60", "90", "120+", "Total", "Share"].map((h) => (
                            <th key={h} className={th} style={AGE_TINT[h]}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {carrierRows.slice(0, 40).map((c) => {
                          const total = c.total_ar ?? 0;
                          const over = c.bucket_120_plus ?? 0;
                          const grand = carrierRows.reduce((a, x) => a + (x.total_ar ?? 0), 0);
                          return (
                            <tr key={c.carrier_id} className="border-b border-hairline/60">
                              <td className="py-2">{carrierNameById.get(c.carrier_id)}</td>
                              <td className="tnum py-2 text-right">{money(c.bucket_current)}</td>
                              <td className="tnum py-2 text-right">{money(c.bucket_30)}</td>
                              <td className="tnum py-2 text-right">{money(c.bucket_60)}</td>
                              <td className="tnum py-2 text-right">{money(c.bucket_90)}</td>
                              <td
                                className={`tnum py-2 text-right ${
                                  total > 0 && over / total > 0.8 ? "font-medium text-bad" : ""
                                }`}
                              >
                                {money(over)}
                              </td>
                              <td className="tnum py-2 text-right font-medium">{money(total)}</td>
                              <td className="tnum py-2 text-right text-muted">{pct(total, grand)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {carrierRows.length > 40 && (
                      <p className="mt-2 text-xs text-muted">
                        Showing the 40 largest of {carrierRows.length}.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {tab === "services" && (
              <div className="mt-8">
                <div className="mb-3 flex justify-end">
                  <ExportButtons
                    title={`${clinic.name} services ${selected}`}
                    headers={["Class", "Code", "Description", "Units", "Charges"]}
                    rows={serviceRows.map((r) => [
                      r.financial_class_code ?? "",
                      r.procedure_code ?? "",
                      r.description ?? "",
                      r.units ?? 0,
                      r.charges ?? 0,
                    ])}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={thL}>Financial class</span>
                  <Link
                    href={link({ fc: "" })}
                    className={`rounded px-2 py-1 text-xs ${
                      !searchParams.fc ? "bg-accent text-white" : "border border-hairline text-muted"
                    }`}
                  >
                    All
                  </Link>
                  {ranked.map((r) => {
                    const c = className.get(r.financial_class_id);
                    return (
                      <Link
                        key={r.financial_class_id}
                        href={link({ fc: String(r.financial_class_id) })}
                        className={`rounded px-2 py-1 text-xs ${
                          searchParams.fc === String(r.financial_class_id)
                            ? "bg-accent text-white"
                            : "border border-hairline text-muted hover:text-ink"
                        }`}
                      >
                        {c?.code}
                      </Link>
                    );
                  })}
                </div>

                {serviceRows.length === 0 ? (
                  <p className="mt-6 rounded-card border border-dashed border-hairline bg-surface p-8 text-center text-sm text-muted">
                    No procedure detail for this selection.
                  </p>
                ) : (
                  (() => {
                    const totals = new Map<number, { units: number; charges: number }>();
                    for (const r of serviceRows) {
                      const acc = totals.get(r.procedure_id) ?? { units: 0, charges: 0 };
                      acc.units += r.units ?? 0;
                      acc.charges += r.charges ?? 0;
                      totals.set(r.procedure_id, acc);
                    }
                    const list = Array.from(totals.entries()).sort(
                      (a, b) => b[1].charges - a[1].charges
                    );
                    const grand = list.reduce((a, [, v]) => a + v.charges, 0);
                    return (
                      <>
                        <p className="mt-4 text-sm text-muted">
                          {list.length} procedures, {money(grand)} in charges.
                        </p>
                        <table className="mt-3 w-full text-sm">
                          <thead>
                            <tr className="border-b border-hairline">
                              <th className={thL}>Procedure</th>
                              {["Units", "Charges", "Share"].map((h) => (
                                <th key={h} className={th}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {list.map(([id, v]) => (
                              <tr key={id} className="border-b border-hairline/60">
                                <td className="py-2">
                                  <span className="font-mono text-xs text-muted">
                                    {procById.get(id)?.code}
                                  </span>{" "}
                                  {procById.get(id)?.desc}
                                </td>
                                <td className="tnum py-2 text-right">{v.units.toLocaleString()}</td>
                                <td className="tnum py-2 text-right font-medium">{money(v.charges)}</td>
                                <td className="tnum py-2 text-right text-muted">
                                  {pct(v.charges, grand)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    );
                  })()
                )}
              </div>
            )}

            {tab === "referrals" && (
              <div className="mt-8">
                <div className="mb-3 flex justify-end">
                  <ExportButtons
                    title={`${clinic.name} referrals ${selected}`}
                    headers={["Referring provider", "Visits", "New patients", "Charges", "Payments"]}
                    rows={referralRows.map((r) => [
                      r.provider_name ?? "",
                      r.visits ?? 0,
                      r.new_patients ?? 0,
                      r.charges ?? 0,
                      r.payments ?? 0,
                    ])}
                  />
                </div>
                {referralRows.length === 0 ? (
                  <p className="rounded-card border border-dashed border-hairline bg-surface p-8 text-center text-sm text-muted">
                    No referral detail imported for {monthLabel(period!)}.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted">
                      The 40 busiest referring providers this month, by visits.
                    </p>
                    <table className="mt-3 w-full text-sm">
                      <thead>
                        <tr className="border-b border-hairline">
                          <th className={thL}>Referring provider</th>
                          <th className={thL}>City</th>
                          {["New patients", "Visits", "Visits YTD", "YTD charges"].map((h) => (
                            <th key={h} className={th}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {referralRows.map((r) => (
                          <tr key={r.referring_provider_id} className="border-b border-hairline/60">
                            <td className="py-2">{refById.get(r.referring_provider_id)?.name}</td>
                            <td className="py-2 text-muted">
                              {refById.get(r.referring_provider_id)?.city || "—"}
                            </td>
                            <td className="tnum py-2 text-right">{r.new_patients_mtd ?? "—"}</td>
                            <td className="tnum py-2 text-right font-medium">{r.visits_mtd ?? "—"}</td>
                            <td className="tnum py-2 text-right">{r.visits_ytd ?? "—"}</td>
                            <td className="tnum py-2 text-right">{money(r.ytd_charges)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )}

            {tab === "history" && (
              <div className="mt-8 space-y-8">
                {trendMonths.length < 2 ? (
                  <p className="rounded-card border border-dashed border-hairline bg-surface p-8 text-center text-sm text-muted">
                    Only one month is loaded, so there is no trend yet. Importing a pack with its
                    history fills this in.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={thL}>Range</span>
                      {spans.map((o) => (
                        <Link
                          key={o.key}
                          href={link({ span: o.key })}
                          className={`rounded px-2 py-1 text-xs ${
                            o.key === span.key
                              ? "bg-accent text-white"
                              : "border border-hairline text-muted hover:text-ink"
                          }`}
                        >
                          {o.label}
                        </Link>
                      ))}
                      <span className="text-xs text-muted">
                        {trendMonths[0]} to {trendMonths[trendMonths.length - 1]}
                      </span>
                    </div>

                    <section className="rounded-card border border-hairline bg-surface shadow-card p-4">
                      <div className="mb-2 flex flex-wrap gap-4 text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2 w-4 rounded-sm bg-accent/20" /> Charges
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-0.5 w-4 bg-accent" /> Payments
                        </span>
                      </div>
                      <TrendChart
                        months={trendMonths}
                        series={[
                          {
                            label: "Charges",
                            color: "#12586B",
                            kind: "bar",
                            values: trend.map((t) => t.charges),
                          },
                          { label: "Payments", color: "#12586B", values: trend.map((t) => t.payments) },
                        ]}
                      />
                    </section>

                    <section className="rounded-card border border-hairline bg-surface shadow-card p-4">
                      <div className="mb-2 flex flex-wrap gap-4 text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-0.5 w-4 bg-good" /> Visits
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-0.5 w-4 bg-warn" /> New patients
                        </span>
                      </div>
                      <TrendChart
                        months={trendMonths}
                        height={160}
                        format="plain"
                        series={[
                          { label: "Visits", color: "#2F6B4F", values: trend.map((t) => t.visits) },
                          {
                            label: "New patients",
                            color: "#B4761A",
                            values: trend.map((t) => t.newPatients),
                          },
                        ]}
                      />
                      <p className="mt-3 border-t border-hairline pt-3 text-xs text-muted">
                        Visits drive charges and new patients drive visits, so a dip here appears in
                        the chart above a month or two later.
                      </p>
                    </section>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
