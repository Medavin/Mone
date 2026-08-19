import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetchAll";
import type { MonthFacts } from "@/lib/insights";

/**
 * Assembles everything a clinic-month needs, in one place.
 *
 * Both the clinic page and the downloadable report read from here. When the
 * ODBC feed lands and the shapes change, there is one place to change rather
 * than two that quietly disagree.
 */
export type ClinicMonth = {
  clinic: { id: number; name: string };
  summaryRow: Record<string, number | null> | null;
  months: string[];
  month: string | null;
  facts: MonthFacts | null;
  classes: Map<number, { code: string; name: string }>;
  ar: Record<string, number>[];
  activity: Record<string, number>[];
  split: Record<string, unknown>[];
  carriers: { name: string; row: Record<string, number> }[];
  services: { code: string; desc: string; units: number; charges: number }[];
  referrals: { name: string; city: string; row: Record<string, number> }[];
  history: MonthFacts["history"];
};

export async function loadClinicMonth(
  clinicId: number,
  wantedMonth?: string
): Promise<ClinicMonth | null> {
  const supabase = createClient();

  const { data: clinic } = await supabase
    .from("clinics")
    .select("id, name")
    .eq("id", clinicId)
    .maybeSingle();
  if (!clinic) return null;

  const { data: monthRows } = await supabase
    .from("clinic_monthly")
    .select("period_month")
    .eq("clinic_id", clinicId)
    .order("period_month", { ascending: false });

  const months = (monthRows ?? []).map((m) => (m.period_month as string).slice(0, 7));
  const month = wantedMonth && months.includes(wantedMonth) ? wantedMonth : months[0] ?? null;
  const period = month ? `${month}-01` : null;

  const { data: classRows } = await supabase
    .from("financial_classes")
    .select("id, code, name")
    .order("sort_order");
  const classes = new Map(
    (classRows ?? []).map((c) => [c.id as number, { code: c.code as string, name: c.name as string }])
  );

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

  const byMonth = new Map<string, MonthFacts["history"][number]>();
  for (const r of historyRows ?? []) {
    const m = (r.period_month as string).slice(0, 7);
    const acc =
      byMonth.get(m) ?? { month: m, charges: 0, payments: 0, adjustments: 0, visits: 0, newPatients: 0 };
    acc.charges += (r.charges as number) ?? 0;
    acc.payments += (r.payments as number) ?? 0;
    acc.adjustments += (r.adjustments as number) ?? 0;
    acc.visits += (r.visits as number) ?? 0;
    acc.newPatients += (r.new_patients as number) ?? 0;
    byMonth.set(m, acc);
  }
  const history = Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));

  if (!period) {
    return {
      clinic: clinic as { id: number; name: string },
      summaryRow: null,
      months,
      month: null,
      facts: null,
      classes,
      ar: [],
      activity: [],
      split: [],
      carriers: [],
      services: [],
      referrals: [],
      history,
    };
  }

  const [summaryRes, arRes, actRes, splitRes, carrierRes, serviceRes, referralRes] =
    await Promise.all([
      supabase.from("clinic_monthly").select("*").eq("clinic_id", clinicId).eq("period_month", period).maybeSingle(),
      supabase.from("ar_monthly").select("*").eq("clinic_id", clinicId).eq("period_month", period),
      supabase.from("activity_monthly").select("*").eq("clinic_id", clinicId).eq("period_month", period),
      supabase.from("ar_split_monthly").select("*").eq("clinic_id", clinicId).eq("period_month", period),
      supabase
        .from("carrier_ar_monthly")
        .select("carrier_id, bucket_current, bucket_30, bucket_60, bucket_90, bucket_120_plus, total_ar")
        .eq("clinic_id", clinicId)
        .eq("period_month", period)
        .order("total_ar", { ascending: false }),
      supabase
        .from("service_monthly")
        .select("procedure_id, financial_class_id, units, charges")
        .eq("clinic_id", clinicId)
        .eq("period_month", period),
      supabase
        .from("referrals_monthly")
        .select("referring_provider_id, new_patients_mtd, visits_mtd, visits_ytd, ytd_charges")
        .eq("clinic_id", clinicId)
        .eq("period_month", period)
        .order("visits_mtd", { ascending: false })
        .limit(40),
    ]);

  const summary = (summaryRes.data ?? null) as Record<string, number | null> | null;
  const ar = (arRes.data ?? []) as Record<string, number>[];
  const activity = (actRes.data ?? []) as Record<string, number>[];
  const split = (splitRes.data ?? []) as Record<string, unknown>[];

  const { data: carrierNames } = await supabase.from("carriers").select("id, name");
  const carrierNameById = new Map((carrierNames ?? []).map((c) => [c.id as number, c.name as string]));
  const carriers = ((carrierRes.data ?? []) as Record<string, number>[]).map((row) => ({
    name: carrierNameById.get(row.carrier_id) ?? "—",
    row,
  }));

  const { data: procs } = await supabase.from("procedures").select("id, code, description");
  const procById = new Map(
    (procs ?? []).map((p) => [p.id as number, { code: p.code as string, desc: (p.description as string) ?? "" }])
  );
  const svcTotals = new Map<number, { units: number; charges: number }>();
  for (const r of (serviceRes.data ?? []) as Record<string, number>[]) {
    const acc = svcTotals.get(r.procedure_id) ?? { units: 0, charges: 0 };
    acc.units += r.units ?? 0;
    acc.charges += r.charges ?? 0;
    svcTotals.set(r.procedure_id, acc);
  }
  const services = Array.from(svcTotals.entries())
    .map(([id, v]) => ({
      code: procById.get(id)?.code ?? "—",
      desc: procById.get(id)?.desc ?? "",
      units: v.units,
      charges: v.charges,
    }))
    .sort((a, b) => b.charges - a.charges);

  const { data: refs } = await supabase.from("referring_providers").select("id, name, city");
  const refById = new Map(
    (refs ?? []).map((r) => [r.id as number, { name: r.name as string, city: (r.city as string) ?? "" }])
  );
  const referrals = ((referralRes.data ?? []) as Record<string, number>[]).map((row) => ({
    name: refById.get(row.referring_provider_id)?.name ?? "—",
    city: refById.get(row.referring_provider_id)?.city ?? "",
    row,
  }));

  // A carrier that has effectively stopped paying: a balance worth chasing,
  // almost all of it past 120 days.
  const staleCarriers = carriers
    .filter((c) => (c.row.total_ar ?? 0) > 5000 && (c.row.bucket_120_plus ?? 0) / (c.row.total_ar ?? 1) > 0.9)
    .map((c) => ({ name: c.name, total: c.row.total_ar ?? 0, over120: c.row.bucket_120_plus ?? 0 }))
    .sort((a, b) => b.total - a.total);

  const facts: MonthFacts = {
    month,
    openingAr: summary?.opening_ar ?? null,
    closingAr: summary?.closing_ar ?? null,
    arChange: summary?.ar_change ?? null,
    charges: summary?.charges ?? null,
    adjustments: summary?.adjustments ?? null,
    paymentsPatient: summary?.payments_patient ?? null,
    paymentsInsurance: summary?.payments_insurance ?? null,
    patientsWithBalance: summary?.patients_with_balance ?? null,
    classes: ar.map((r) => ({
      code: classes.get(r.financial_class_id)?.code ?? "",
      name: classes.get(r.financial_class_id)?.name ?? "",
      total: r.closing_ar ?? 0,
      over120: r.bucket_120_plus ?? 0,
    })),
    split: split.map((s) => ({
      payerType: s.payer_type as string,
      total: (s.total_ar as number) ?? 0,
      unapplied: (s.unapplied as number) ?? 0,
    })),
    staleCarriers,
    history,
  };

  return {
    clinic: clinic as { id: number; name: string },
    summaryRow: summary,
    months,
    month,
    facts,
    classes,
    ar,
    activity,
    split,
    carriers,
    services,
    referrals,
    history,
  };
}
