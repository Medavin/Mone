"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { parsePromptAr, isPromptAr, rangeLooksPartial, type PromptAr, type Buckets } from "@/lib/parsePromptAr";
import { isPromptRevenue } from "@/lib/parsePromptRevenue";
import PromptRevenueImport from "./PromptRevenueImport";
import PromptCptImport from "./PromptCptImport";
import PromptRemitImport from "./PromptRemitImport";
import { isPromptRemit } from "@/lib/parsePromptRemit";
import { isPromptCpt } from "@/lib/parsePromptCpt";

/**
 * The Prompt A/R import, in the order Pravin asked for on the AdvancedMD
 * import: read the file, show what it says, ask where it goes, and only
 * then write.
 *
 * WHAT IT WRITES, per MBOne client, for the report's month:
 *   ar_monthly        three rows — primary / secondary / patient (P-PRI …)
 *   ar_split_monthly  insurance (primary + secondary) and patient
 *   clinic_monthly    closing A/R, and opening + change when last month exists
 *   carrier_ar_monthly  by insurance company — only when the whole file
 *                       belongs to ONE client, since the company summary
 *                       is not split by facility
 * One import_batches row per client, so "undo an import" works per client.
 */

type Clinic = { id: number; name: string; status: string; billing_system?: string | null };
const key = (facility: string) => `prompt:${facility.trim().toLowerCase().replace(/\s+/g, " ")}`;
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const add = (a: Buckets, b: Buckets): Buckets => ({
  current: a.current + b.current, d30: a.d30 + b.d30, d60: a.d60 + b.d60,
  d90: a.d90 + b.d90, d120: a.d120 + b.d120, total: a.total + b.total,
});
const zero = (): Buckets => ({ current: 0, d30: 0, d60: 0, d90: 0, d120: 0, total: 0 });

