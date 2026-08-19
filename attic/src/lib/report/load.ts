import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppDatabase } from "@/lib/supabase/pending.types";
import type { ParsedReport } from "@/lib/report/parse.mjs";

type Client = SupabaseClient<AppDatabase>;

export type LoadOutcome = {
  ok: boolean;
  batchId: number | null;
  message: string;
  written: { table: string; rows: number }[];
  skipped: string[];
};

/**
 * Clinic names on the reports are longer than the ones in the database —
 * "Rapid Rehab & Wellness Center" against "Rapid Rehab". Normalise both sides
 * before comparing so the obvious matches land, and score the rest rather than
 * picking arbitrarily. The caller confirms the choice; this only suggests.
 */
export function normaliseName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|pc|corp|center|centre|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function suggestClinic(
  reportName: string,
  clinics: { id: number; name: string }[],
) {
  const target = normaliseName(reportName);
  const targetTokens = new Set(target.split(" ").filter(Boolean));

  let best: { id: number; name: string; score: number } | null = null;
  for (const clinic of clinics) {
    const candidate = normaliseName(clinic.name);
    let score = 0;
    if (candidate === target) score = 1;
    else if (target.startsWith(candidate) || candidate.startsWith(target)) score = 0.9;
    else if (target.includes(candidate) || candidate.includes(target)) score = 0.8;
    else {
      const tokens = candidate.split(" ").filter(Boolean);
      const hits = tokens.filter((t) => targetTokens.has(t)).length;
      score = tokens.length ? (hits / tokens.length) * 0.7 : 0;
    }
    if (!best || score > best.score) best = { ...clinic, score };
  }
  return best && best.score >= 0.5 ? best : null;
}

/** Look up reference rows by code, creating any the report introduces. */
async function resolveFinancialClasses(
  supabase: Client,
  codes: { code: string; name: string | null }[],
) {
  const wanted = Array.from(new Map(codes.map((c) => [c.code, c])).values());
  if (wanted.length === 0) return new Map<string, number>();

  const { data: existing } = await supabase
    .from("financial_classes")
    .select("id, code");
  const byCode = new Map((existing ?? []).map((r) => [r.code, r.id]));

  const missing = wanted.filter((c) => !byCode.has(c.code));
  if (missing.length > 0) {
    const { data: inserted, error } = await supabase
      .from("financial_classes")
      .insert(
        missing.map((c, i) => ({
          code: c.code,
          name: c.name ?? c.code,
          sort_order: (byCode.size + i + 1) * 10,
        })),
      )
      .select("id, code");
    if (error) throw new Error(`financial_classes: ${error.message}`);
    for (const row of inserted ?? []) byCode.set(row.code, row.id);
  }
  return byCode;
}

/**
 * Writes a parsed report into the monthly tables under an import_batches row,
 * so every figure can be traced back to the file that produced it.
 *
 * Refuses to overwrite silently: if the clinic already has rows for the
 * period, the caller must pass `replace`.
 */
