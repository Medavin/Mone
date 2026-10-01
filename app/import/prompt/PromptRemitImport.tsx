"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { parsePromptRemit, remitFor } from "@/lib/parsePromptRemit";

/**
 * Prompt "Remit Allocation Report" → claim_outcomes_monthly: claims back
 * from payers, denied claims, denial rate and reversals, per client per
 * month of service. No reasons — this report does not carry them.
 */

type Clinic = { id: number; name: string; status: string; billing_system?: string | null };
const key = (f: string) => `prompt:${f.trim().toLowerCase().replace(/\s+/g, " ")}`;
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const monthName = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export default function PromptRemitImport({
  wb, fileName, clinics, aliases,
}: {
  wb: XLSX.WorkBook; fileName: string; clinics: Clinic[]; aliases: { normalised: string; clinic_id: number }[];
}) {
  const parsed = useMemo(() => parsePromptRemit(wb, fileName), [wb, fileName]);
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
  const [result, setResult] = useState<{ ok: boolean; message: string; clinicId?: number } | null>(null);

  const promptFirst = [...clinics.filter((c) => c.status === "active")].sort((a, b) =>
    (a.billing_system === "prompt" ? 0 : 1) - (b.billing_system === "prompt" ? 0 : 1) || a.name.localeCompare(b.name));
  const effective = (f: string) => map[f] || account;
  const unmapped = parsed.facilities.filter((f) => !effective(f));
  const errors = parsed.issues.filter((i) => i.level === "error");
  const groups = new Map<number, string[]>();
  for (const f of parsed.facilities) {
    const id = Number(effective(f));
    if (id) groups.set(id, [...(groups.get(id) ?? []), f]);
  }
  const names = Array.from(groups.keys()).map((id) => clinics.find((c) => c.id === id)?.name ?? "?");
  const known = !!parsed.rangeFrom;
  const canImport = !busy && errors.length === 0 && unmapped.length === 0 && groups.size > 0 && months.length > 0;

  async function commit() {
    setBusy(true);
    setResult(null);
    const supabase = createClient();
    for (const [cid, fs] of Array.from(groups.entries())) {
      for (const m of months) {
        const period = `${m}-01`;
        const x = remitFor(parsed, fs, m);
        const { data: batch, error: be } = await supabase.from("import_batches").insert({
          source_type: "file", source_name: fileName, report_kind: "prompt_remit", clinic_id: cid, period_month: period, status: "running",
        }).select("id").single();
        if (be || !batch) { setResult({ ok: false, message: `Could not start: ${be?.message}` }); setBusy(false); return; }
        const { error } = await supabase.from("claim_outcomes_monthly").upsert({
          clinic_id: cid, period_month: period, claims: x.claims, denied_claims: x.denied,
          denied_amount: Math.round(x.deniedAmount * 100) / 100, reversals: x.reversals,
          paid: Math.round(x.paid * 100) / 100, source: "prompt_remit", source_batch_id: batch.id,
        }, { onConflict: "clinic_id,period_month" });
        await supabase.from("import_batches").update({
          status: error ? "failed" : "success", finished_at: new Date().toISOString(),
          rows_read: 1, rows_accepted: error ? 0 : 1, error_detail: error?.message ?? null,
        }).eq("id", batch.id);
        if (error) {
          setResult({ ok: false, message: error.message.includes("claim_outcomes_monthly") ? "Run migration 035 first — the claim outcomes table does not exist yet." : error.message });
          setBusy(false); return;
        }
      }
      await supabase.from("clinic_aliases").upsert(fs.map((f) => ({ normalised: key(f), clinic_id: cid, raw_example: f, source: "prompt" })), { onConflict: "normalised" });
    }
    setBusy(false);
    setResult({ ok: true, message: `Imported denial rates for ${names.join(", ")}, ${monthName(months[0])} – ${monthName(months[months.length - 1])}.`, clinicId: groups.size === 1 ? Array.from(groups.keys())[0] : undefined });
  }

  const box = "rounded border border-hairline bg-surface px-2 py-1.5 text-sm";
  const all = remitFor(parsed, parsed.facilities, "");

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold">2 · What the file contains — Remit Allocation Report</h2>
        <p className="mt-1 text-sm text-muted">
          Visits dated {parsed.rangeFrom ?? "?"} to {parsed.rangeTo ?? "?"} · {parsed.facilities.length} facilities ·{" "}
          {int(parsed.totals.lines)} remit lines · {int(parsed.totals.claims)} claims · <strong className="text-ink">{int(parsed.totals.denied)} denied ({pct(parsed.totals.denied, parsed.totals.claims)})</strong> ·{" "}
          {int(parsed.totals.reversals)} reversals
        </p>
        {errors.length > 0 && (
          <ul className="mt-2 space-y-1 rounded border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{errors.map((e, i) => <li key={i}>✕ {e.message}</li>)}</ul>
        )}
        <p className="mt-2 rounded border border-warn/30 bg-warn/5 p-2 text-xs text-ink">
          This report gives the denial <strong>rate</strong>, not the <strong>reasons</strong> — Prompt does not include reason codes in it.
          The &quot;Top Denial Reasons&quot; card needs a report with reason codes (try the Adjustments Report).
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-muted">
              <th className="py-1 text-left font-medium">Facility</th>
              <th className="py-1 text-right font-medium">Claims</th>
              <th className="py-1 text-right font-medium">Denied</th>
              <th className="py-1 text-right font-medium">Rate</th>
              <th className="py-1 text-right font-medium">Denied $</th>
              <th className="py-1 pl-3 text-left font-medium">MBOne client</th>
            </tr>
          </thead>
          <tbody>
            {parsed.facilities.map((f) => {
              const t = parsed.months.map((m) => remitFor(parsed, [f], m)).reduce((a, b) => ({ claims: a.claims + b.claims, denied: a.denied + b.denied, deniedAmount: a.deniedAmount + b.deniedAmount, reversals: 0, paid: 0 }), { claims: 0, denied: 0, deniedAmount: 0, reversals: 0, paid: 0 });
              return (
                <tr key={f} className="border-b border-hairline/60">
                  <td className="py-1.5">{f}</td>
                  <td className="tnum py-1.5 text-right">{int(t.claims)}</td>
                  <td className="tnum py-1.5 text-right">{int(t.denied)}</td>
                  <td className="tnum py-1.5 text-right">{pct(t.denied, t.claims)}</td>
                  <td className="tnum py-1.5 text-right">{money(t.deniedAmount)}</td>
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
        <p className="mt-2 text-[11px] text-muted">
          By month of service. The latest months always look better than they are — most of their claims have not come back from the payer yet.
          {all.claims === 0 && ""}
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
        <div className="mt-3 text-xs text-muted">{known ? "Months to load (only months the report covers from the 1st to the last day):" : "The file name has no dates — tick only complete months:"}</div>
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
          {busy ? "Importing…" : `Import into ${names.join(", ") || "…"}`}
        </button>
        <span className="text-xs text-muted">Importing the same month again replaces it, it never adds to it.</span>
      </div>
      {result && (
        <div className={`rounded border p-3 text-sm ${result.ok ? "border-good/30 bg-good/5 text-good" : "border-bad/30 bg-bad/5 text-bad"}`}>
          {result.message}
          {result.ok && result.clinicId && <> <Link href={`/results?client=${result.clinicId}&section=denials`} className="ml-2 underline">Open Denials in Results</Link></>}
        </div>
      )}
    </div>
  );
}
