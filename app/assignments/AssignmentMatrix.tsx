"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import TableControls from "@/components/TableControls";

type Clinic = { id: number; name: string; status: string };
type Fn = { id: number; code: string; label: string; sort_order: number };
type Party = { id: number; name: string; kind: string; profile_id: string | null; is_active: boolean };
type Owner = { id: number; clinic_id: number; function_id: number; party_id: number; note: string | null };

/**
 * Who owns which piece of work at which clinic.
 *
 * Laid out the way Pravin's own sheet is laid out — a row per clinic, a
 * column per function — because that is the shape the team already reads,
 * and a matrix answers a question a list cannot: which cells are EMPTY.
 * An unassigned function at a live clinic is the thing worth finding, and
 * it is invisible in any per-person view.
 */

/** Distinct colours per party, so a row can be scanned without reading it. */
const PALETTE = [
  "#0F6C7E", "#3D5AB5", "#C08D21", "#7A52C4", "#2F7A57",
  "#B84A66", "#CB6B22", "#3F6E8C", "#8A4A8F", "#A93226",
];

export default function AssignmentMatrix({
  canEdit,
  clinics,
  functions,
  parties,
  owners,
}: {
  canEdit: boolean;
  clinics: Clinic[];
  functions: Fn[];
  parties: Party[];
  owners: Owner[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [newParty, setNewParty] = useState("");
  const [view, setView] = useState<"matrix" | "party">("matrix");

  const visible = clinics.filter((c) => showAll || c.status === "active");
  const active = parties.filter((p) => p.is_active);

  const colourOf = useMemo(() => {
    const m = new Map<number, string>();
    active.forEach((p, i) => m.set(p.id, PALETTE[i % PALETTE.length]));
    return m;
  }, [active]);

  const partyName = useMemo(() => new Map(parties.map((p) => [p.id, p.name])), [parties]);

  const ownerAt = useMemo(() => {
    const m = new Map<string, Owner>();
    for (const o of owners) m.set(`${o.clinic_id}|${o.function_id}`, o);
    return m;
  }, [owners]);

  async function assign(clinicId: number, functionId: number, partyId: string) {
    setBusy(true);
    setError(null);

    if (!partyId) {
      // Clearing a cell is a delete, not a party of "nobody" — an absent row
      // and a row pointing at nobody would mean the same thing two ways.
      const existing = ownerAt.get(`${clinicId}|${functionId}`);
      if (existing) {
        const { error } = await supabase.from("clinic_function_owners").delete().eq("id", existing.id);
        if (error) setError(error.message);
      }
    } else {
      const { error } = await supabase.from("clinic_function_owners").upsert(
        {
          clinic_id: clinicId,
          function_id: functionId,
          party_id: Number(partyId),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "clinic_id,function_id" }
      );
      if (error) setError(error.message);
    }

    setBusy(false);
    router.refresh();
  }

  async function addParty() {
    const name = newParty.trim();
    if (!name) return;
    setBusy(true);
    const { error } = await supabase
      .from("work_parties")
      .insert({ name, kind: "person" });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNewParty("");
    router.refresh();
  }

  // Counts per party, which is the "metrics" half of the ask.
  const perParty = useMemo(() => {
    const counts = new Map<number, { total: number; clinics: Set<number>; byFn: Map<number, number> }>();
    for (const o of owners) {
      if (!counts.has(o.party_id))
        counts.set(o.party_id, { total: 0, clinics: new Set(), byFn: new Map() });
      const c = counts.get(o.party_id)!;
      c.total += 1;
      c.clinics.add(o.clinic_id);
      c.byFn.set(o.function_id, (c.byFn.get(o.function_id) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([partyId, c]) => ({
        partyId,
        name: partyName.get(partyId) ?? "—",
        total: c.total,
        clinics: c.clinics.size,
        byFn: c.byFn,
      }))
      .sort((a, b) => b.total - a.total);
  }, [owners, partyName]);

  const cellsPossible = visible.length * functions.length;
  const cellsFilled = visible.reduce(
    (t, c) => t + functions.filter((f) => ownerAt.has(`${c.id}|${f.id}`)).length,
    0
  );
  const gaps = cellsPossible - cellsFilled;

  const th = "px-2 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
          <p className="mt-1 text-sm text-muted">
            Who owns each piece of work at each clinic. This is standing ownership — it stays true
            until somebody changes it, and it is not a list of today&apos;s jobs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm print:hidden">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-muted underline hover:text-ink"
          >
            {showAll ? "Active clinics only" : "Include closed clinics"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-card border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {/* the number that matters most */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Clinics", String(visible.length)],
          ["Functions", String(functions.length)],
          ["Assigned", String(cellsFilled)],
          ["Unassigned", String(gaps)],
        ].map(([label, value], i) => (
          <div
            key={label}
            className={`rounded-card border border-hairline bg-surface px-4 py-3 shadow-card ${
              i === 3 && gaps > 0 ? "border-l-4 border-l-warn" : ""
            }`}
          >
            <div className="eyebrow">{label}</div>
            <div className="tnum mt-1 text-xl font-medium">{value}</div>
          </div>
        ))}
      </div>

      {gaps > 0 && (
        <p className="mt-3 text-sm text-warn">
          {gaps} cell{gaps === 1 ? " has" : "s have"} nobody against them. An unowned function at a
          live clinic is the thing this grid exists to make visible.
        </p>
      )}

      <nav className="mt-8 flex flex-wrap gap-1 border-b border-hairline print:hidden">
        {([
          ["matrix", "The grid"],
          ["party", "By person or vendor"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              view === k ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === "matrix" && (
        <section className="mt-4">
          <TableControls
            title="Assignments"
            rows={visible}
            columns={[
              { header: "Clinic", value: (c) => c.name },
              ...functions.map((f) => ({
                header: f.label,
                value: (c: Clinic) => {
                  const o = ownerAt.get(`${c.id}|${f.id}`);
                  return o ? partyName.get(o.party_id) ?? "" : "";
                },
              })),
            ]}
          />

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={`${th} sticky left-0 z-10 bg-canvas`}>Clinic</th>
                  {functions.map((f) => (
                    <th key={f.id} className={th}>
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.id} className="border-b border-hairline/60">
                    <td className="sticky left-0 z-10 bg-surface px-2 py-1.5 whitespace-nowrap">
                      <Link href={`/clinics/${c.id}`} className="hover:text-accent">
                        {c.name}
                      </Link>
                      {c.status !== "active" && (
                        <span className="ml-2 text-[10px] text-muted">{c.status}</span>
                      )}
                    </td>
                    {functions.map((f) => {
                      const o = ownerAt.get(`${c.id}|${f.id}`);
                      const colour = o ? colourOf.get(o.party_id) : undefined;
                      return (
                        <td key={f.id} className="px-1 py-1">
                          {canEdit ? (
                            <select
                              value={o?.party_id ?? ""}
                              disabled={busy}
                              onChange={(e) => assign(c.id, f.id, e.target.value)}
                              className="w-full rounded border px-1.5 py-1 text-xs outline-none"
                              style={
                                colour
                                  ? { borderColor: `${colour}55`, background: `${colour}12`, color: colour }
                                  : { borderColor: "#DCE4E8", color: "#5C6B75" }
                              }
                            >
                              <option value="">—</option>
                              {active.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className="block rounded px-1.5 py-1 text-xs"
                              style={colour ? { background: `${colour}12`, color: colour } : undefined}
                            >
                              {o ? partyName.get(o.party_id) : "—"}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <div className="mt-5 flex flex-wrap items-center gap-2 print:hidden">
              <span className="eyebrow">Add somebody</span>
              <input
                value={newParty}
                onChange={(e) => setNewParty(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addParty()}
                placeholder="Name as it appears on the sheet"
                className="rounded border border-hairline px-2 py-1 text-sm outline-none focus:border-accent"
              />
              <button
                onClick={addParty}
                disabled={busy || !newParty.trim()}
                className="rounded bg-accent px-3 py-1 text-sm text-white disabled:opacity-40"
              >
                Add
              </button>
              <span className="text-xs text-muted">
                People and outside companies both go here — the sheet names Medavin and MTI
                alongside Diana and Michelle, and all four own work.
              </span>
            </div>
          )}
        </section>
      )}

      {view === "party" && (
        <section className="mt-4">
          <TableControls
            title="Assignments by party"
            rows={perParty}
            columns={[
              { header: "Party", value: (p) => p.name },
              { header: "Clinics", value: (p) => p.clinics },
              { header: "Functions owned", value: (p) => p.total },
              ...functions.map((f) => ({
                header: f.label,
                value: (p: (typeof perParty)[number]) => p.byFn.get(f.id) ?? 0,
              })),
            ]}
          />
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className={th}>Party</th>
                <th className={`${th} text-right`}>Clinics</th>
                <th className={`${th} text-right`}>Cells owned</th>
                <th className={th}>Mostly</th>
              </tr>
            </thead>
            <tbody>
              {perParty.map((p) => {
                const top = Array.from(p.byFn.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
                return (
                  <tr key={p.partyId} className="border-b border-hairline/60">
                    <td className="px-2 py-2">
                      <span
                        className="rounded px-1.5 py-0.5"
                        style={{
                          background: `${colourOf.get(p.partyId) ?? "#5C6B75"}12`,
                          color: colourOf.get(p.partyId) ?? "#5C6B75",
                        }}
                      >
                        {p.name}
                      </span>
                    </td>
                    <td className="tnum px-2 py-2 text-right">{p.clinics}</td>
                    <td className="tnum px-2 py-2 text-right font-medium">{p.total}</td>
                    <td className="px-2 py-2 text-xs text-muted">
                      {top
                        .map(([fnId, n]) => `${functions.find((f) => f.id === fnId)?.label ?? "?"} (${n})`)
                        .join(", ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {perParty.length === 0 && (
            <p className="mt-4 text-sm text-muted">
              Nothing assigned yet. Fill the grid and this fills itself.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
