"use client";

import { useMemo, useState } from "react";

/**
 * Generating the monthly packs — any clinics, any period.
 *
 * This is the screen that removes the fifteen working days a month. Everything
 * it produces comes from figures already in MBOne, so the work is choosing who
 * and when, not assembling anything.
 */
export default function PacksClient({
  clinics,
  months,
}: {
  clinics: { id: number; name: string; status: string }[];
  months: string[];
}) {
  const active = useMemo(() => clinics.filter((c) => c.status === "active"), [clinics]);
  const latest = months[months.length - 1] ?? "";

  const [picked, setPicked] = useState<number[]>([]);
  const [from, setFrom] = useState(latest);
  const [to, setTo] = useState(latest);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; lines: string[] } | null>(null);

  const label = (m: string) =>
    m ? new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";

  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function generate() {
    if (picked.length === 0 || !from || !to) return;
    setBusy(true);
    setNote(null);

    try {
      const res = await fetch("/api/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicIds: picked, from, to }),
      });

      if (!res.ok) {
        setNote({ ok: false, lines: [(await res.text()).slice(0, 600)] });
        setBusy(false);
        return;
      }

      const skipped = decodeURIComponent(res.headers.get("X-Pack-Skipped") ?? "");
      const warnings = decodeURIComponent(res.headers.get("X-Pack-Warnings") ?? "");
      const built = res.headers.get("X-Pack-Built") ?? "0";

      const blob = await res.blob();
      const name =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "packs.zip";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      const lines = [`${built} pack${built === "1" ? "" : "s"} generated — ${name}`];
      if (skipped) lines.push(...skipped.split(" | ").map((s) => `Skipped: ${s}`));
      if (warnings) lines.push(...warnings.split(" | ").map((s) => `Note: ${s}`));
      setNote({ ok: true, lines });
    } catch (e) {
      setNote({ ok: false, lines: [e instanceof Error ? e.message : String(e)] });
    }
    setBusy(false);
  }

  const field =
    "rounded border border-hairline bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <div>
      <div className="border-b border-hairline pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Monthly packs</h1>
        <p className="mt-1 text-sm text-muted">
          The nine-sheet workbook, generated from the figures already in MBOne. Any clinics, any
          period.
        </p>
      </div>

      {months.length === 0 ? (
        <p className="mt-8 rounded-card border border-dashed border-hairline bg-surface p-10 text-center text-sm text-muted">
          Nothing has been imported yet, so there is nothing to generate from.
        </p>
      ) : (
        <>
          {/* period */}
          <section className="mt-6">
            <h2 className="eyebrow">Period</h2>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="eyebrow">From</span>
                <select value={from} onChange={(e) => setFrom(e.target.value)} className={`${field} mt-1`}>
                  {months.map((m) => <option key={m} value={m}>{label(m)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="eyebrow">To</span>
                <select value={to} onChange={(e) => setTo(e.target.value)} className={`${field} mt-1`}>
                  {months.map((m) => <option key={m} value={m}>{label(m)}</option>)}
                </select>
              </label>
              <button
                onClick={() => { setFrom(latest); setTo(latest); }}
                className="rounded border border-hairline px-3 py-1.5 text-sm text-muted hover:text-ink"
              >
                Latest month
              </button>
            </div>

            {from !== to && (
              <div className="mt-3 rounded-card border border-accent/30 bg-accentSoft px-4 py-3 text-sm">
                <strong>Across a period, flows add up and balances do not.</strong> Charges,
                payments, adjustments and visits are summed across the months. A/R, the aging
                buckets and the patient-balance counts are taken from{" "}
                <strong>{label(to)}</strong>, because a balance is what was outstanding at a moment
                — adding two months of it together would produce a number that means nothing and
                looks plausible.
              </div>
            )}
          </section>

          {/* clinics */}
          <section className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="eyebrow">Clinics</h2>
              <div className="flex gap-3 text-xs">
                <button onClick={() => setPicked(active.map((c) => c.id))} className="text-accent underline">
                  All active ({active.length})
                </button>
                <button onClick={() => setPicked(clinics.map((c) => c.id))} className="text-muted underline">
                  Every clinic
                </button>
                <button onClick={() => setPicked([])} className="text-muted underline">
                  None
                </button>
              </div>
            </div>

            <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {clinics.map((c) => (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm ${
                    picked.includes(c.id) ? "border-accent bg-accentSoft" : "border-hairline bg-surface"
                  }`}
                >
                  <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span className="truncate">{c.name}</span>
                  {c.status !== "active" && <span className="ml-auto text-[10px] text-muted">{c.status}</span>}
                </label>
              ))}
            </div>
          </section>

          {/* go */}
          <section className="mt-8">
            <button
              onClick={generate}
              disabled={busy || picked.length === 0}
              className="rounded bg-accent px-5 py-2.5 text-sm text-white disabled:opacity-40"
            >
              {busy
                ? "Generating…"
                : `Generate ${picked.length || ""} pack${picked.length === 1 ? "" : "s"}`}
            </button>
            <p className="mt-2 text-xs text-muted">
              One clinic downloads as a workbook; several arrive as a zip. A clinic with nothing
              imported for the period is skipped and named — an empty pack would tell a client their
              month was zero, which is a claim rather than a gap.
            </p>
          </section>

          {note && (
            <div
              className={`mt-6 rounded-card border px-4 py-3 text-sm ${
                note.ok ? "border-good/30 bg-good/5 text-good" : "border-bad/30 bg-bad/5 text-bad"
              }`}
            >
              {note.lines.map((l, i) => (
                <p key={i} className={i === 0 ? "font-medium" : "mt-1 text-xs"}>{l}</p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
