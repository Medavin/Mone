"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  parseWorkbook,
  parseHistory,
  parseCarrierAr,
  parseServiceDetails,
  parseReferrals,
  type ParsedWorkbook,
  type ParsedHistory,
  type ParsedCarrierAr,
  type ServiceLine,
  type ReferralRow,
  type ParseIssue,
} from "@/lib/parseAmd";
import type { Clinic } from "@/lib/types";

type FinClass = { id: number; code: string; name: string };

/**
 * Matches the clinic name printed in the workbook to one in the database.
 *
 * They are never written identically — the report says "RAPID REHAB AND
 * WELLNESS CENTER INC" where the database says "Rapid Rehab". Scoring on how
 * much of the stored name appears in the printed one handles that without
 * needing a lookup table per clinic.
 *
 * Returns null rather than guessing when nothing scores well. A wrong guess
 * here files a clinic's entire year under someone else, silently.
 */
function matchClinic(detected: string | null, clinics: Clinic[]): Clinic | null {
  if (!detected) return null;
  const haystack = detected.toUpperCase().replace(/[^A-Z0-9 ]/g, " ");

  let best: { clinic: Clinic; score: number } | null = null;
  for (const c of clinics) {
    const words = c.name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const hits = words.filter((w) => haystack.includes(w)).length;
    const score = hits / words.length;
    if (!best || score > best.score) best = { clinic: c, score };
  }

  // Every word of the stored name has to appear. "Peak PT" and "Peninsula PT"
  // share a word, and a partial match between those two is worse than asking.
  return best && best.score === 1 ? best.clinic : null;
}

const money = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });


/**
 * Collapses rows that share a conflict key, summing the numeric columns.
 *
 * Postgres rejects an upsert whose payload touches the same row twice —
 * "ON CONFLICT DO UPDATE command cannot affect row a second time". The parsers
 * already merge where they can, but this is the last line of defence: nothing
 * reaches the database with a duplicate key, whatever a future sheet does.
 */
function mergeRows<T extends Record<string, unknown>>(
  rows: T[],
  keyOf: (r: T) => string,
  sumFields: string[]
): T[] {
  const out = new Map<string, T>();
  for (const row of rows) {
    const k = keyOf(row);
    const acc = out.get(k);
    if (!acc) {
      out.set(k, { ...row });
      continue;
    }
    for (const f of sumFields) {
      const a = acc[f] as number | null;
      const b = row[f] as number | null;
      (acc as Record<string, unknown>)[f] =
        a === null && b === null ? null : (a ?? 0) + (b ?? 0);
    }
  }
  return Array.from(out.values());
}