export async function loadReport(
  supabase: Client,
  report: ParsedReport,
  options: {
    clinicId: number;
    periodMonth: string;
    userId: string;
    replace: boolean;
  },
): Promise<LoadOutcome> {
  const { clinicId, periodMonth, userId, replace } = options;
  const written: { table: string; rows: number }[] = [];
  const skipped: string[] = [];

  const { count: existing } = await supabase
    .from("ar_monthly")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("period_month", periodMonth);

  if ((existing ?? 0) > 0 && !replace) {
    return {
      ok: false,
      batchId: null,
      message: `This clinic already has ${existing} AR rows for ${periodMonth}. Tick "replace" to overwrite them.`,
      written,
      skipped,
    };
  }

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      clinic_id: clinicId,
      period_month: periodMonth,
      report_kind: "monthly_workbook",
      source_type: "xlsx",
      source_name: report.source_file,
      status: "running",
      started_at: new Date().toISOString(),
      run_by: userId,
      rows_read: 0,
      rows_accepted: 0,
      rows_rejected: 0,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return {
      ok: false,
      batchId: null,
      message: `Could not open an import batch: ${batchError?.message ?? "unknown"}`,
      written,
      skipped,
    };
  }

  const fail = async (message: string) => {
    await supabase
      .from("import_batches")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_detail: message.slice(0, 2000),
      })
      .eq("id", batch.id);
    return { ok: false, batchId: batch.id, message, written, skipped };
  };

  try {
    const arRows = report.ar_monthly.rows;
    const activityRows = report.activity_monthly.rows;
    const rowsRead = arRows.length + activityRows.length;

    const classes = await resolveFinancialClasses(supabase, [
      ...arRows.map((r) => ({
        code: r.financial_class_code,
        name: r.financial_class_name,
      })),
      ...activityRows.map((r) => ({
        code: r.financial_class_code,
        name: r.financial_class_name,
      })),
    ]);

    if (replace) {
      await supabase
        .from("ar_monthly")
        .delete()
        .eq("clinic_id", clinicId)
        .eq("period_month", periodMonth);
      await supabase
        .from("activity_monthly")
        .delete()
        .eq("clinic_id", clinicId)
        .eq("period_month", periodMonth);
    }

    // Visits and new patients live on a different sheet, keyed by class and
    // month; pick out this report's month and merge them in.
    const visitsByClass = new Map<string, { visits: number; new_patients: number }>();
    for (const row of report.visits_new_patients.rows) {
      if (row.period_month !== periodMonth) continue;
      const entry = visitsByClass.get(row.financial_class_code) ?? {
        visits: 0,
        new_patients: 0,
      };
      entry[row.metric] += row.value;
      visitsByClass.set(row.financial_class_code, entry);
    }

    const arPayload = arRows
      .filter((r) => classes.has(r.financial_class_code))
      .map((r) => ({
        clinic_id: clinicId,
        period_month: periodMonth,
        financial_class_id: classes.get(r.financial_class_code)!,
        bucket_current: r.bucket_current,
        bucket_30: r.bucket_30,
        bucket_60: r.bucket_60,
        bucket_90: r.bucket_90,
        bucket_120_plus: r.bucket_120_plus,
        closing_ar: r.closing_ar,
        source_batch_id: batch.id,
      }));

    if (arPayload.length > 0) {
      const { error } = await supabase.from("ar_monthly").insert(arPayload);
      if (error) return await fail(`ar_monthly: ${error.message}`);
      written.push({ table: "ar_monthly", rows: arPayload.length });
    }

    const activityPayload = activityRows
      .filter((r) => classes.has(r.financial_class_code))
      .map((r) => {
        const extra = visitsByClass.get(r.financial_class_code);
        return {
          clinic_id: clinicId,
          period_month: periodMonth,
          financial_class_id: classes.get(r.financial_class_code)!,
          units: r.units,
          charges: r.charges,
          payments: r.payments,
          adjustments: r.adjustments,
          visits: extra?.visits ?? null,
          new_patients: extra?.new_patients ?? null,
          source_batch_id: batch.id,
        };
      });

    if (activityPayload.length > 0) {
      const { error } = await supabase
        .from("activity_monthly")
        .insert(activityPayload);
      if (error) return await fail(`activity_monthly: ${error.message}`);
      written.push({ table: "activity_monthly", rows: activityPayload.length });
    }

    if (visitsByClass.size === 0) {
      skipped.push(
        `No visit or new-patient figures for ${periodMonth} on the Visits sheet.`,
      );
    }

    const accepted = written.reduce((sum, w) => sum + w.rows, 0);
    await supabase
      .from("import_batches")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        rows_read: rowsRead,
        rows_accepted: accepted,
        rows_rejected: rowsRead - accepted,
      })
      .eq("id", batch.id);

    return {
      ok: true,
      batchId: batch.id,
      message: `Loaded ${accepted} rows for ${periodMonth}.`,
      written,
      skipped,
    };
  } catch (error) {
    return await fail(error instanceof Error ? error.message : "Unknown error");
  }
}