export default function PromptImportClient({
  clinics,
  aliases,
  classes,
}: {
  clinics: Clinic[];
  aliases: { normalised: string; clinic_id: number }[];
  classes: { id: number; code: string }[];
}) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<PromptAr | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [revenueWb, setRevenueWb] = useState<XLSX.WorkBook | null>(null);
  const [cptWb, setCptWb] = useState<XLSX.WorkBook | null>(null);
  const [remitWb, setRemitWb] = useState<XLSX.WorkBook | null>(null);
  const [reading, setReading] = useState(false);
  const [account, setAccount] = useState("");
  const [map, setMap] = useState<Record<string, string>>({});
  const [month, setMonth] = useState("");
  const [partialOk, setPartialOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; clinicIds?: number[] } | null>(null);

  const aliasOf = new Map(aliases.map((a) => [a.normalised, a.clinic_id]));
  const promptFirst = [...clinics.filter((c) => c.status === "active")].sort((a, b) => {
    const pa = a.billing_system === "prompt" ? 0 : 1;
    const pb = b.billing_system === "prompt" ? 0 : 1;
    return pa - pb || a.name.localeCompare(b.name);
  });
  const fc = new Map(classes.map((c) => [c.code, c.id]));
  const classesMissing = !fc.has("P-PRI") || !fc.has("P-SEC") || !fc.has("P-PAT");

  async function onFile(file: File) {
    setResult(null);
    setReadError(null);
    setParsed(null);
    setRevenueWb(null);
    setCptWb(null);
    setRemitWb(null);
    setFileName(file.name);
    setPartialOk(false);
    setReading(true);
    // Let the "Reading…" line paint before the browser is busy for a few seconds.
    await new Promise((r) => setTimeout(r, 30));
    try {
      // Dates are read as Excel day numbers, NOT as JavaScript dates. A
      // JavaScript date is converted through this computer's time zone, and on
      // India time every date came out a day early (2 Oct 2026). Day numbers
      // are converted in UTC by the parsers, so they mean the same everywhere.
      // A CSV is read as plain text with NO value guessing (raw), so dates
      // stay as "01/02/2026" and are converted by the parser, not by the
      // spreadsheet reader through this computer's time zone.
      const wb = /\.csv$/i.test(file.name)
        ? XLSX.read(await file.text(), { type: "string", raw: true })
        : XLSX.read(await file.arrayBuffer(), { type: "array" });
      if (isPromptRemit(wb)) {
        setRemitWb(wb);
        return;
      }
      if (isPromptCpt(wb)) {
        setCptWb(wb);
        return;
      }
      if (isPromptRevenue(wb)) {
        setRevenueWb(wb);
        return;
      }
      if (!isPromptAr(wb)) {
        setReadError("MBOne recognises four Prompt reports so far, all under Reports → Revenue: the A/R Report, the Visits Revenue Report, Revenue by CPT Code and the Remit Allocation Report. This file is none of them.");
        return;
      }
      const p = parsePromptAr(wb, file.name);
      setParsed(p);
      setMonth(p.asOf ? p.asOf.slice(0, 7) : "");
      // Each facility: the client it was filed under last time, if any.
      const m: Record<string, string> = {};
      for (const f of p.facilities) {
        const known = aliasOf.get(key(f.facility));
        m[f.facility] = known ? String(known) : "";
      }
      setMap(m);
      const firstKnown = Object.values(m).find(Boolean);
      setAccount(firstKnown ?? "");
    } catch (e) {
      setReadError(`Could not read the file: ${(e as Error).message}`);
    } finally {
      setReading(false);
    }
  }

  // The "whole account" picker fills every facility not set separately.
  const effective = (f: string) => map[f] || account;

  const perClient = useMemo(() => {
    const out = new Map<number, { primary: Buckets; secondary: Buckets; patient: Buckets; facilities: string[] }>();
    if (!parsed) return out;
    for (const f of parsed.facilities) {
      const id = Number(effective(f.facility));
      if (!id) continue;
      const c = out.get(id) ?? { primary: zero(), secondary: zero(), patient: zero(), facilities: [] };
      c.primary = add(c.primary, f.primary);
      c.secondary = add(c.secondary, f.secondary);
      c.patient = add(c.patient, f.patient);
      c.facilities.push(f.facility);
      out.set(id, c);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, map, account]);

  const unmapped = parsed ? parsed.facilities.filter((f) => !effective(f.facility)) : [];
  const errors = parsed?.issues.filter((i) => i.level === "error") ?? [];
  const warns = parsed?.issues.filter((i) => i.level === "warn") ?? [];
  const partial = parsed ? rangeLooksPartial(parsed) : false;
  const nonPrompt = Array.from(perClient.keys()).filter((id) => clinics.find((c) => c.id === id)?.billing_system !== "prompt");
  const canImport =
    !!parsed && !busy && errors.length === 0 && unmapped.length === 0 && !!month && perClient.size > 0 &&
    !classesMissing && (!partial || partialOk);
  const clientNames = Array.from(perClient.keys()).map((id) => clinics.find((c) => c.id === id)?.name ?? "?");
  const monthLabel = month ? new Date(`${month}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";

  async function commit() {
    if (!parsed || !canImport) return;
    setBusy(true);
    setResult(null);
    const supabase = createClient();
    const period = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const prevPeriod = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    const singleClient = perClient.size === 1;
    const done: number[] = [];

    for (const [cid, c] of Array.from(perClient.entries())) {
      const { data: batch, error: be } = await supabase.from("import_batches").insert({
        source_type: "file", source_name: fileName, report_kind: "prompt_ar",
        clinic_id: cid, period_month: period, status: "running",
      }).select("id").single();
      if (be || !batch) {
        setResult({ ok: false, message: `Could not start the import: ${be?.message}` });
        setBusy(false);
        return;
      }
      const batchId = batch.id as number;
      const ins = add(c.primary, c.secondary);
      const total = ins.total + c.patient.total;
      const row = (b: Buckets) => ({
        bucket_current: b.current, bucket_30: b.d30, bucket_60: b.d60, bucket_90: b.d90, bucket_120_plus: b.d120,
      });

      const { data: prev } = await supabase.from("clinic_monthly").select("closing_ar")
        .eq("clinic_id", cid).eq("period_month", prevPeriod).maybeSingle();
      const opening = prev?.closing_ar === null || prev?.closing_ar === undefined ? null : Number(prev.closing_ar);

      const steps: [string, () => PromiseLike<{ error: { message: string } | null }>][] = [
        ["A/R by class", () => supabase.from("ar_monthly").upsert(
          [["P-PRI", c.primary], ["P-SEC", c.secondary], ["P-PAT", c.patient]].map(([code, b]) => ({
            clinic_id: cid, period_month: period, financial_class_id: fc.get(code as string)!,
            closing_ar: (b as Buckets).total, ...row(b as Buckets), source_batch_id: batchId,
            note: "Prompt A/R Report",
          })),
          { onConflict: "clinic_id,period_month,financial_class_id" })],
        ["Insurance vs patient", () => supabase.from("ar_split_monthly").upsert([
          { clinic_id: cid, period_month: period, payer_type: "insurance", ...row(ins), total_ar: ins.total, net_ar: ins.total, source_batch_id: batchId },
          { clinic_id: cid, period_month: period, payer_type: "patient", ...row(c.patient), total_ar: c.patient.total, net_ar: c.patient.total, source_batch_id: batchId },
        ], { onConflict: "clinic_id,period_month,payer_type" })],
        ["Clinic totals", () => supabase.from("clinic_monthly").upsert({
          clinic_id: cid, period_month: period, closing_ar: total,
          opening_ar: opening, ar_change: opening === null ? null : Math.round((total - opening) * 100) / 100,
          source_batch_id: batchId,
          note: `Prompt A/R Report as of ${parsed.asOf ?? "?"} — facilities: ${c.facilities.join(", ")}`,
        }, { onConflict: "clinic_id,period_month" })],
      ];

      if (singleClient && parsed.payers.length) {
        steps.push(["Insurance companies", async () => {
          const list = parsed.payers.map((p) => ({ code: `PROMPT:${p.payer}`.slice(0, 120), name: p.payer }));
          const uniq = Array.from(new Map(list.map((x) => [x.code, x])).values());
          const { data: saved, error } = await supabase.from("carriers").upsert(uniq, { onConflict: "code" }).select("id, code");
          if (error) return { error };
          const idOf = new Map((saved ?? []).map((s) => [s.code as string, s.id as number]));
          const merged = new Map<number, Record<string, number | string>>();
          for (const p of parsed.payers) {
            const id = idOf.get(`PROMPT:${p.payer}`.slice(0, 120));
            if (!id) continue;
            const r = merged.get(id) ?? { clinic_id: cid, period_month: period, carrier_id: id, bucket_current: 0, bucket_30: 0, bucket_60: 0, bucket_90: 0, bucket_120_plus: 0, total_ar: 0, source_batch_id: batchId };
            r.bucket_current = (r.bucket_current as number) + p.current;
            r.bucket_30 = (r.bucket_30 as number) + p.d30;
            r.bucket_60 = (r.bucket_60 as number) + p.d60;
            r.bucket_90 = (r.bucket_90 as number) + p.d90;
            r.bucket_120_plus = (r.bucket_120_plus as number) + p.d120;
            r.total_ar = (r.total_ar as number) + p.total;
            merged.set(id, r);
          }
          return supabase.from("carrier_ar_monthly").upsert(Array.from(merged.values()), { onConflict: "clinic_id,period_month,carrier_id" });
        }]);
      }

      steps.push(["Remember facility names", () => supabase.from("clinic_aliases").upsert(
        c.facilities.map((f) => ({ normalised: key(f), clinic_id: cid, raw_example: f, source: "prompt_ar" })),
        { onConflict: "normalised" })]);

      for (const [label, run] of steps) {
        const { error } = await run();
        if (error) {
          await supabase.from("import_batches").update({
            status: "failed", finished_at: new Date().toISOString(), error_detail: `${label}: ${error.message}`,
          }).eq("id", batchId);
          setResult({ ok: false, message: `Failed on "${label}" for ${clinics.find((x) => x.id === cid)?.name}: ${error.message}` });
          setBusy(false);
          return;
        }
      }
      await supabase.from("import_batches").update({
        status: "success", finished_at: new Date().toISOString(),
        rows_read: c.facilities.length, rows_accepted: c.facilities.length,
      }).eq("id", batchId);
      done.push(cid);
    }

    setBusy(false);
    setResult({
      ok: true,
      message: `Imported ${monthLabel} A/R for ${clientNames.join(", ")} — ${money(parsed.grand?.total ?? 0)} across ${parsed.facilities.length} facilities.`,
      clinicIds: done,
    });
  }

  const box = "rounded border border-hairline bg-surface px-2 py-1.5 text-sm";

  return (
    <div className="space-y-6">
      {classesMissing && (
        <p className="rounded border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          Run migration 032 first — it adds the three Prompt A/R classes this import writes to.
        </p>
      )}

      {/* 1 — the file */}
      <section>
        <h2 className="text-sm font-semibold">1 · Choose the Prompt report — A/R, Visits Revenue, Revenue by CPT Code or Remit Allocation</h2>
        <input type="file" accept=".xlsx,.xls,.csv" className="mt-2 text-sm"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {readError && <p className="mt-2 text-sm text-bad">{readError}</p>}
      </section>

      {reading && <p className="text-sm text-muted">Reading the file… a large report can take up to half a minute.</p>}
      {remitWb && <PromptRemitImport wb={remitWb} fileName={fileName} clinics={clinics} aliases={aliases} />}
      {cptWb && <PromptCptImport wb={cptWb} fileName={fileName} clinics={clinics} aliases={aliases} />}
      {revenueWb && <PromptRevenueImport wb={revenueWb} fileName={fileName} clinics={clinics} aliases={aliases} />}

      {parsed && (
        <>
          {/* 2 — what it says */}
          <section>
            <h2 className="text-sm font-semibold">2 · What the file contains</h2>
            <p className="mt-1 text-sm text-muted">
              A/R as of <strong className="text-ink">{parsed.asOf ?? "unknown"}</strong>
              {parsed.asOfSource && <> (from {parsed.asOfSource})</>}
              {parsed.rangeFrom && <> · date filter {parsed.rangeFrom} to {parsed.rangeTo}</>}
              {" · "}{parsed.facilities.length} facilities · {parsed.payers.length} insurance companies
              {parsed.grand && <> · total {money(parsed.grand.total)}</>}
            </p>

            {errors.length > 0 && (
              <ul className="mt-2 space-y-1 rounded border border-bad/30 bg-bad/5 p-3 text-sm text-bad">
                {errors.map((e, i) => <li key={i}>✕ {e.message}</li>)}
                <li className="pt-1 text-xs">The file disagrees with its own totals, so it is not loaded.</li>
              </ul>
            )}
            {warns.length > 0 && (
              <ul className="mt-2 space-y-1 rounded border border-warn/30 bg-warn/5 p-3 text-sm text-warn">
                {warns.map((e, i) => <li key={i}>! {e.message}</li>)}
              </ul>
            )}
            {errors.length === 0 && (
              <p className="mt-2 text-xs text-good">✓ Every facility&apos;s buckets add up, and the facilities match the report&apos;s own Total rows.</p>
            )}

            {partial && (
              <div className="mt-3 rounded border border-bad/40 bg-bad/5 p-3 text-sm">
                <p className="font-semibold text-bad">This A/R only covers visits from {parsed.rangeFrom} to {parsed.rangeTo}.</p>
                <p className="mt-1 text-ink">
                  Prompt&apos;s From–To filter limits the A/R Report to visits in that range, so older claims still owed
                  are missing — which is why everything sits in 0–30 days. Loaded as the client&apos;s A/R it would look
                  complete and be badly understated. For the real receivable, download again with <strong>From</strong> set
                  to the earliest date Prompt allows and <strong>To</strong> set to the month end.
                </p>
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={partialOk} onChange={(e) => setPartialOk(e.target.checked)} />
                  Load it anyway (testing only)
                </label>
              </div>
            )}

            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-muted">
                  <th className="py-1 text-left font-medium">Prompt facility</th>
                  <th className="py-1 text-right font-medium">Primary</th>
                  <th className="py-1 text-right font-medium">Secondary</th>
                  <th className="py-1 text-right font-medium">Patient</th>
                  <th className="py-1 text-right font-medium">120+ days</th>
                  <th className="py-1 pl-3 text-left font-medium">MBOne client</th>
                </tr>
              </thead>
              <tbody>
                {parsed.facilities.map((f) => {
                  const o120 = f.primary.d120 + f.secondary.d120 + f.patient.d120;
                  return (
                    <tr key={f.facility} className="border-b border-hairline/60">
                      <td className="py-1.5">{f.facility}</td>
                      <td className="tnum py-1.5 text-right">{money(f.primary.total)}</td>
                      <td className="tnum py-1.5 text-right">{money(f.secondary.total)}</td>
                      <td className="tnum py-1.5 text-right">{money(f.patient.total)}</td>
                      <td className="tnum py-1.5 text-right">{money(o120)}</td>
                      <td className="py-1.5 pl-3">
                        <select value={map[f.facility] ?? ""} onChange={(e) => setMap({ ...map, [f.facility]: e.target.value })} className={`${box} w-full`}>
                          <option value="">{account ? `Same as the account (${clinics.find((c) => String(c.id) === account)?.name})` : "Choose…"}</option>
                          {promptFirst.map((c) => <option key={c.id} value={c.id}>{c.name}{c.billing_system === "prompt" ? " · Prompt" : ""}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* 3 — where it goes */}
          <section className="rounded-card border border-hairline bg-canvas/40 p-4">
            <h2 className="text-sm font-semibold">3 · Where it goes</h2>
            <div className="mt-2 flex flex-wrap items-end gap-4">
              <label className="text-xs text-muted">
                Which Momentum client is this Prompt account?
                <select value={account} onChange={(e) => setAccount(e.target.value)} className={`${box} mt-1 block min-w-[16rem]`}>
                  <option value="">Choose a client…</option>
                  {promptFirst.map((c) => <option key={c.id} value={c.id}>{c.name}{c.billing_system === "prompt" ? " · Prompt" : ""}</option>)}
                </select>
                <span className="mt-1 block">Every facility goes here unless you pick another client beside it above.</span>
              </label>
              <label className="text-xs text-muted">
                Month
                <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={`${box} mt-1 block`} />
                <span className="mt-1 block">From the report date. A mid-month download is replaced by the month-end one.</span>
              </label>
            </div>

            {nonPrompt.length > 0 && (
              <p className="mt-3 text-xs text-warn">
                ! {nonPrompt.map((id) => clinics.find((c) => c.id === id)?.name).join(", ")} is set to AdvancedMD, not Prompt.
                If it really bills in Prompt, change it under Settings → Clinics.
              </p>
            )}

            {perClient.size > 0 && (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-muted">
                    <th className="py-1 text-left font-medium">Client</th>
                    <th className="py-1 text-right font-medium">Insurance A/R</th>
                    <th className="py-1 text-right font-medium">Patient A/R</th>
                    <th className="py-1 text-right font-medium">Total</th>
                    <th className="py-1 text-right font-medium">% 120+ insurance</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(perClient.entries()).map(([id, c]) => {
                    const ins = add(c.primary, c.secondary);
                    return (
                      <tr key={id} className="border-b border-hairline/60">
                        <td className="py-1.5">{clinics.find((x) => x.id === id)?.name}<div className="text-[11px] text-muted">{c.facilities.join(", ")}</div></td>
                        <td className="tnum py-1.5 text-right">{money(ins.total)}</td>
                        <td className="tnum py-1.5 text-right">{money(c.patient.total)}</td>
                        <td className="tnum py-1.5 text-right font-semibold">{money(ins.total + c.patient.total)}</td>
                        <td className="tnum py-1.5 text-right">{ins.total ? `${((ins.d120 / ins.total) * 100).toFixed(1)}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {perClient.size > 1 && (
              <p className="mt-2 text-xs text-muted">The file is split across {perClient.size} clients, so the by-insurance-company view is not saved — Prompt&apos;s company summary is not split by facility.</p>
            )}
            {unmapped.length > 0 && <p className="mt-2 text-xs text-bad">Choose a client for: {unmapped.map((f) => f.facility).join(", ")}.</p>}
          </section>

          <div className="flex items-center gap-3">
            <button onClick={commit} disabled={!canImport}
              className="rounded-card bg-accent px-5 py-2 text-sm font-semibold text-white shadow-card hover:bg-accentDeep disabled:opacity-40">
              {busy ? "Importing…" : perClient.size ? `Import into ${clientNames.join(", ")}, ${monthLabel}` : "Import"}
            </button>
            <span className="text-xs text-muted">Importing the same client and month again replaces it, it never adds to it.</span>
          </div>
        </>
      )}

      {result && (
        <div className={`rounded border p-3 text-sm ${result.ok ? "border-good/30 bg-good/5 text-good" : "border-bad/30 bg-bad/5 text-bad"}`}>
          {result.message}
          {result.ok && result.clinicIds?.length === 1 && (
            <span className="ml-2">
              <Link href={`/results?client=${result.clinicIds[0]}&start=${month}-01&end=${month}-28`} className="underline">Open in Results</Link>
              {" · "}
              <Link href={`/clinics/${result.clinicIds[0]}?month=${month}`} className="underline">Open the clinic page</Link>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
