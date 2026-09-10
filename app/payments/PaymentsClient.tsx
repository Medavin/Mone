"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TableControls from "@/components/TableControls";
import PhiNotice from "@/components/PhiNotice";
import Missing from "@/components/Missing";

type Payment = {
  id: number;
  reported_on: string;
  clinic_id: number | null;
  cam_id: string | null;
  method: string;
  amount: number;
  reference: string | null;
  payer: string | null;
  status: string;
  applied_on: string | null;
  applied_amount: number | null;
  patient_name: string | null;
  note: string | null;
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const METHODS = [
  ["check", "Paper cheque"],
  ["eft", "EFT"],
  ["era", "ERA"],
  ["ehr", "EHR"],
  ["card", "Card"],
  ["cash", "Cash"],
  ["other", "Other"],
] as const;

const STATUSES = ["pending", "applied", "partial", "rejected", "returned"] as const;

const blank = {
  reported_on: new Date().toISOString().slice(0, 10),
  clinic_id: "",
  cam_id: "",
  method: "check",
  amount: "",
  reference: "",
  payer: "",
  patient_name: "",
  note: "",
};

/**
 * Reported payments against applied payments.
 *
 * The gap between the two is the whole reason this screen exists. A cheque a
 * clinic reports on Monday and that is applied on Friday is money that exists
 * but is not yet in the A/R figures — and somebody is asked about it every
 * week. Showing the reported total, the applied total and the difference makes
 * that question answerable in one look instead of a chase.
 */
export default function PaymentsClient({
  canEdit,
  from,
  to,
  view,
  payments,
  clinics,
  people,
}: {
  canEdit: boolean;
  from: string;
  to: string;
  view: string;
  payments: Payment[];
  clinics: { id: number; name: string }[];
  people: { id: string; full_name: string; role: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyFor, setApplyFor] = useState<number | null>(null);
  const [applyAmt, setApplyAmt] = useState("");

  const clinicName = useMemo(() => new Map(clinics.map((c) => [c.id, c.name])), [clinics]);
  const camName = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people]);

  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  const reported = payments.reduce((t, p) => t + p.amount, 0);
  const applied = payments.reduce((t, p) => t + (p.applied_amount ?? 0), 0);
  const pending = payments.filter((p) => p.status === "pending");
  const pendingValue = pending.reduce((t, p) => t + p.amount, 0);

  async function add() {
    if (!form.amount) return setError("A payment needs an amount.");
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("reported_payments").insert({
      reported_on: form.reported_on,
      clinic_id: form.clinic_id ? Number(form.clinic_id) : null,
      cam_id: form.cam_id || null,
      method: form.method,
      amount: Number(form.amount),
      reference: form.reference.trim() || null,
      payer: form.payer.trim() || null,
      patient_name: form.patient_name.trim() || null,
      note: form.note.trim() || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setForm({ ...blank });
    setAdding(false);
    router.refresh();
  }

  /** Marking applied requires the amount — the database refuses it otherwise,
   *  because "applied" with no figure makes a reconciliation meaningless. */
  async function markApplied(p: Payment) {
    const amt = Number(applyAmt || p.amount);
    if (!Number.isFinite(amt)) return setError("That is not an amount.");
    setBusy(true);
    const { error: err } = await supabase
      .from("reported_payments")
      .update({
        status: amt < p.amount ? "partial" : "applied",
        applied_on: new Date().toISOString().slice(0, 10),
        applied_amount: amt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", p.id);
    setBusy(false);
    setApplyFor(null);
    setApplyAmt("");
    if (err) setError(err.message);
    else router.refresh();
  }

  const groupBy = (key: (p: Payment) => string) => {
    const m = new Map<string, { n: number; reported: number; applied: number }>();
    for (const p of payments) {
      const k = key(p);
      const g = m.get(k) ?? { n: 0, reported: 0, applied: 0 };
      g.n += 1;
      g.reported += p.amount;
      g.applied += p.applied_amount ?? 0;
      m.set(k, g);
    }
    return Array.from(m.entries())
      .map(([label, g]) => ({ label, ...g, gap: g.reported - g.applied }))
      .sort((a, b) => b.reported - a.reported);
  };

  const grouped =
    view === "clinic"
      ? groupBy((p) => (p.clinic_id ? clinicName.get(p.clinic_id) ?? "—" : "no clinic"))
      : view === "cam"
        ? groupBy((p) => (p.cam_id ? camName.get(p.cam_id) ?? "—" : "no CAM"))
        : view === "method"
          ? groupBy((p) => METHODS.find(([v]) => v === p.method)?.[1] ?? p.method)
          : [];

  const field =
    "w-full rounded border border-hairline bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";
  const thR = "py-2 text-right font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
          <p className="mt-1 text-sm text-muted">
            What was reported, what has been applied, and the difference.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <form method="get" className="flex items-end gap-2">
            <input type="hidden" name="view" value={view} />
            <label className="block"><span className="eyebrow">From</span>
              <input type="date" name="from" defaultValue={from} className={`${field} mt-1`} /></label>
            <label className="block"><span className="eyebrow">To</span>
              <input type="date" name="to" defaultValue={to} className={`${field} mt-1`} /></label>
            <button className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-canvas">Show</button>
          </form>
          {canEdit && (
            <button onClick={() => setAdding((v) => !v)} className="rounded bg-accent px-3 py-1.5 text-sm text-white">
              {adding ? "Cancel" : "+ Add"}
            </button>
          )}
        </div>
      </div>

      <PhiNotice />

      {error && (
        <p className="mt-4 rounded-card border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</p>
      )}

      {adding && canEdit && (
        <div className="mt-5 rounded-card border border-hairline bg-surface p-5 shadow-card">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block"><span className="eyebrow">Reported on</span>
              <input type="date" value={form.reported_on} onChange={(e) => set("reported_on", e.target.value)} className={`${field} mt-1`} /></label>
            <label className="block"><span className="eyebrow">Clinic</span>
              <select value={form.clinic_id} onChange={(e) => set("clinic_id", e.target.value)} className={`${field} mt-1`}>
                <option value="">—</option>
                {clinics.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select></label>
            <label className="block"><span className="eyebrow">CAM</span>
              <select value={form.cam_id} onChange={(e) => set("cam_id", e.target.value)} className={`${field} mt-1`}>
                <option value="">—</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select></label>
            <label className="block"><span className="eyebrow">Method</span>
              <select value={form.method} onChange={(e) => set("method", e.target.value)} className={`${field} mt-1`}>
                {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>

            <label className="block"><span className="eyebrow">Amount</span>
              <input type="number" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} className={`${field} mt-1`} /></label>
            <label className="block"><span className="eyebrow">Reference</span>
              <input value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder="cheque or trace no." className={`${field} mt-1`} /></label>
            <label className="block"><span className="eyebrow">Payer</span>
              <input value={form.payer} onChange={(e) => set("payer", e.target.value)} className={`${field} mt-1`} /></label>
            <label className="block"><span className="eyebrow">Patient (rarely needed)</span>
              <input value={form.patient_name} onChange={(e) => set("patient_name", e.target.value)} className={`${field} mt-1`} /></label>

            <label className="block sm:col-span-4"><span className="eyebrow">Note</span>
              <input value={form.note} onChange={(e) => set("note", e.target.value)} className={`${field} mt-1`} /></label>
          </div>
          <button onClick={add} disabled={busy} className="mt-4 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">
            {busy ? "Saving…" : "Add payment"}
          </button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Reported", money(reported), ""],
          ["Applied", money(applied), ""],
          ["Not yet applied", money(reported - applied), `${pending.length} pending`],
          ["Pending value", money(pendingValue), ""],
        ].map(([l, v, n], i) => (
          <div key={l} className={`rounded-card border border-hairline bg-surface px-4 py-3 shadow-card ${i === 2 && reported - applied > 0 ? "border-l-4 border-l-warn" : ""}`}>
            <div className="eyebrow">{l}</div>
            <div className="tnum mt-1 text-lg font-medium">{v}</div>
            {n && <div className="mt-0.5 text-xs text-muted">{n}</div>}
          </div>
        ))}
      </div>

      <p className="mt-3 text-sm text-muted">
        Money reported but not yet applied exists, but is not in the A/R figures yet. That gap is
        the number worth watching — it is what a clinic is asking about when they say a payment is
        missing.
      </p>

      <nav className="mt-8 flex flex-wrap gap-1 border-b border-hairline print:hidden">
        {[["list", "Every payment"], ["clinic", "By clinic"], ["cam", "By CAM"], ["method", "By method"]].map(([k, label]) => (
          <Link key={k} href={`/payments?from=${from}&to=${to}&view=${k}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${view === k ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {label}
          </Link>
        ))}
      </nav>

      {payments.length === 0 ? (
        <div className="mt-8">
          <Missing needs="No payments reported in this period. These arrive with the AdvancedMD feed, or can be entered by hand above." />
        </div>
      ) : view === "list" ? (
        <section className="mt-4">
          <TableControls
            title={`Payments ${from} to ${to}`}
            rows={payments}
            columns={[
              { header: "Reported", value: (p) => p.reported_on },
              { header: "Clinic", value: (p) => (p.clinic_id ? clinicName.get(p.clinic_id) ?? "" : "") },
              { header: "CAM", value: (p) => (p.cam_id ? camName.get(p.cam_id) ?? "" : "") },
              { header: "Method", value: (p) => p.method },
              { header: "Reference", value: (p) => p.reference ?? "" },
              { header: "Payer", value: (p) => p.payer ?? "" },
              { header: "Amount", value: (p) => p.amount },
              { header: "Status", value: (p) => p.status },
              { header: "Applied on", value: (p) => p.applied_on ?? "" },
              { header: "Applied amount", value: (p) => p.applied_amount ?? "" },
            ]}
          />
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thL}>Reported</th>
                <th className={thL}>Clinic</th>
                <th className={thL}>Method / ref</th>
                <th className={thR}>Amount</th>
                <th className={thR}>Applied</th>
                <th className={thL}>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-hairline/60 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{p.reported_on}</td>
                  <td className="py-2 pr-3">{p.clinic_id ? clinicName.get(p.clinic_id) : "—"}</td>
                  <td className="py-2 pr-3 text-xs">
                    {METHODS.find(([v]) => v === p.method)?.[1] ?? p.method}
                    <div className="text-muted">{[p.reference, p.payer].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="tnum py-2 text-right">{money(p.amount)}</td>
                  <td className="tnum py-2 text-right">
                    {p.applied_amount !== null ? money(p.applied_amount) : <span className="text-muted">—</span>}
                    {p.applied_on && <div className="text-xs text-muted">{p.applied_on}</div>}
                  </td>
                  <td className="py-2">
                    {p.status === "pending" && canEdit ? (
                      applyFor === p.id ? (
                        <span className="inline-flex items-center gap-1">
                          <input type="number" step="0.01" value={applyAmt} placeholder={String(p.amount)}
                            onChange={(e) => setApplyAmt(e.target.value)}
                            className="w-24 rounded border border-hairline px-1.5 py-1 text-xs" />
                          <button onClick={() => markApplied(p)} disabled={busy} className="rounded bg-accent px-2 py-1 text-xs text-white">Save</button>
                          <button onClick={() => setApplyFor(null)} className="text-xs text-muted underline">Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => { setApplyFor(p.id); setApplyAmt(""); }}
                          className="rounded border border-hairline px-2 py-1 text-xs text-muted hover:text-ink">
                          Mark applied
                        </button>
                      )
                    ) : (
                      <span className={`text-xs ${p.status === "applied" ? "text-good" : p.status === "partial" ? "text-warn" : "text-muted"}`}>
                        {p.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="mt-4">
          <TableControls
            title={`Payments by ${view} ${from} to ${to}`}
            rows={grouped}
            columns={[
              { header: view, value: (g) => g.label },
              { header: "Payments", value: (g) => g.n },
              { header: "Reported", value: (g) => g.reported },
              { header: "Applied", value: (g) => g.applied },
              { header: "Not yet applied", value: (g) => g.gap },
            ]}
          />
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thL}>{view === "cam" ? "CAM" : view === "method" ? "Method" : "Clinic"}</th>
                <th className={thR}>Payments</th>
                <th className={thR}>Reported</th>
                <th className={thR}>Applied</th>
                <th className={thR}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <tr key={g.label} className="border-b border-hairline/60">
                  <td className="py-2">{g.label}</td>
                  <td className="tnum py-2 text-right">{g.n}</td>
                  <td className="tnum py-2 text-right">{money(g.reported)}</td>
                  <td className="tnum py-2 text-right">{money(g.applied)}</td>
                  <td className={`tnum py-2 text-right font-medium ${g.gap > 0 ? "text-warn" : "text-muted"}`}>
                    {money(g.gap)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
