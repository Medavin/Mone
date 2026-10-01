"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { promptClassCode as classCode } from "@/lib/promptClass";
import { parsePromptCpt, codesFor, facilityTotal } from "@/lib/parsePromptCpt";

/**
 * Prompt "Revenue by CPT Code" → service_monthly (units, billed, allowed,
 * paid) per client × month × insurance type × CPT. This is what the clinic
 * page's Services tab and the Results "Add-On Code Utilization" card read.
 */

type Clinic = { id: number; name: string; status: string; billing_system?: string | null };
const key = (f: string) => `prompt:${f.trim().toLowerCase().replace(/\s+/g, " ")}`;
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const monthName = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function PromptCptImport({
  wb, fileName, clinics, aliases,
}: {
  wb: XLSX.WorkBook; fileName: string; clinics: Clinic[]; aliases: { normalised: string; clinic_id: number }[];
}) {
  const parsed = useMemo(() => parsePromptCpt(wb), [wb]);
  const aliasOf = new Map(aliases.map((a) => [a.normalised, a.clinic_id]));
  const initial: Record<string, string> = {};
  for (const f of parsed.facilities) {
    const k = aliasOf.get(key(f));
    initial[f] = k ? String(k) : "";
  }
  const [map, setMap] = useState(initial);
  const [account, setAccount] = useState(Object.values(initial).find(Boolean) ?? "");
  const [months, setMonths] = useState<string[]>(parsed.fullMonths);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string; clinicId?: number } | null>(null);

  const promptFirst = [...clinics.filter((c) => c.status === "active")].sort((a, b) =>
    (a.billing_system === "prompt" ? 0 : 1) - (b.billing_system === "prompt" ? 0 : 1) || a.name.localeCompare(b.name));
  const effective = (f: string) => map[f] || account;
  const unmapped = parsed.facilities.filter((f) => !effective(f));
  const errors = parsed.issues.filter((i) => i.level === "error");
  const warns = parsed.issues.filter((i) => i.level === "warn");
  const groups = new Map<number, string[]>();
  for (const f of parsed.facilities) {
    const id = Number(effective(f));
    if (id) groups.set(id, [...(groups.get(id) ?? []), f]);
  }
  const names = Array.from(groups.keys()).map((id) => clinics.find((c) => c.id === id)?.name ?? "?");
  const canImport = !busy && errors.length === 0 && unmapped.length === 0 && groups.size > 0 && months.length > 0;
  const known = !!parsed.rangeFrom;

  async function commit() {
    setBusy(true);
    setResult(null);
    const supabase = createClient();

    // Reference data first: codes and insurance types, ids read back.
    setProgress("Saving CPT codes…");
    const { data: procs, error: pe } = await supabase.from("procedures")
      .upsert(parsed.codes.map((code) => ({ code })), { onConflict: "code", ignoreDuplicates: false }).select("id, code");
    if (pe) { setResult({ ok: false, message: `Could not save CPT codes: ${pe.message}` }); setBusy(false); return; }
    const procId = new Map((procs ?? []).map((p) => [p.code as string, p.id as number]));

    const types = new Set<string>();
    for (const f of parsed.facilities) for (const m of months) for (const t of Array.from(parsed.cells.get(f)?.get(m)?.keys() ?? [])) types.add(t);
    const { data: fcs, error: fe } = await supabase.from("financial_classes")
      .upsert(Array.from(types).map((t, i) => ({ code: classCode(t), name: `${t.toUpperCase()} (PROMPT)`.slice(0, 120), sort_order: 960 + i })), { onConflict: "code" })
      .select("id, code");
    if (fe) { setResult({ ok: false, message: `Could not save insurance types: ${fe.message}` }); setBusy(false); return; }
    const fcId = new Map((fcs ?? []).map((r) => [r.code as string, r.id as number]));
    const { data: allPt } = await supabase.from("financial_classes").select("id").like("code", "PT-%");
    const ptClassIds = (allPt ?? []).map((r) => r.id as number);

    for (const [cid, fs] of Array.from(groups.entries())) {
      for (const m of months) {
        setProgress(`${clinics.find((c) => c.id === cid)?.name} · ${monthName(m)}…`);
        const period = `${m}-01`;
        const { data: batch, error: be } = await supabase.from("import_batches").insert({
          source_type: "file", source_name: fileName, report_kind: "prompt_cpt", clinic_id: cid, period_month: period, status: "running",
        }).select("id").single();
        if (be || !batch) { setResult({ ok: false, message: `Could not start: ${be?.message}` }); setBusy(false); return; }

        const payload: Record<string, unknown>[] = [];
        for (const [t, byC] of Array.from(codesFor(parsed, fs, m).entries())) {
          for (const [code, c] of Array.from(byC.entries())) {
            payload.push({
              clinic_id: cid, period_month: period, financial_class_id: fcId.get(classCode(t))!, procedure_id: procId.get(code)!,
              units: r2(c.units), charges: r2(c.billed), allowed: r2(c.allowed), paid: r2(c.paid), source_batch_id: batch.id,
            });
          }
        }
        // Replace, never add: clear this client-month's earlier Prompt rows first.
        const { error: delErr } = await supabase.from("service_monthly").delete()
          .eq("clinic_id", cid).eq("period_month", period).in("financial_class_id", ptClassIds);
        let err: { message: string } | null = delErr;
        for (let i = 0; i < payload.length && !err; i += 400) {
          const { error } = await supabase.from("service_monthly")
            .upsert(payload.slice(i, i + 400), { onConflict: "clinic_id,period_month,financial_class_id,procedure_id" });
          err = error;
        }
        await supabase.from("import_batches").update({
          status: err ? "failed" : "success", finished_at: new Date().toISOString(),
          rows_read: payload.length, rows_accepted: err ? 0 : payload.length, error_detail: err?.message ?? null,
        }).eq("id", batch.id);
        if (err) {
          setResult({ ok: false, message: /allowed|paid/.test(err.message) ? "Run migration 034 first — it adds the allowed and paid columns." : `Failed for ${monthName(m)}: ${err.message}` });
          setBusy(false); return;
        }
      }
      await supabase.from("clinic_aliases").upsert(fs.map((f) => ({ normalised: key(f), clinic_id: cid, raw_example: f, source: "prompt" })), { onConflict: "normalised" });
    }
    setBusy(false);
    setProgress("");
    setResult({
      ok: true,
      message: `Imported CPT figures for ${names.join(", ")}, ${months.length} month${months.length === 1 ? "" : "s"} (${monthName(months[0])} – ${monthName(months[months.length - 1])}).`,
      clinicId: groups.size === 1 ? Array.from(groups.keys())[0] : undefined,
    });
  }

  const box = "rounded border border-hairline bg-surface px-2 py-1.5 text-sm";

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold">2 · What the file contains — Revenue by CPT Code</h2>
        <p className="mt-1 text-sm text-muted">
          Visits dated {parsed.rangeFrom ?? "?"} to {parsed.rangeTo ?? "?"} · {parsed.facilities.length} facilities ·{" "}
          {parsed.codes.length} CPT codes · {int(parsed.totals.lines)} lines · {int(parsed.totals.units)} units ·{" "}
          {money(parsed.totals.billed)} billed · {money(parsed.totals.paid)} paid
        </p>
        {errors.length > 0 && (
          <ul className="mt-2 space-y-1 rounded border border-bad/30 bg-bad/5 p-3 text-sm text-bad">
            {errors.map((e, i) => <li key={i}>✕ {e.message}</li>)}
          </ul>
        )}
        {errors.length === 0 && parsed.summaryTotals && (
          <p className="mt-2 text-xs text-good">✓ The lines add up exactly to Prompt&apos;s own Totals row — units, billed, allowed and paid.</p>
        )}
        {warns.map((w, i) => <p key={i} className="mt-1 text-xs text-warn">! {w.message}</p>)}

        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-muted">
              <th className="py-1 text-left font-medium">Facility</th>
              <th className="py-1 text-right font-medium">Units</th>
              <th className="py-1 text-right font-medium">Billed</th>
              <th className="py-1 text-right font-medium">Allowed</th>
              <th className="py-1 text-right font-medium">Paid</th>
              <th className="py-1 pl-3 text-left font-medium">MBOne client</th>
            </tr>
          </thead>
          <tbody>
            {parsed.facilities.map((f) => {
              const c = facilityTotal(parsed, f);
              return (
                <tr key={f} className="border-b border-hairline/60">
                  <td className="py-1.5">{f}</td>
                  <td className="tnum py-1.5 text-right">{int(c.units)}</td>
                  <td className="tnum py-1.5 text-right">{money(c.billed)}</td>
                  <td className="tnum py-1.5 text-right">{money(c.allowed)}</td>
                  <td className="tnum py-1.5 text-right">{money(c.paid)}</td>
                  <td className="py-1.5 pl-3">
                    <select value={map[f] ?? ""} onChange={(e) => setMap({ ...map, [f]: e.target.value })} className={`${box} w-full`}>
                      <option value="">{account ? `Same as the account (${clinics.find((c) => String(c.id) === account)?.name})` : "Choose…"}</option>
                      {promptFirst.map((c) => <option key={c.id} value={c.id}>{c.name}{c.billing_system === "prompt" ? " · Prompt" : ""}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Prompt&apos;s own note: this report only includes claims paid line by line, so <strong>units and billed are lower</strong> than
          in the Visits Revenue Report (claims not yet paid are missing). <strong>Paid</strong> and <strong>allowed</strong> are the
          figures to rely on. Allowed = what the carrier paid plus the patient&apos;s co-pay, co-insurance and deductible.
        </p>
      </section>

      <section className="rounded-card border border-hairline bg-canvas/40 p-4">
        <h2 className="text-sm font-semibold">3 · Where it goes</h2>
        <label className="mt-2 block text-xs text-muted">
          Which Momentum client is this Prompt account?
          <select value={account} onChange={(e) => setAccount(e.target.value)} className={`${box} mt-1 block min-w-[16rem]`}>
            <option value="">Choose a client…</option>
            {promptFirst.map((c) => <option key={c.id} value={c.id}>{c.name}{c.billing_system === "prompt" ? " · Prompt" : ""}</option>)}
          </select>
        </label>
        <div className="mt-3 text-xs text-muted">
          {known ? "Months to load (only months the report covers from the 1st to the last day):" : "The report does not state its dates — tick only complete months:"}
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {parsed.months.map((m) => {
            const full = known ? parsed.fullMonths.includes(m) : true;
            return (
              <label key={m} className={`flex items-center gap-1.5 ${full ? "" : "text-muted"}`}>
                <input type="checkbox" disabled={!full} checked={months.includes(m)}
                  onChange={(e) => setMonths(e.target.checked ? [...months, m].sort() : months.filter((x) => x !== m))} />
                {monthName(m)}{known && !full && " — only part of the month, left out"}
              </label>
            );
          })}
        </div>
        {unmapped.length > 0 && <p className="mt-2 text-xs text-bad">Choose a client for: {unmapped.join(", ")}.</p>}
      </section>

      <div className="flex items-center gap-3">
        <button onClick={commit} disabled={!canImport}
          className="rounded-card bg-accent px-5 py-2 text-sm font-semibold text-white shadow-card hover:bg-accentDeep disabled:opacity-40">
          {busy ? progress || "Importing…" : `Import into ${names.join(", ") || "…"}`}
        </button>
        <span className="text-xs text-muted">Importing the same month again replaces it, it never adds to it.</span>
      </div>

      {result && (
        <div className={`rounded border p-3 text-sm ${result.ok ? "border-good/30 bg-good/5 text-good" : "border-bad/30 bg-bad/5 text-bad"}`}>
          {result.message}
          {result.ok && result.clinicId && (
            <> <Link href={`/results?client=${result.clinicId}&section=utilization`} className="ml-2 underline">Open Utilization in Results</Link></>
          )}
        </div>
      )}
    </div>
  );
}
