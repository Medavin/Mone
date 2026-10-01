"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import {
  parsePromptRevenue, facilityMonth, overCount, OVER_VISITS, type RevenueCell,
} from "@/lib/parsePromptRevenue";

/**
 * Prompt "Visits Revenue Report" → activity_monthly (visits, charges,
 * payments, new patients), by payer type, per client per month. Plus the
 * two "patients over 25 visits" counts when the file starts on 1 January.
 *
 * Payer types become financial classes "PT-…" so the clinic page's
 * Activity tab shows the mix, the same way AdvancedMD's classes do.
 */

type Clinic = { id: number; name: string; status: string; billing_system?: string | null };
const key = (f: string) => `prompt:${f.trim().toLowerCase().replace(/\s+/g, " ")}`;
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const int = (n: number) => n.toLocaleString("en-US");
const classCode = (payer: string) => `PT-${payer.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 40);
const monthName = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export default function PromptRevenueImport({
  wb, fileName, clinics, aliases,
}: {
  wb: XLSX.WorkBook; fileName: string; clinics: Clinic[]; aliases: { normalised: string; clinic_id: number }[];
}) {
  const parsed = useMemo(() => parsePromptRevenue(wb, fileName), [wb, fileName]);
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
  const [result, setResult] = useState<{ ok: boolean; message: string; clinicIds?: number[] } | null>(null);

  const promptFirst = [...clinics.filter((c) => c.status === "active")].sort((a, b) =>
    (a.billing_system === "prompt" ? 0 : 1) - (b.billing_system === "prompt" ? 0 : 1) || a.name.localeCompare(b.name));
  const effective = (f: string) => map[f] || account;
  const unmapped = parsed.facilities.filter((f) => !effective(f));
  const errors = parsed.issues.filter((i) => i.level === "error");
  const warns = parsed.issues.filter((i) => i.level === "warn");

  // client → facilities
  const groups = new Map<number, string[]>();
  for (const f of parsed.facilities) {
    const id = Number(effective(f));
    if (id) groups.set(id, [...(groups.get(id) ?? []), f]);
  }
  const sumFor = (fs: string[], m: string): RevenueCell =>
    fs.map((f) => facilityMonth(parsed, f, m)).reduce((a, b) => {
      const o = { ...a };
      for (const k of Object.keys(o) as (keyof RevenueCell)[]) o[k] += b[k];
      return o;
    });

  const canImport = !busy && errors.length === 0 && unmapped.length === 0 && groups.size > 0 && (months.length > 0 || !!parsed.patientVisits);
  const names = Array.from(groups.keys()).map((id) => clinics.find((c) => c.id === id)?.name ?? "?");

  async function commit() {
    setBusy(true);
    setResult(null);
    const supabase = createClient();

    // Payer types → financial classes (reference data, shared by every clinic).
    const payers = new Set<string>();
    for (const f of parsed.facilities) for (const m of months) for (const p of Array.from(parsed.cells.get(f)?.get(m)?.keys() ?? [])) payers.add(p);
    const fcRows = Array.from(payers).map((p, i) => ({ code: classCode(p), name: `${p.toUpperCase()} (PROMPT)`.slice(0, 120), sort_order: 950 + i }));
    let fcId = new Map<string, number>();
    if (fcRows.length) {
      const { data, error } = await supabase.from("financial_classes").upsert(fcRows, { onConflict: "code" }).select("id, code");
      if (error) { setResult({ ok: false, message: `Could not save payer types: ${error.message}` }); setBusy(false); return; }
      fcId = new Map((data ?? []).map((r) => [r.code as string, r.id as number]));
    }

    const done: number[] = [];
    for (const [cid, fs] of Array.from(groups.entries())) {
      for (const m of months) {
        const period = `${m}-01`;
        const { data: batch, error: be } = await supabase.from("import_batches").insert({
          source_type: "file", source_name: fileName, report_kind: "prompt_revenue", clinic_id: cid, period_month: period, status: "running",
        }).select("id").single();
        if (be || !batch) { setResult({ ok: false, message: `Could not start: ${be?.message}` }); setBusy(false); return; }

        // One row per payer type, the facilities of this client added together.
        const byPayer = new Map<string, RevenueCell>();
        for (const f of fs) for (const [p, c] of Array.from(parsed.cells.get(f)?.get(m)?.entries() ?? [])) {
          const t = byPayer.get(p) ?? { appointments: 0, visits: 0, cancelled: 0, noShow: 0, evals: 0, billed: 0, paid: 0, patientPaid: 0, insurancePaid: 0 };
          for (const k of Object.keys(t) as (keyof RevenueCell)[]) t[k] += c[k];
          byPayer.set(p, t);
        }
        const payload = Array.from(byPayer.entries()).map(([p, c]) => ({
          clinic_id: cid, period_month: period, financial_class_id: fcId.get(classCode(p))!,
          visits: c.visits, new_patients: c.evals,
          charges: Math.round(c.billed * 100) / 100, payments: Math.round(c.paid * 100) / 100,
          source_batch_id: batch.id,
        }));
        const { error } = await supabase.from("activity_monthly").upsert(payload, { onConflict: "clinic_id,period_month,financial_class_id" });
        await supabase.from("import_batches").update({
          status: error ? "failed" : "success", finished_at: new Date().toISOString(),
          rows_read: payload.length, rows_accepted: error ? 0 : payload.length, error_detail: error?.message ?? null,
        }).eq("id", batch.id);
        if (error) { setResult({ ok: false, message: `Failed for ${monthName(m)}: ${error.message}` }); setBusy(false); return; }
      }

      if (parsed.patientVisits) {
        const c = overCount(parsed.patientVisits.byFacility, fs);
        const { error } = await supabase.from("patient_visit_counts").upsert({
          clinic_id: cid, year: parsed.patientVisits.year, as_of: parsed.rangeTo,
          patients: c.patients, over_threshold: c.over, threshold: OVER_VISITS, source: "prompt_revenue",
        }, { onConflict: "clinic_id,year" });
        if (error) {
          setResult({ ok: false, message: error.message.includes("patient_visit_counts") ? "Run migration 033 first — the over-25-visits table does not exist yet." : error.message });
          setBusy(false); return;
        }
      }

      await supabase.from("clinic_aliases").upsert(fs.map((f) => ({ normalised: key(f), clinic_id: cid, raw_example: f, source: "prompt" })), { onConflict: "normalised" });
      done.push(cid);
    }
    setBusy(false);
    setResult({
      ok: true,
      message: `Imported ${months.map(monthName).join(", ") || "visit counts"} for ${names.join(", ")}.${parsed.patientVisits ? " Patients-over-25 counts saved." : ""}`,
      clinicIds: done,
    });
  }

  const box = "rounded border border-hairline bg-surface px-2 py-1.5 text-sm";

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold">2 · What the file contains — Visits Revenue Report</h2>
        <p className="mt-1 text-sm text-muted">
          Visits dated {parsed.rangeFrom ?? "?"} to {parsed.rangeTo ?? "?"} · {parsed.facilities.length} facilities ·{" "}
          {int(parsed.totals.appointments)} appointments · {money(parsed.totals.billed)} billed · {money(parsed.totals.paid)} paid so far
        </p>
        {errors.length > 0 && (
          <ul className="mt-2 space-y-1 rounded border border-bad/30 bg-bad/5 p-3 text-sm text-bad">
            {errors.map((e, i) => <li key={i}>✕ {e.message}</li>)}
          </ul>
        )}
        {errors.length === 0 && parsed.summaryTotals && (
          <p className="mt-2 text-xs text-good">✓ The rows add up exactly to Prompt&apos;s own Summary sheet.</p>
        )}
        {warns.map((w, i) => <p key={i} className="mt-1 text-xs text-warn">! {w.message}</p>)}

        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-muted">
              <th className="py-1 text-left font-medium">Facility</th>
              <th className="py-1 text-right font-medium" title="Not cancelled, not a no-show">Visits</th>
              <th className="py-1 text-right font-medium">Cancelled / no-show</th>
              <th className="py-1 text-right font-medium">Evaluations</th>
              <th className="py-1 text-right font-medium">Billed</th>
              <th className="py-1 text-right font-medium">Paid so far</th>
              <th className="py-1 pl-3 text-left font-medium">MBOne client</th>
            </tr>
          </thead>
          <tbody>
            {parsed.facilities.map((f) => {
              const c = parsed.months.map((m) => facilityMonth(parsed, f, m))
                .reduce((a, b) => ({ ...a, visits: a.visits + b.visits, cancelled: a.cancelled + b.cancelled, noShow: a.noShow + b.noShow, evals: a.evals + b.evals, billed: a.billed + b.billed, paid: a.paid + b.paid }),
                  { appointments: 0, visits: 0, cancelled: 0, noShow: 0, evals: 0, billed: 0, paid: 0, patientPaid: 0, insurancePaid: 0 });
              return (
                <tr key={f} className="border-b border-hairline/60">
                  <td className="py-1.5">{f}</td>
                  <td className="tnum py-1.5 text-right">{int(c.visits)}</td>
                  <td className="tnum py-1.5 text-right text-muted">{int(c.cancelled + c.noShow)}</td>
                  <td className="tnum py-1.5 text-right">{int(c.evals)}</td>
                  <td className="tnum py-1.5 text-right">{money(c.billed)}</td>
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
          Visits = appointments that were not cancelled or a no-show (Prompt&apos;s own &quot;Total Visits&quot; counts every
          appointment). Evaluations are counted as new patients. <strong>Paid so far</strong> is what has been paid on
          visits dated in the month — not cash posted in the month — so recent months look low and grow when downloaded again.
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
          {parsed.rangeFrom
            ? "Months to load (only months the date range covers from the 1st to the last day):"
            : "The file name has no dates, so MBOne cannot tell which months are complete. Tick only the months you downloaded from the 1st to the last day:"}
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {parsed.months.map((m) => {
            const known = !!parsed.rangeFrom;
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

        {groups.size > 0 && months.length > 0 && (
          <table className="mt-3 w-full text-sm">
            <thead><tr className="border-b border-hairline text-xs text-muted">
              <th className="py-1 text-left font-medium">Client · month</th><th className="py-1 text-right font-medium">Visits</th>
              <th className="py-1 text-right font-medium">Billed</th><th className="py-1 text-right font-medium">Paid so far</th>
              <th className="py-1 text-right font-medium">Paid / visit</th>
            </tr></thead>
            <tbody>
              {Array.from(groups.entries()).flatMap(([id, fs]) => months.map((m) => {
                const c = sumFor(fs, m);
                return (
                  <tr key={`${id}-${m}`} className="border-b border-hairline/60">
                    <td className="py-1.5">{clinics.find((x) => x.id === id)?.name} · {monthName(m)}</td>
                    <td className="tnum py-1.5 text-right">{int(c.visits)}</td>
                    <td className="tnum py-1.5 text-right">{money(c.billed)}</td>
                    <td className="tnum py-1.5 text-right">{money(c.paid)}</td>
                    <td className="tnum py-1.5 text-right">{c.visits ? money(c.paid / c.visits) : "—"}</td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        )}

        <p className="mt-3 text-xs text-muted">
          {parsed.patientVisits
            ? `✓ This file starts on 1 January, so "patients over ${OVER_VISITS} visits" for ${parsed.patientVisits.year} will be counted too — two numbers per client, no patient details saved.`
            : `For "patients over ${OVER_VISITS} visits", download this report again from 1 January to today. That one file also fills every month of the year.`}
        </p>
        {unmapped.length > 0 && <p className="mt-2 text-xs text-bad">Choose a client for: {unmapped.join(", ")}.</p>}
      </section>

      <div className="flex items-center gap-3">
        <button onClick={commit} disabled={!canImport}
          className="rounded-card bg-accent px-5 py-2 text-sm font-semibold text-white shadow-card hover:bg-accentDeep disabled:opacity-40">
          {busy ? "Importing…" : `Import into ${names.join(", ") || "…"}`}
        </button>
        <span className="text-xs text-muted">Importing the same month again replaces it, it never adds to it.</span>
      </div>

      {result && (
        <div className={`rounded border p-3 text-sm ${result.ok ? "border-good/30 bg-good/5 text-good" : "border-bad/30 bg-bad/5 text-bad"}`}>
          {result.message}
          {result.ok && result.clinicIds?.length === 1 && (
            <> <Link href={`/results?client=${result.clinicIds[0]}`} className="ml-2 underline">Open in Results</Link></>
          )}
        </div>
      )}
    </div>
  );
}