export default function ImportClient({
  clinics,
  financialClasses,
}: {
  clinics: Clinic[];
  financialClasses: FinClass[];
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [history, setHistory] = useState<ParsedHistory | null>(null);
  const [carriers, setCarriers] = useState<ParsedCarrierAr | null>(null);
  const [services, setServices] = useState<{ rows: ServiceLine[]; issues: ParseIssue[] } | null>(null);
  const [referrals, setReferrals] = useState<{ rows: ReferralRow[]; issues: ParseIssue[] } | null>(null);
  const [includeHistory, setIncludeHistory] = useState(true);
  const [clinicId, setClinicId] = useState<string>("");
  const [month, setMonth] = useState<string>("");
  // What the FILE said, kept separate from what is currently selected.
  // Conflating the two is how the status line ended up reporting the user's
  // own override back to them as a detection.
  const [detectedClinicId, setDetectedClinicId] = useState<string>("");
  const [detectedMonth, setDetectedMonth] = useState<string>("");
  const [periodSource, setPeriodSource] = useState<string | null>(null);
  // What is already stored at the chosen destination. Looked up whenever the
  // clinic or month changes, so the page answers "is there anything here?"
  // before a file is involved at all.
  const [existing, setExisting] = useState<Record<string, number | null> | null | "loading">(null);
  // A mismatch between the file and the destination now BLOCKS the import
  // until it is explicitly acknowledged. A warning was not enough — figures
  // were filed under the wrong month twice, and nothing about the result
  // looks wrong afterwards.
  const [overrideOk, setOverrideOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const classByCode = new Map(financialClasses.map((f) => [f.code, f.id]));

  const allIssues = [
    ...(parsed?.issues ?? []),
    ...(carriers?.issues ?? []),
    ...(history?.issues ?? []),
    ...(services?.issues ?? []),
    ...(referrals?.issues ?? []),
  ];
  const errors = allIssues.filter((i) => i.level === "error");
  const warnings = allIssues.filter((i) => i.level === "warning");

  const unknownCodes = parsed
    ? Array.from(
        new Set(
          [...parsed.financialClassAr, ...parsed.financialClassActivity, ...(history?.rows ?? [])]
            .map((r) => r.code)
            .filter((c) => !classByCode.has(c))
        )
      )
    : [];

  const mismatch =
    !!parsed &&
    ((!!detectedClinicId && clinicId !== detectedClinicId) ||
      (!!detectedMonth && month !== detectedMonth));

  const canCommit =
    !!parsed &&
    !!clinicId &&
    !!month &&
    errors.length === 0 &&
    unknownCodes.length === 0 &&
    (!mismatch || overrideOk) &&
    !busy;

  // Everything on this page is relative to the clinic and month selected.
  // Changing either CLEARS the loaded file — otherwise the previous
  // selection's figures sit on screen under a heading they do not belong to,
  // which is exactly how a month gets filed against the wrong clinic.
  useEffect(() => {
    setParsed(null);
    setHistory(null);
    setCarriers(null);
    setServices(null);
    setReferrals(null);
    setFileName(null);
    setResult(null);
    setDetectedClinicId("");
    setDetectedMonth("");
    setPeriodSource(null);

    setOverrideOk(false);

    if (!clinicId || !month) {
      setExisting(null);
      return;
    }

    let cancelled = false;
    setExisting("loading");

    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("clinic_monthly")
        .select("opening_ar, closing_ar, ar_change, charges, adjustments, payments_patient, payments_insurance")
        .eq("clinic_id", Number(clinicId))
        .eq("period_month", `${month}-01`)
        .maybeSingle();

      if (cancelled) return;
      setExisting((data as Record<string, number | null>) ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [clinicId, month]);

  async function onFile(file: File) {
    setResult(null);
    setParsed(null);
    setHistory(null);
    setCarriers(null);
    setServices(null);
    setReferrals(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = parseWorkbook(buf);
      setParsed(wb);
      // The insurance A/R total is passed in as a checksum — carrier A/R is
      // the insurance side only, so the two must agree.
      setCarriers(
        parseCarrierAr(buf, wb.arSplit.find((r) => r.payerType === "insurance")?.total)
      );
      setServices(parseServiceDetails(buf));
      setReferrals(parseReferrals(buf));

      // Preselect both, so the common case needs no thought and the rare
      // mismatch is the thing that stands out.
      // Record what the file says, but do NOT overwrite the clinic the user
      // has already chosen — they picked the destination first, on purpose.
      const guess = matchClinic(wb.detectedClinicName, clinics);
      setDetectedClinicId(guess ? String(guess.id) : "");

      // The historical sheets end at the month the pack covers.
      const hist = parseHistory(buf);
      setHistory(hist);
      // The period the report STATES beats the period inferred from the last
      // history column. Only fall back when the workbook does not say.
      const last = hist.months[hist.months.length - 1];
      setDetectedMonth(wb.detectedPeriod ?? (last ? last.slice(0, 7) : ""));
      setPeriodSource(wb.detectedPeriodSource);
    } catch (e) {
      setResult({
        ok: false,
        message: `That file could not be read as a spreadsheet: ${(e as Error).message}`,
      });
    }
  }

  async function commit() {
    if (!parsed || !clinicId || !month) return;
    setBusy(true);
    setResult(null);

    const supabase = createClient();
    const cid = Number(clinicId);
    const period = `${month}-01`;

    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({
        source_type: "file",
        source_name: fileName,
        report_kind: "amd_monthly_pack",
        clinic_id: cid,
        period_month: period,
        status: "running",
      })
      .select("id")
      .single();

    if (batchError || !batch) {
      setResult({ ok: false, message: `Could not start the import: ${batchError?.message}` });
      setBusy(false);
      return;
    }

    const batchId = batch.id as number;
    const s = parsed.summary;

    type StepResult = { error: { message: string } | null };
    const steps: { label: string; run: () => PromiseLike<StepResult> }[] = [
      {
        label: "clinic summary",
        run: () =>
          supabase.from("clinic_monthly").upsert(
            {
              clinic_id: cid,
              period_month: period,
              opening_ar: s.openingAr,
              closing_ar: s.closingAr,
              ar_change: s.arChange,
              charges: s.charges,
              adjustments: s.adjustments,
              payments_patient: s.paymentsPatient,
              payments_insurance: s.paymentsInsurance,
              patients_with_balance: s.patientsWithBalance,
              average_patient_balance: s.averagePatientBalance,
              source_batch_id: batchId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "clinic_id,period_month" }
          ),
      },
      {
        label: "insurance / patient split",
        run: () =>
          supabase.from("ar_split_monthly").upsert(
            parsed.arSplit.map((r) => ({
              clinic_id: cid,
              period_month: period,
              payer_type: r.payerType,
              bucket_current: r.current,
              bucket_30: r.d30,
              bucket_60: r.d60,
              bucket_90: r.d90,
              bucket_120_plus: r.d120,
              total_ar: r.total,
              unapplied: r.unapplied,
              net_ar: r.net,
              source_batch_id: batchId,
            })),
            { onConflict: "clinic_id,period_month,payer_type" }
          ),
      },
      {
        label: "A/R by financial class",
        run: () =>
          supabase.from("ar_monthly").upsert(
            mergeRows(
              parsed.financialClassAr.map((r) => ({
              clinic_id: cid,
              period_month: period,
              financial_class_id: classByCode.get(r.code)!,
              closing_ar: r.total,
              bucket_current: r.current,
              bucket_30: r.d30,
              bucket_60: r.d60,
              bucket_90: r.d90,
              bucket_120_plus: r.d120,
              source_batch_id: batchId,
              updated_at: new Date().toISOString(),
              })),
              (r) => String(r.financial_class_id),
              ["closing_ar", "bucket_current", "bucket_30", "bucket_60", "bucket_90", "bucket_120_plus"]
            ),
            { onConflict: "clinic_id,period_month,financial_class_id" }
          ),
      },
      {
        label: "procedures",
        run: async () => {
          const list = services?.rows ?? [];
          if (list.length === 0) return { error: null };

          const { data: savedProcs, error: procError } = await supabase
            .from("procedures")
            .upsert(
              Array.from(
                new Map(list.map((r) => [r.procCode, { code: r.procCode, description: r.description }])).values()
              ),
              { onConflict: "code" }
            )
            .select("id, code");
          if (procError) return { error: procError };

          const procId = new Map((savedProcs ?? []).map((p) => [p.code as string, p.id as number]));

          const payload = list
            .filter((r) => procId.has(r.procCode) && classByCode.has(r.classCode))
            .map((r) => ({
              clinic_id: cid,
              period_month: period,
              financial_class_id: classByCode.get(r.classCode)!,
              procedure_id: procId.get(r.procCode)!,
              units: r.units,
              charges: r.charges,
              source_batch_id: batchId,
            }));

          const safe = mergeRows(
            payload,
            (r) => `${r.financial_class_id}|${r.procedure_id}`,
            ["units", "charges"]
          );

          for (let i = 0; i < safe.length; i += 400) {
            const { error } = await supabase.from("service_monthly").upsert(safe.slice(i, i + 400), {
              onConflict: "clinic_id,period_month,financial_class_id,procedure_id",
            });
            if (error) return { error };
          }
          return { error: null };
        },
      },
      {
        label: "referral sources",
        run: async () => {
          const list = referrals?.rows ?? [];
          if (list.length === 0) return { error: null };

          const unique = Array.from(
            new Map(
              list.map((r) => [
                `${r.name}|${r.zip}`,
                {
                  name: r.name,
                  street: r.street,
                  city: r.city,
                  state: r.state,
                  zip: r.zip,
                  phone: r.phone,
                },
              ])
            ).values()
          );

          const { data: savedRefs, error: refError } = await supabase
            .from("referring_providers")
            .upsert(unique, { onConflict: "name,zip" })
            .select("id, name, zip");
          if (refError) return { error: refError };

          const refId = new Map(
            (savedRefs ?? []).map((p) => [`${p.name as string}|${p.zip as string}`, p.id as number])
          );

          const payload = list
            .filter((r) => refId.has(`${r.name}|${r.zip}`))
            .map((r) => ({
              clinic_id: cid,
              period_month: period,
              referring_provider_id: refId.get(`${r.name}|${r.zip}`)!,
              new_patients_mtd: r.newPatientsMtd,
              new_patients_ytd: r.newPatientsYtd,
              visits_mtd: r.visitsMtd,
              visits_ytd: r.visitsYtd,
              ytd_charges: r.ytdCharges,
              source_batch_id: batchId,
            }));

          const safe = mergeRows(
            payload,
            (r) => String(r.referring_provider_id),
            ["new_patients_mtd", "new_patients_ytd", "visits_mtd", "visits_ytd", "ytd_charges"]
          );

          for (let i = 0; i < safe.length; i += 400) {
            const { error } = await supabase.from("referrals_monthly").upsert(safe.slice(i, i + 400), {
              onConflict: "clinic_id,period_month,referring_provider_id",
            });
            if (error) return { error };
          }
          return { error: null };
        },
      },
      {
        // History is written FIRST, deliberately. It covers every month
        // including this one, but carries no Units column. The current
        // month's activity row is written after, so its Units survive
        // rather than being overwritten with nothing.
        label: "monthly history",
        run: async () => {
          if (!includeHistory || !history || history.rows.length === 0) return { error: null };
          const payload = history.rows
            .filter((r) => classByCode.has(r.code))
            .map((r) => ({
              clinic_id: cid,
              period_month: r.month,
              financial_class_id: classByCode.get(r.code)!,
              charges: r.charges,
              payments: r.payments,
              adjustments: r.adjustments,
              visits: r.visits,
              new_patients: r.newPatients,
              source_batch_id: batchId,
              updated_at: new Date().toISOString(),
            }));

          // Sent in chunks — a decade of history is well over a thousand rows
          // and a single request that large is fragile.
          const safe = mergeRows(
            payload,
            (r) => `${r.period_month}|${r.financial_class_id}`,
            ["charges", "payments", "adjustments", "visits", "new_patients"]
          );

          for (let i = 0; i < safe.length; i += 400) {
            const { error } = await supabase
              .from("activity_monthly")
              .upsert(safe.slice(i, i + 400), {
                onConflict: "clinic_id,period_month,financial_class_id",
              });
            if (error) return { error };
          }
          return { error: null };
        },
      },
      {
        label: "carrier A/R",
        run: async () => {
          const list = carriers?.rows ?? [];
          if (list.length === 0) return { error: null };

          // Carriers are reference data shared across clinics and months, so
          // they are upserted first and their ids read back.
          const { data: saved, error: carrierError } = await supabase
            .from("carriers")
            .upsert(
              list.map((c) => ({ code: c.code, name: c.name })),
              { onConflict: "code" }
            )
            .select("id, code");
          if (carrierError) return { error: carrierError };

          const idByCode = new Map((saved ?? []).map((c) => [c.code as string, c.id as number]));

          const payload = list
            .filter((c) => idByCode.has(c.code))
            .map((c) => ({
              clinic_id: cid,
              period_month: period,
              carrier_id: idByCode.get(c.code)!,
              bucket_current: c.current,
              bucket_30: c.d30,
              bucket_60: c.d60,
              bucket_90: c.d90,
              bucket_120_plus: c.d120,
              total_ar: c.total,
              source_batch_id: batchId,
            }));

          const safe = mergeRows(
            payload,
            (r) => String(r.carrier_id),
            ["bucket_current", "bucket_30", "bucket_60", "bucket_90", "bucket_120_plus", "total_ar"]
          );

          for (let i = 0; i < safe.length; i += 400) {
            const { error } = await supabase
              .from("carrier_ar_monthly")
              .upsert(safe.slice(i, i + 400), {
                onConflict: "clinic_id,period_month,carrier_id",
              });
            if (error) return { error };
          }
          return { error: null };
        },
      },
      {
        label: "activity by financial class",
        run: () =>
          supabase.from("activity_monthly").upsert(
            mergeRows(
              parsed.financialClassActivity.map((r) => ({
                clinic_id: cid,
                period_month: period,
                financial_class_id: classByCode.get(r.code)!,
                units: r.units,
                charges: r.charges,
                payments: r.payments,
                adjustments: r.adjustments,
                source_batch_id: batchId,
                updated_at: new Date().toISOString(),
              })),
              (r) => String(r.financial_class_id),
              ["units", "charges", "payments", "adjustments"]
            ),
            { onConflict: "clinic_id,period_month,financial_class_id" }
          ),
      },
    ];

    for (const step of steps) {
      const { error } = await step.run();
      if (error) {
        await supabase
          .from("import_batches")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            error_detail: `${step.label}: ${error.message}`,
          })
          .eq("id", batchId);
        setResult({ ok: false, message: `Failed on ${step.label}: ${error.message}` });
        setBusy(false);
        return;
      }
    }

    const historyRows = includeHistory && history ? history.rows.length : 0;
    const carrierRows = carriers?.rows.length ?? 0;
    const serviceRows = services?.rows.length ?? 0;
    const referralRows = referrals?.rows.length ?? 0;
    const accepted =
      1 +
      parsed.arSplit.length +
      parsed.financialClassAr.length +
      parsed.financialClassActivity.length +
      carrierRows +
      serviceRows +
      referralRows +
      historyRows;

    await supabase
      .from("import_batches")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        rows_read: accepted,
        rows_accepted: accepted,
      })
      .eq("id", batchId);

    setResult({
      ok: true,
      message:
        `Imported ${accepted} rows` +
        (historyRows ? `, including ${historyRows} of monthly history` : ` for ${month}`) +
        `. Re-importing replaces these figures rather than duplicating them.`,
    });
    setBusy(false);
  }

  const destinationChosen = !!clinicId && !!month;
  const clinicName = clinics.find((c) => String(c.id) === clinicId)?.name;

  const monthLabel = month
    ? new Date(`${month}-01T12:00:00`).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <div className="space-y-8">
      {/* 1 — the destination, chosen first */}
      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">
          1 · Clinic and month
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <select
            value={clinicId}
            onChange={(e) => setClinicId(e.target.value)}
            className="rounded-card border border-hairline bg-surface shadow-card px-3 py-2 text-sm
                       outline-none focus:border-accent"
          >
            <option value="">Select clinic…</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-card border border-hairline bg-surface shadow-card px-3 py-2 text-sm
                       outline-none focus:border-accent"
          />
        </div>
      </section>

      {/* 2 — what is already there */}
      {!destinationChosen && (
        <p className="rounded-card border border-dashed border-hairline bg-surface px-4 py-6 text-center text-sm text-muted">
          Choose a clinic and month to see what has been imported for it.
        </p>
      )}

      {destinationChosen && existing === "loading" && (
        <p className="text-sm text-muted">Checking…</p>
      )}

      {destinationChosen && existing === null && (
        <div className="rounded-card border border-dashed border-hairline bg-surface p-8 text-center">
          <h3 className="text-base font-medium">
            Nothing imported for {clinicName}, {monthLabel}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Choose that clinic&apos;s AdvancedMD pack for this month below.
          </p>
        </div>
      )}

      {destinationChosen && existing && existing !== "loading" && (
        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">
            2 · Already imported
          </h2>
          <p className="mt-1 text-sm text-muted">
            {clinicName}, {monthLabel}. Importing a file below replaces these figures.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ["Opening A/R", existing.opening_ar],
              ["Closing A/R", existing.closing_ar],
              ["Change", existing.ar_change],
              ["Charges", existing.charges],
              ["Adjustments", existing.adjustments],
              [
                "Payments",
                (existing.payments_patient ?? 0) + (existing.payments_insurance ?? 0),
              ],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-card border border-hairline bg-surface shadow-card p-3">
                <div className="font-mono text-[11px] uppercase tracking-wider text-muted">
                  {label as string}
                </div>
                <div className="tnum mt-1 text-lg font-medium">{money(value as number | null)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3 — the file */}
      {destinationChosen && (
        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">
            3 · Workbook
          </h2>
          <label className="mt-2 flex cursor-pointer items-center gap-3 rounded-card border border-dashed border-hairline bg-surface px-4 py-5 transition hover:border-accent">
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            <span className="rounded bg-accent px-3 py-1.5 text-sm text-white">Choose file</span>
            <span className="text-sm text-muted">
              {fileName ?? `The AdvancedMD pack for ${clinicName}, ${monthLabel}`}
            </span>
          </label>
        </section>
      )}

      {destinationChosen && parsed && (
        <>
          {/* Does the file agree with where you are putting it? */}
          {mismatch && (
            <div className="rounded border border-bad/30 bg-bad/5 p-4">
              <p className="text-sm font-medium text-bad">
                This file does not match where you are filing it.
              </p>
              <table className="mt-2 text-sm text-bad">
                <tbody>
                  <tr>
                    <td className="pr-4 align-top">The file says</td>
                    <td className="font-medium">
                      {parsed.detectedClinicName}
                      {detectedMonth ? `, ${detectedMonth}` : ""}
                      {periodSource && (
                        <span className="block font-normal opacity-80">{periodSource}</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="pr-4">You have chosen</td>
                    <td className="font-medium">
                      {clinicName}, {monthLabel}
                    </td>
                  </tr>
                </tbody>
              </table>
              <label className="mt-3 flex items-center gap-2 text-sm text-bad">
                <input
                  type="checkbox"
                  checked={overrideOk}
                  onChange={(e) => setOverrideOk(e.target.checked)}
                />
                File it where I chose anyway
              </label>
            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded border border-bad/30 bg-bad/5 p-4">
              <p className="text-sm font-medium text-bad">
                This file cannot be imported until these are resolved.
              </p>
              <ul className="mt-2 space-y-1 text-sm text-bad">
                {errors.map((e, i) => (
                  <li key={i}>· {e.message}</li>
                ))}
              </ul>
            </div>
          )}

          {unknownCodes.length > 0 && (
            <div className="rounded border border-bad/30 bg-bad/5 p-4 text-sm text-bad">
              Unknown financial class {unknownCodes.length > 1 ? "codes" : "code"}:{" "}
              <span className="font-mono">{unknownCodes.join(", ")}</span>. Add them to the
              financial_classes table before importing.
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded border border-warn/30 bg-warn/5 p-4">
              <p className="text-sm font-medium text-warn">Worth reading before you commit</p>
              <ul className="mt-2 space-y-1 text-sm text-warn">
                {warnings.map((w, i) => (
                  <li key={i}>· {w.message}</li>
                ))}
              </ul>
            </div>
          )}

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">
              4 · What this file contains
            </h2>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {[
                ["Opening A/R", parsed.summary.openingAr],
                ["Closing A/R", parsed.summary.closingAr],
                ["Change", parsed.summary.arChange],
                ["Charges", parsed.summary.charges],
                ["Adjustments", parsed.summary.adjustments],
                [
                  "Payments",
                  (parsed.summary.paymentsPatient ?? 0) + (parsed.summary.paymentsInsurance ?? 0),
                ],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-card border border-hairline bg-surface shadow-card p-3">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-muted">
                    {label as string}
                  </div>
                  <div className="tnum mt-1 text-lg font-medium">
                    {money(value as number | null)}
                  </div>
                </div>
              ))}
            </div>

            <table className="mt-5 w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="py-2 font-mono text-[11px] uppercase tracking-wider text-muted">
                    Financial class
                  </th>
                  {["Charges", "Payments", "A/R", "120+"].map((h) => (
                    <th
                      key={h}
                      className="py-2 text-right font-mono text-[11px] uppercase tracking-wider text-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.financialClassAr.map((ar) => {
                  const act = parsed.financialClassActivity.find((a) => a.code === ar.code);
                  const heavy = ar.total > 0 && ar.d120 / ar.total > 0.8;
                  return (
                    <tr key={ar.code} className="border-b border-hairline/60">
                      <td className="py-2">
                        <span className="font-mono text-xs text-muted">{ar.code}</span> {ar.name}
                      </td>
                      <td className="tnum py-2 text-right">{money(act?.charges ?? null)}</td>
                      <td className="tnum py-2 text-right">{money(act?.payments ?? null)}</td>
                      <td className="tnum py-2 text-right">{money(ar.total)}</td>
                      <td className={`tnum py-2 text-right ${heavy ? "text-bad" : "text-muted"}`}>
                        {money(ar.d120)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-4 space-y-1 text-sm text-muted">
              {carriers && carriers.rows.length > 0 && (
                <p>
                  <span className="tnum font-medium text-ink">{carriers.rows.length}</span>{" "}
                  carriers, totalling{" "}
                  <span className="tnum font-medium text-ink">
                    {money(carriers.rows.reduce((a, c) => a + c.total, 0))}
                  </span>{" "}
                  — the insurance side of the A/R.
                </p>
              )}
              {services && services.rows.length > 0 && (
                <p>
                  <span className="tnum font-medium text-ink">{services.rows.length}</span>{" "}
                  procedure lines.
                </p>
              )}
              {referrals && referrals.rows.length > 0 && (
                <p>
                  <span className="tnum font-medium text-ink">{referrals.rows.length}</span>{" "}
                  referring providers.
                </p>
              )}
            </div>
          </section>

          {history && history.rows.length > 0 && (
            <label className="flex items-start gap-3 rounded-card border border-hairline bg-surface shadow-card p-4">
              <input
                type="checkbox"
                checked={includeHistory}
                onChange={(e) => setIncludeHistory(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium">
                  Load {history.months.length} months of history as well
                </span>
                <span className="block text-muted">
                  {history.months[0]?.slice(0, 7)} to{" "}
                  {history.months[history.months.length - 1]?.slice(0, 7)} —{" "}
                  <span className="tnum">{history.rows.length}</span> rows. Only needs doing once
                  per clinic.
                </span>
              </span>
            </label>
          )}

          <section className="border-t border-hairline pt-6">
            <button
              onClick={commit}
              disabled={!canCommit}
              className="rounded bg-accent px-5 py-2.5 font-medium text-white
                         transition hover:bg-accent/90 disabled:opacity-40"
            >
              {busy ? "Importing…" : `Import into ${clinicName}, ${monthLabel}`}
            </button>

            {mismatch && !overrideOk && (
              <p className="mt-3 text-sm text-muted">
                Set the month and clinic to match the file, or tick the box above.
              </p>
            )}

            {result && (
              <p
                className={`mt-4 rounded border p-3 text-sm ${
                  result.ok
                    ? "border-good/30 bg-good/5 text-good"
                    : "border-bad/30 bg-bad/5 text-bad"
                }`}
              >
                {result.message}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
