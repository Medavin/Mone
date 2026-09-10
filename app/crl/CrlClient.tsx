"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TableControls from "@/components/TableControls";
import PhiNotice from "@/components/PhiNotice";
import Missing from "@/components/Missing";

type Entry = {
  id: number;
  entry_date: string;
  clinic_id: number | null;
  sent_to: string;
  cam_id: string | null;
  collector_id: number | null;
  patient_name: string | null;
  chart_no: string | null;
  insurance: string | null;
  issue: string | null;
  amount: number | null;
  status: string;
  resolved_on: string | null;
  note: string | null;
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const SENT_TO = [
  ["cam", "Sent to CAM"],
  ["collector", "Sent to collector"],
  ["client", "Sent to client"],
  ["other", "Other"],
] as const;

const STATUSES = ["open", "in_progress", "resolved", "written_off", "closed"] as const;

const blank = {
  entry_date: new Date().toISOString().slice(0, 10),
  clinic_id: "",
  sent_to: "cam",
  cam_id: "",
  collector_id: "",
  patient_name: "",
  chart_no: "",
  insurance: "",
  issue: "",
  amount: "",
  note: "",
};

/**
 * The CRL — claims that have left the normal queue.
 *
 * Michelle asked to see it by collector, by CAM, by clinic and by date. That
 * is four ways of grouping one list, not four reports, so the views share the
 * same rows and the same filters. Whichever way it is cut, the totals agree —
 * which is the point of doing it this way rather than building four screens
 * that can drift apart.
 */
export default function CrlClient({
  canEdit,
  from,
  to,
  view,
  entries,
  clinics,
  people,
  collectors,
}: {
  canEdit: boolean;
  from: string;
  to: string;
  view: string;
  entries: Entry[];
  clinics: { id: number; name: string }[];
  people: { id: string; full_name: string; role: string }[];
  collectors: { id: number; code: string; display_name: string | null }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const clinicName = useMemo(() => new Map(clinics.map((c) => [c.id, c.name])), [clinics]);
  const camName = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people]);
  const collName = useMemo(
    () => new Map(collectors.map((c) => [c.id, c.display_name || c.code])),
    [collectors]
  );

  const shown = entries.filter((e) => (status ? e.status === status : true));

  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  async function add() {
    if (!form.issue.trim() && !form.patient_name.trim()) {
      setError("Give it at least an issue or a patient, or the row says nothing.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("crl_entries").insert({
      entry_date: form.entry_date,
      clinic_id: form.clinic_id ? Number(form.clinic_id) : null,
      sent_to: form.sent_to,
      cam_id: form.cam_id || null,
      collector_id: form.collector_id ? Number(form.collector_id) : null,
      patient_name: form.patient_name.trim() || null,
      chart_no: form.chart_no.trim() || null,
      insurance: form.insurance.trim() || null,
      issue: form.issue.trim() || null,
      amount: form.amount ? Number(form.amount) : null,
      note: form.note.trim() || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setForm({ ...blank });
    setAdding(false);
    router.refresh();
  }

  async function setStatusOf(id: number, value: string) {
    setBusy(true);
    const patch: Record<string, unknown> = { status: value, updated_at: new Date().toISOString() };
    if (value === "resolved" || value === "closed")
      patch.resolved_on = new Date().toISOString().slice(0, 10);
    const { error: err } = await supabase.from("crl_entries").update(patch).eq("id", id);
    setBusy(false);
    if (err) setError(err.message);
    else router.refresh();
  }

  /** One grouping function for all four views, so the totals cannot disagree. */
  const groupBy = (key: (e: Entry) => string) => {
    const m = new Map<string, { n: number; amount: number; open: number }>();
    for (const e of shown) {
      const k = key(e);
      const g = m.get(k) ?? { n: 0, amount: 0, open: 0 };
      g.n += 1;
      g.amount += e.amount ?? 0;
      if (e.status === "open" || e.status === "in_progress") g.open += 1;
      m.set(k, g);
    }
    return Array.from(m.entries())
      .map(([label, g]) => ({ label, ...g }))
      .sort((a, b) => b.amount - a.amount);
  };

  const grouped =
    view === "collector"
      ? groupBy((e) => (e.collector_id ? collName.get(e.collector_id) ?? "—" : "no collector"))
      : view === "cam"
        ? groupBy((e) => (e.cam_id ? camName.get(e.cam_id) ?? "—" : "no CAM"))
        : view === "clinic"
          ? groupBy((e) => (e.clinic_id ? clinicName.get(e.clinic_id) ?? "—" : "no clinic"))
          : view === "date"
            ? groupBy((e) => e.entry_date)
            : [];

  const total = shown.reduce((t, e) => t + (e.amount ?? 0), 0);
  const open = shown.filter((e) => e.status === "open" || e.status === "in_progress").length;

  const field =
    "w-full rounded border border-hairline bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";
  const thR = "py-2 text-right font-mono text-[11px] uppercase tracking-wider text-muted";

  const link = (v: string) => `/crl?from=${from}&to=${to}&view=${v}`;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">CRL</h1>
          <p className="mt-1 text-sm text-muted">
            Claims sent out to a CAM or a collector, and what happened to them.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <form method="get" className="flex items-end gap-2">
            <input type="hidden" name="view" value={view} />
            <label className="block">
              <span className="eyebrow">From</span>
              <input type="date" name="from" defaultValue={from} className={`${field} mt-1`} />
            </label>
            <label className="block">
              <span className="eyebrow">To</span>
              <input type="date" name="to" defaultValue={to} className={`${field} mt-1`} />
            </label>
            <button className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-canvas">
              Show
            </button>
          </form>
          {canEdit && (
            <button
              onClick={() => setAdding((v) => !v)}
              className="rounded bg-accent px-3 py-1.5 text-sm text-white"
            >
              {adding ? "Cancel" : "+ Add"}
            </button>
          )}
        </div>
      </div>

      <PhiNotice />

      {error && (
        <p className="mt-4 rounded-card border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {adding && canEdit && (
        <div className="mt-5 rounded-card border border-hairline bg-surface p-5 shadow-card">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="eyebrow">Date</span>
              <input type="date" value={form.entry_date} onChange={(e) => set("entry_date", e.target.value)} className={`${field} mt-1`} />
            </label>
            <label className="block">
              <span className="eyebrow">Clinic</span>
              <select value={form.clinic_id} onChange={(e) => set("clinic_id", e.target.value)} className={`${field} mt-1`}>
                <option value="">—</option>
                {clinics.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="eyebrow">Sent to</span>
              <select value={form.sent_to} onChange={(e) => set("sent_to", e.target.value)} className={`${field} mt-1`}>
                {SENT_TO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="eyebrow">{form.sent_to === "collector" ? "Collector" : "CAM"}</span>
              {form.sent_to === "collector" ? (
                <select value={form.collector_id} onChange={(e) => set("collector_id", e.target.value)} className={`${field} mt-1`}>
                  <option value="">—</option>
                  {collectors.map((c) => <option key={c.id} value={String(c.id)}>{c.display_name || c.code}</option>)}
                </select>
              ) : (
                <select value={form.cam_id} onChange={(e) => set("cam_id", e.target.value)} className={`${field} mt-1`}>
                  <option value="">—</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              )}
            </label>

            <label className="block">
              <span className="eyebrow">Patient</span>
              <input value={form.patient_name} onChange={(e) => set("patient_name", e.target.value)} placeholder="test data only" className={`${field} mt-1`} />
            </label>
            <label className="block">
              <span className="eyebrow">Chart no.</span>
              <input value={form.chart_no} onChange={(e) => set("chart_no", e.target.value)} className={`${field} mt-1`} />
            </label>
            <label className="block">
              <span className="eyebrow">Insurance</span>
              <input value={form.insurance} onChange={(e) => set("insurance", e.target.value)} className={`${field} mt-1`} />
            </label>
            <label className="block">
              <span className="eyebrow">Amount</span>
              <input type="number" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} className={`${field} mt-1`} />
            </label>

            <label className="block sm:col-span-2">
              <span className="eyebrow">Issue</span>
              <input value={form.issue} onChange={(e) => set("issue", e.target.value)} placeholder="What is wrong with it" className={`${field} mt-1`} />
            </label>
            <label className="block sm:col-span-2">
              <span className="eyebrow">Note</span>
              <input value={form.note} onChange={(e) => set("note", e.target.value)} className={`${field} mt-1`} />
            </label>
          </div>
          <button onClick={add} disabled={busy} className="mt-4 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">
            {busy ? "Saving…" : "Add entry"}
          </button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Entries", String(shown.length)],
          ["Still open", String(open)],
          ["Value", money(total)],
          ["Clinics", String(new Set(shown.map((e) => e.clinic_id)).size)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-card border border-hairline bg-surface px-4 py-3 shadow-card">
            <div className="eyebrow">{l}</div>
            <div className="tnum mt-1 text-lg font-medium">{v}</div>
          </div>
        ))}
      </div>

      <nav className="mt-8 flex flex-wrap gap-1 border-b border-hairline print:hidden">
        {[["list", "Every entry"], ["collector", "By collector"], ["cam", "By CAM"], ["clinic", "By clinic"], ["date", "By date"]].map(
          ([k, label]) => (
            <Link
              key={k}
              href={link(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                view === k ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {label}
            </Link>
          )
        )}
        <span className="flex-1" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="mb-1 rounded border border-hairline px-2 py-1 text-xs">
          <option value="">Every status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </nav>

      {shown.length === 0 ? (
        <div className="mt-8">
          <Missing needs="Nothing in the CRL for this period. Entries arrive with the AdvancedMD feed, or can be added by hand above." />
        </div>
      ) : view === "list" ? (
        <section className="mt-4">
          <TableControls
            title={`CRL ${from} to ${to}`}
            rows={shown}
            columns={[
              { header: "Date", value: (e) => e.entry_date },
              { header: "Clinic", value: (e) => (e.clinic_id ? clinicName.get(e.clinic_id) ?? "" : "") },
              { header: "Sent to", value: (e) => e.sent_to },
              { header: "CAM", value: (e) => (e.cam_id ? camName.get(e.cam_id) ?? "" : "") },
              { header: "Collector", value: (e) => (e.collector_id ? collName.get(e.collector_id) ?? "" : "") },
              { header: "Patient", value: (e) => e.patient_name ?? "" },
              { header: "Chart", value: (e) => e.chart_no ?? "" },
              { header: "Insurance", value: (e) => e.insurance ?? "" },
              { header: "Issue", value: (e) => e.issue ?? "" },
              { header: "Amount", value: (e) => e.amount ?? "" },
              { header: "Status", value: (e) => e.status },
            ]}
          />
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thL}>Date</th>
                <th className={thL}>Clinic</th>
                <th className={thL}>Sent to</th>
                <th className={thL}>Patient / issue</th>
                <th className={thR}>Amount</th>
                <th className={thL}>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className="border-b border-hairline/60 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{e.entry_date}</td>
                  <td className="py-2 pr-3">{e.clinic_id ? clinicName.get(e.clinic_id) : "—"}</td>
                  <td className="py-2 pr-3 text-xs">
                    {SENT_TO.find(([v]) => v === e.sent_to)?.[1] ?? e.sent_to}
                    <div className="text-muted">
                      {e.collector_id ? collName.get(e.collector_id) : e.cam_id ? camName.get(e.cam_id) : ""}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    {e.patient_name ?? <span className="text-muted">no name</span>}
                    <div className="text-xs text-muted">
                      {[e.insurance, e.issue].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="tnum py-2 text-right">{e.amount ? money(e.amount) : "—"}</td>
                  <td className="py-2">
                    {canEdit ? (
                      <select
                        value={e.status}
                        disabled={busy}
                        onChange={(ev) => setStatusOf(e.id, ev.target.value)}
                        className="rounded border border-hairline px-1.5 py-1 text-xs"
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs">{e.status.replace("_", " ")}</span>
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
            title={`CRL by ${view} ${from} to ${to}`}
            rows={grouped}
            columns={[
              { header: view === "date" ? "Date" : view, value: (g) => g.label },
              { header: "Entries", value: (g) => g.n },
              { header: "Still open", value: (g) => g.open },
              { header: "Value", value: (g) => g.amount },
            ]}
          />
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thL}>{view === "date" ? "Date" : view === "cam" ? "CAM" : view === "collector" ? "Collector" : "Clinic"}</th>
                <th className={thR}>Entries</th>
                <th className={thR}>Still open</th>
                <th className={thR}>Value</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <tr key={g.label} className="border-b border-hairline/60">
                  <td className="py-2">{g.label}</td>
                  <td className="tnum py-2 text-right">{g.n}</td>
                  <td className={`tnum py-2 text-right ${g.open ? "text-warn" : "text-muted"}`}>{g.open}</td>
                  <td className="tnum py-2 text-right font-medium">{money(g.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">
            Every view is the same entries counted a different way, so the totals agree whichever way
            you cut them.
          </p>
        </section>
      )}
    </div>
  );
}
