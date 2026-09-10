"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TARGETS, targetFor, type Target } from "@/lib/importTargets";
import {
  buildRows,
  guessMapping,
  norm,
  readTables,
  scoreProfile,
  type BuiltRow,
  type Mapping,
  type Sheet,
} from "@/lib/importEngine";
import type { Profile } from "@/lib/types";

type SavedProfile = {
  id: number;
  name: string;
  target_table: string;
  filename_hint: string | null;
  header_signature: string[] | null;
  mapping: Mapping;
  defaults: Record<string, string | number | boolean | null>;
  times_used: number;
};

/**
 * Import anything with a header row.
 *
 * The order is deliberate: read the file first, then decide what it is. Asking
 * somebody to choose the target before showing them the columns means they
 * pick from memory, and the memory is usually of the last file they did.
 *
 * ⚠ NOTHING IS WRITTEN UNTIL THE PREVIEW HAS BEEN SEEN. A wrong mapping loads
 * silently plausible figures, which is far worse than a failed import — the
 * failure gets fixed, the plausible number gets quoted to a client.
 */
export default function DataImportClient({
  me,
  clinics,
  aliases,
  savedProfiles,
}: {
  me: Profile;
  clinics: { id: number; name: string }[];
  aliases: { normalised: string; clinic_id: number }[];
  savedProfiles: SavedProfile[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetAt, setSheetAt] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [defaultClinic, setDefaultClinic] = useState("");
  const [matched, setMatched] = useState<{ profile: SavedProfile; score: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [saveAs, setSaveAs] = useState("");

  // Clinic lookup: the clinics themselves plus every alias already recorded,
  // so a file that says "B2H" finds Back 2 Health without anybody retyping it.
  const clinicByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clinics) m.set(norm(c.name), c.id);
    for (const a of aliases) m.set(norm(a.normalised), a.clinic_id);
    return m;
  }, [clinics, aliases]);

  const sheet = sheets[sheetAt];

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    setFileName(file.name);
    setSheets([]);
    setTarget(null);
    setMapping({});
    setMatched(null);

    try {
      const found = await readTables(file);
      if (found.length === 0) {
        setError("No table with a header row was found in that file.");
        return;
      }
      setSheets(found);
      setSheetAt(0);
      recognise(found[0], file.name);
    } catch (e) {
      setError(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Best saved profile, or failing that a guess from the aliases. */
  function recognise(s: Sheet, name: string) {
    let best: { profile: SavedProfile; score: number } | null = null;
    for (const p of savedProfiles) {
      const score = scoreProfile(p, name, s.headers);
      if (score >= 0.6 && (!best || score > best.score)) best = { profile: p, score };
    }

    if (best) {
      const t = targetFor(best.profile.target_table) ?? null;
      setMatched(best);
      setTarget(t);
      setMapping(best.profile.mapping ?? {});
      const d = best.profile.defaults?.clinic_id;
      setDefaultClinic(d ? String(d) : "");
      return;
    }

    // Nothing saved matches. Score each target by how much of it the
    // headers can fill, and offer the strongest — the person confirms.
    let bestTarget: { t: Target; hits: number } | null = null;
    for (const t of TARGETS) {
      const g = guessMapping(t, s.headers);
      const hits = Object.keys(g).length;
      if (!bestTarget || hits > bestTarget.hits) bestTarget = { t, hits };
    }
    if (bestTarget && bestTarget.hits >= 2) {
      setTarget(bestTarget.t);
      setMapping(guessMapping(bestTarget.t, s.headers));
    }
  }

  function chooseTarget(table: string) {
    const t = targetFor(table) ?? null;
    setTarget(t);
    setMatched(null);
    setMapping(t && sheet ? guessMapping(t, sheet.headers) : {});
  }

  const built: BuiltRow[] = useMemo(() => {
    if (!target || !sheet) return [];
    const defaults: Record<string, string | number | boolean | null> = defaultClinic
      ? { clinic_id: Number(defaultClinic) }
      : {};
    return buildRows(target, sheet, mapping, defaults);
  }, [target, sheet, mapping, defaultClinic]);

  /** Resolve clinic names now, so the preview shows what will actually happen. */
  const resolved = useMemo(
    () =>
      built.map((r) => {
        if (!r.clinicName) return { ...r, clinicId: defaultClinic ? Number(defaultClinic) : null };
        const id = clinicByName.get(norm(r.clinicName)) ?? null;
        return {
          ...r,
          clinicId: id,
          problems: id ? r.problems : [...r.problems, `Clinic "${r.clinicName}" is not one of ours`],
        };
      }),
    [built, clinicByName, defaultClinic]
  );

  const good = resolved.filter((r) => r.problems.length === 0);
  const bad = resolved.filter((r) => r.problems.length > 0);
  const unknownClinics = Array.from(
    new Set(resolved.filter((r) => r.clinicName && !r.clinicId).map((r) => r.clinicName as string))
  );

  async function commit() {
    if (!target || good.length === 0) return;
    setBusy(true);
    setError(null);

    const payload = good.map((r) => {
      const row: Record<string, unknown> = { ...r.values };
      if (r.clinicId) row.clinic_id = r.clinicId;
      if (target.table === "denials" && typeof row.denial_date === "string") {
        row.period_month = `${(row.denial_date as string).slice(0, 7)}-01`;
      }
      return row;
    });

    for (let i = 0; i < payload.length; i += 400) {
      const slice = payload.slice(i, i + 400);
      const q = target.conflict
        ? supabase.from(target.table).upsert(slice, { onConflict: target.conflict.join(",") })
        : supabase.from(target.table).insert(slice);
      const { error: err } = await q;
      if (err) {
        setBusy(false);
        setError(`Row ${i + 1} onwards: ${err.message}`);
        return;
      }
    }

    if (matched) {
      await supabase
        .from("import_profiles")
        .update({ times_used: matched.profile.times_used + 1, last_used_at: new Date().toISOString() })
        .eq("id", matched.profile.id);
    }

    setBusy(false);
    setResult(
      `Loaded ${good.length.toLocaleString()} rows into ${target.label}.` +
        (bad.length ? ` ${bad.length} were left out — see below.` : "")
    );
    router.refresh();
  }

  async function saveProfile() {
    if (!target || !sheet || !saveAs.trim()) return;
    setBusy(true);
    const { error: err } = await supabase.from("import_profiles").insert({
      name: saveAs.trim(),
      target_table: target.table,
      filename_hint: fileName.replace(/[\d._-]{4,}/g, "").slice(0, 40) || null,
      header_signature: sheet.headers.filter(Boolean),
      mapping,
      defaults: defaultClinic ? { clinic_id: Number(defaultClinic) } : {},
      created_by: me.id,
    });
    setBusy(false);
    if (err) {
      setError(err.message.includes("import_profiles_name_key") ? "A saved mapping already has that name." : err.message);
      return;
    }
    setSaveAs("");
    setResult("Mapping saved — the next file like this will recognise itself.");
    router.refresh();
  }

  const field =
    "rounded border border-hairline bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <div className="space-y-8">
      {/* 1 — the file */}
      <section>
        <h2 className="eyebrow">1 · Choose the file</h2>
        <input
          type="file"
          accept=".xlsx,.xls,.csv,.tsv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
          className="mt-3 block w-full text-sm file:mr-4 file:rounded file:border-0 file:bg-accent
                     file:px-4 file:py-2 file:text-sm file:text-white"
        />
        {fileName && <p className="mt-2 text-xs text-muted">{fileName}</p>}
        {savedProfiles.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {savedProfiles.length} saved mapping{savedProfiles.length === 1 ? "" : "s"} — a file
            matching one is recognised automatically.
          </p>
        )}
      </section>

      {error && (
        <p className="rounded-card border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</p>
      )}
      {result && (
        <p className="rounded-card border border-good/30 bg-good/5 px-4 py-3 text-sm text-good">{result}</p>
      )}

      {sheet && (
        <>
          {/* 2 — what it is */}
          <section>
            <h2 className="eyebrow">2 · What this file is</h2>

            {sheets.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Sheet</span>
                <select
                  value={sheetAt}
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    setSheetAt(i);
                    recognise(sheets[i], fileName);
                  }}
                  className={field}
                >
                  {sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name} ({s.rows.length} rows)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {matched && (
              <p className="mt-3 rounded-card border border-good/30 bg-good/5 px-4 py-3 text-sm text-good">
                Recognised as <strong>{matched.profile.name}</strong> ({Math.round(matched.score * 100)}%
                match). The mapping below came from that, and can still be changed.
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Load into</span>
              <select value={target?.table ?? ""} onChange={(e) => chooseTarget(e.target.value)} className={field}>
                <option value="">Choose…</option>
                {TARGETS.map((t) => (
                  <option key={t.table} value={t.table}>{t.label}</option>
                ))}
              </select>
              {target && <span className="text-xs text-muted">{target.description}</span>}
            </div>

            <p className="mt-2 text-xs text-muted">
              {sheet.rows.length.toLocaleString()} rows, {sheet.headers.filter(Boolean).length} columns.
            </p>
          </section>

          {/* 3 — mapping */}
          {target && (
            <section>
              <h2 className="eyebrow">3 · Which column is which</h2>
              <p className="mt-1 text-sm text-muted">
                Anything left as &ldquo;not in this file&rdquo; is simply not loaded. Only the
                columns marked required have to be filled.
              </p>

              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={thL}>Our field</th>
                    <th className={thL}>Their column</th>
                    <th className={thL}>First value</th>
                  </tr>
                </thead>
                <tbody>
                  {target.fields.map((f) => {
                    const header = mapping[f.column] ?? "";
                    const at = sheet.headers.indexOf(header);
                    const sample = at >= 0 ? sheet.rows[0]?.[at] ?? "" : "";
                    return (
                      <tr key={f.column} className="border-b border-hairline/60 align-top">
                        <td className="py-2 pr-3">
                          {f.label}
                          {f.required && <span className="ml-1 text-bad">*</span>}
                          {f.hint && <div className="text-xs text-muted">{f.hint}</div>}
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            value={header}
                            onChange={(e) => setMapping({ ...mapping, [f.column]: e.target.value })}
                            className={`${field} w-full ${!header && f.required ? "border-warn" : ""}`}
                          >
                            <option value="">not in this file</option>
                            {sheet.headers.filter(Boolean).map((h) => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 text-xs text-muted">{sample}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {target.fields.some((f) => f.kind === "clinic") && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">If the file names no clinic, use</span>
                  <select value={defaultClinic} onChange={(e) => setDefaultClinic(e.target.value)} className={field}>
                    <option value="">— none —</option>
                    {clinics.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </section>
          )}

          {/* 4 — preview */}
          {target && resolved.length > 0 && (
            <section>
              <h2 className="eyebrow">4 · What will happen</h2>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Rows read", String(resolved.length)],
                  ["Will load", String(good.length)],
                  ["Left out", String(bad.length)],
                  ["Clinics", String(new Set(good.map((r) => r.clinicId)).size)],
                ].map(([l, v], i) => (
                  <div key={l} className={`rounded-card border border-hairline bg-surface px-4 py-3 ${i === 2 && bad.length ? "border-l-4 border-l-warn" : ""}`}>
                    <div className="eyebrow">{l}</div>
                    <div className="tnum mt-1 text-lg font-medium">{v}</div>
                  </div>
                ))}
              </div>

              {unknownClinics.length > 0 && (
                <p className="mt-3 rounded-card border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
                  {unknownClinics.length} clinic name{unknownClinics.length === 1 ? "" : "s"} in this
                  file are not yours: {unknownClinics.slice(0, 6).join(", ")}
                  {unknownClinics.length > 6 ? "…" : ""}. Add a name mapping under Settings → Clinic
                  names, or those rows stay out.
                </p>
              )}

              <h3 className="eyebrow mt-5">First five rows as they will land</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className={thL}>Clinic</th>
                      {target.fields.filter((f) => f.kind !== "clinic" && mapping[f.column]).map((f) => (
                        <th key={f.column} className={thL}>{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {good.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-b border-hairline/60">
                        <td className="py-2 pr-3">
                          {r.clinicId ? clinics.find((c) => c.id === r.clinicId)?.name : "—"}
                        </td>
                        {target.fields.filter((f) => f.kind !== "clinic" && mapping[f.column]).map((f) => (
                          <td key={f.column} className="py-2 pr-3 text-xs">
                            {String(r.values[f.column] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {bad.length > 0 && (
                <details className="mt-4 rounded-card border border-hairline bg-surface p-4">
                  <summary className="cursor-pointer text-sm">
                    {bad.length} rows will not load — why
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-muted">
                    {bad.slice(0, 25).map((r, i) => (
                      <li key={i}>Row {i + 1}: {r.problems.join(" · ")}</li>
                    ))}
                    {bad.length > 25 && <li>…and {bad.length - 25} more.</li>}
                  </ul>
                </details>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={commit}
                  disabled={busy || good.length === 0}
                  className="rounded bg-accent px-5 py-2.5 text-sm text-white disabled:opacity-40"
                >
                  {busy ? "Loading…" : `Load ${good.length.toLocaleString()} rows`}
                </button>
                {!matched && (
                  <span className="flex items-center gap-2">
                    <input
                      value={saveAs}
                      onChange={(e) => setSaveAs(e.target.value)}
                      placeholder="Name this mapping"
                      className={`${field} w-56`}
                    />
                    <button
                      onClick={saveProfile}
                      disabled={busy || !saveAs.trim()}
                      className="rounded border border-hairline px-3 py-2 text-sm text-muted hover:text-ink disabled:opacity-40"
                    >
                      Remember it
                    </button>
                  </span>
                )}
              </div>

              <p className="mt-2 text-xs text-muted">
                Saving the mapping means the next export from the same report is recognised and
                needs none of this again.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
