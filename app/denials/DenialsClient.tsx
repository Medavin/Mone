"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TableControls from "@/components/TableControls";
import PhiNotice from "@/components/PhiNotice";
import Missing from "@/components/Missing";

type Denial = {
  id: number;
  denial_date: string;
  period_month: string | null;
  clinic_id: number | null;
  cam_id: string | null;
  denial_code: string | null;
  denial_type: string | null;
  carrier: string | null;
  patient_name: string | null;
  chart_no: string | null;
  amount: number | null;
  claim_no: string | null;
  status: string;
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const STATUSES = ["open", "appealed", "corrected", "paid", "written_off", "closed"] as const;

const blank = {
  denial_date: new Date().toISOString().slice(0, 10),
  clinic_id: "",
  cam_id: "",
  denial_code: "",
  denial_type: "",
  carrier: "",
  patient_name: "",
  chart_no: "",
  amount: "",
  claim_no: "",
};

/**
 * Denials, from AdvancedMD's Denial Module.
 *
 * Michelle's top request was a denial category summary per client per month.
 * That is the default view here — not the list of individual denials, which is
 * what most systems show first. A list of four hundred denials tells you
 * nothing; the same four hundred grouped by code, with a total against each,
 * tells you which conversation to have with which clinic.
 */
export default function DenialsClient({
  canEdit,
  from,
  to,
  view,
  denials,
  clinics,
  people,
  codes,
}: {
  canEdit: boolean;
  from: string;
  to: string;
  view: string;
  denials: Denial[];
  clinics: { id: number; name: string }[];
  people: { id: string; full_name: string; role: string }[];
  codes: { code: string; label: string; category: string | null; preventable: boolean | null }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clinicFilter, setClinicFilter] = useState("");

  const clinicName = useMemo(() => new Map(clinics.map((c) => [c.id, c.name])), [clinics]);
  const camName = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people]);
  const codeMeta = useMemo(() => new Map(codes.map((c) => [c.code, c])), [codes]);

  const shown = denials.filter((d) =>
    clinicFilter ? String(d.clinic_id ?? "") === clinicFilter : true
  );

  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  async function add() {
    if (!form.denial_code.trim()) return setError("A denial needs a code.");
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("denials").insert({
      denial_date: form.denial_date,
      period_month: `${form.denial_date.slice(0, 7)}-01`,
      clinic_id: form.clinic_id ? Number(form.clinic_id) : null,
      cam_id: form.cam_id || null,
      denial_code: form.denial_code.trim(),
      denial_type: form.denial_type.trim() || null,
      carrier: form.carrier.trim() || null,
      patient_name: form.patient_name.trim() || null,
      chart_no: form.chart_no.trim() || null,
      amount: form.amount ? Number(form.amount) : null,
      claim_no: form.claim_no.trim() || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setForm({ ...blank });
    setAdding(false);
    router.refresh();
  }

  const groupBy = (key: (d: Denial) => string) => {
    const m = new Map<string, { n: number; amount: number; open: number }>();
    for (const d of shown) {
      const k = key(d);
      const g = m.get(k) ?? { n: 0, amount: 0, open: 0 };
      g.n += 1;
      g.amount += d.amount ?? 0;
      if (d.status === "open" || d.status === "appealed") g.open += 1;
      m.set(k, g);
    }
    return Array.from(m.entries()).map(([label, g]) => ({ label, ...g })).sort((a, b) => b.amount - a.amount);
  };

  const grouped =
    view === "code"
      ? groupBy((d) => d.denial_code ?? "no code")
      : view === "clinic"
        ? groupBy((d) => (d.clinic_id ? clinicName.get(d.clinic_id) ?? "—" : "no clinic"))
        : view === "cam"
          ? groupBy((d) => (d.cam_id ? camName.get(d.cam_id) ?? "—" : "no CAM"))
          : view === "month"
            ? groupBy((d) => (d.period_month ?? d.denial_date).slice(0, 7))
            : view === "carrier"
              ? groupBy((d) => d.carrier ?? "no carrier")
              : [];

  const total = shown.reduce((t, d) => t + (d.amount ?? 0), 0);
  const biggest = grouped[0]?.amount ?? 0;
  const preventable = shown.filter((d) => d.denial_code && codeMeta.get(d.denial_code)?.preventable);
  const preventableValue = preventable.reduce((t, d) => t + (d.amount ?? 0), 0);

  const field =
    "w-full rounded border border-hairline bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";
  const thR = "py-2 text-right font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Denials</h1>
          <p className="mt-1 text-sm text-muted">
            What is being denied, by whom, and what it is worth.
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
            <label className="block"><span className="eyebrow">Date</span>
              <input type="date" value={form.denial_date} onChange={(e) => set("denial_date", e.target.value)} className={`${field} mt-1`} /></label>
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
            <label className="block"><span className="eyebrow">Carrier</span>
              <input value={form.carrier} onChange={(e) => set("carrier", e.target.value)} className={`${field} mt-1`} /></label>

            <label className="block"><span className="eyebrow">Denial code</span>
              <input list="dcodes" value={form.denial_code} onChange={(e) => set("denial_code", e.target.value)} className={`${field} mt-1`} />
              <datalist id="dcodes">{codes.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</datalist>
            </label>
            <label className="block"><span className="eyebrow">Type</span>
              <input value={form.denial_type} onChange={(e) => set("denial_type", e.target.value)} className={`${field} mt-1`} /></label>
            <label className="block"><span className="eyebrow">Amount</span>
              <input type="number" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} className={`${field} mt-1`} /></label>
            <label className="block"><span className="eyebrow">Claim no.</span>
              <input value={form.claim_no} onChange={(e) => set("claim_no", e.target.value)} className={`${field} mt-1`} /></label>

            <label className="block sm:col-span-2"><span className="eyebrow">Patient (test data only)</span>
              <input value={form.patient_name} onChange={(e) => set("patient_name", e.target.value)} className={`${field} mt-1`} /></label>
            <label className="block sm:col-span-2"><span className="eyebrow">Chart no.</span>
              <input value={form.chart_no} onChange={(e) => set("chart_no", e.target.value)} className={`${field} mt-1`} /></label>
          </div>
          <button onClick={add} disabled={busy} className="mt-4 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">
            {busy ? "Saving…" : "Add denial"}
          </button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Denials", String(shown.length)],
          ["Value", money(total)],
          ["Distinct codes", String(new Set(shown.map((d) => d.denial_code)).size)],
          ["Preventable", preventable.length ? money(preventableValue) : "—"],
        ].map(([l, v]) => (
          <div key={l} className="rounded-card border border-hairline bg-surface px-4 py-3 shadow-card">
            <div className="eyebrow">{l}</div>
            <div className="tnum mt-1 text-lg font-medium">{v}</div>
          </div>
        ))}
      </div>

      {preventable.length > 0 && (
        <p className="mt-3 text-sm text-warn">
          {money(preventableValue)} of this is against codes marked preventable — denials that a
          change at the front desk would have stopped happening. That is the number worth taking to
          a clinic.
        </p>
      )}

      <nav className="mt-8 flex flex-wrap items-end gap-1 border-b border-hairline print:hidden">
        {[["code", "By code"], ["clinic", "By clinic"], ["cam", "By CAM"], ["carrier", "By carrier"], ["month", "By month"], ["list", "Every denial"]].map(([k, label]) => (
          <Link key={k} href={`/denials?from=${from}&to=${to}&view=${k}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${view === k ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {label}
          </Link>
        ))}
        <span className="flex-1" />
        <select value={clinicFilter} onChange={(e) => setClinicFilter(e.target.value)} className="mb-1 rounded border border-hairline px-2 py-1 text-xs">
          <option value="">Every clinic</option>
          {clinics.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </select>
      </nav>

      {shown.length === 0 ? (
        <div className="mt-8">
          <Missing needs="No denials in this period. These come from AdvancedMD's Denial Module once the feed is connected, or can be entered by hand above." />
        </div>
      ) : view === "list" ? (
        <section className="mt-4">
          <TableControls
            title={`Denials ${from} to ${to}`}
            rows={shown}
            columns={[
              { header: "Date", value: (d) => d.denial_date },
              { header: "Clinic", value: (d) => (d.clinic_id ? clinicName.get(d.clinic_id) ?? "" : "") },
              { header: "CAM", value: (d) => (d.cam_id ? camName.get(d.cam_id) ?? "" : "") },
              { header: "Code", value: (d) => d.denial_code ?? "" },
              { header: "Type", value: (d) => d.denial_type ?? "" },
              { header: "Carrier", value: (d) => d.carrier ?? "" },
              { header: "Patient", value: (d) => d.patient_name ?? "" },
              { header: "Amount", value: (d) => d.amount ?? "" },
              { header: "Claim", value: (d) => d.claim_no ?? "" },
              { header: "Status", value: (d) => d.status },
            ]}
          />
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thL}>Date</th>
                <th className={thL}>Clinic</th>
                <th className={thL}>Code</th>
                <th className={thL}>Patient / carrier</th>
                <th className={thR}>Amount</th>
                <th className={thL}>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id} className="border-b border-hairline/60 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{d.denial_date}</td>
                  <td className="py-2 pr-3">{d.clinic_id ? clinicName.get(d.clinic_id) : "—"}</td>
                  <td className="py-2 pr-3">
                    <span className="font-medium">{d.denial_code ?? "—"}</span>
                    <div className="text-xs text-muted">
                      {d.denial_type ?? codeMeta.get(d.denial_code ?? "")?.label ?? ""}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    {d.patient_name ?? <span className="text-muted">no name</span>}
                    <div className="text-xs text-muted">{d.carrier}</div>
                  </td>
                  <td className="tnum py-2 text-right">{d.amount ? money(d.amount) : "—"}</td>
                  <td className="py-2 text-xs">{d.status.replace("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="mt-4">
          <TableControls
            title={`Denials by ${view} ${from} to ${to}`}
            rows={grouped}
            columns={[
              { header: view, value: (g) => g.label },
              { header: "Denials", value: (g) => g.n },
              { header: "Still open", value: (g) => g.open },
              { header: "Value", value: (g) => g.amount },
              { header: "Share %", value: (g) => (total ? Math.round((g.amount / total) * 1000) / 10 : 0) },
            ]}
          />
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thL}>{view === "code" ? "Denial code" : view === "cam" ? "CAM" : view === "carrier" ? "Carrier" : view === "month" ? "Month" : "Clinic"}</th>
                <th className={thR}>Denials</th>
                <th className={thR}>Open</th>
                <th className={thR}>Value</th>
                <th className={thL} />
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => {
                const meta = view === "code" ? codeMeta.get(g.label) : undefined;
                return (
                  <tr key={g.label} className="border-b border-hairline/60">
                    <td className="py-2">
                      {g.label}
                      {meta && <div className="text-xs text-muted">{meta.label}{meta.preventable ? " · preventable" : ""}</div>}
                    </td>
                    <td className="tnum py-2 text-right">{g.n}</td>
                    <td className={`tnum py-2 text-right ${g.open ? "text-warn" : "text-muted"}`}>{g.open}</td>
                    <td className="tnum py-2 text-right font-medium">{money(g.amount)}</td>
                    <td className="w-1/3 py-2 pl-4">
                      <div className="h-2 rounded bg-canvas">
                        <div className="h-2 rounded bg-age120/60" style={{ width: `${biggest ? (g.amount / biggest) * 100 : 0}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">
            Codes are grouped as the payer sent them. Marking a code preventable, under Settings,
            is what turns this from a list of problems into a list of fixable ones.
          </p>
        </section>
      )}
    </div>
  );
}
