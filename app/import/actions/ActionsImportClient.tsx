"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  parseCollectionActions,
  normaliseClinic,
  type ParsedActions,
} from "@/lib/parseActions";

type ClinicLite = { id: number; name: string; status: string };
type ActionType = { id: number; name: string; category: string | null };

const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

/**
 * The parser's canonical form is upper-case with spaced dashes
 * ("CLAIM PAID - PAYMENT NOT POSTED"). The seeded action_types are written
 * for humans ("Claim paid - payment not posted"). Same string, different
 * case and spacing, so both sides go through this before comparing.
 */
const matchKey = (s: string) =>
  s
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

export default function ActionsImportClient({
  clinics,
  actionTypes,
  actionAliases,
  clinicAliases,
}: {
  clinics: ClinicLite[];
  actionTypes: ActionType[];
  actionAliases: { normalised: string; action_type_id: number }[];
  clinicAliases: { normalised: string; clinic_id: number }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedActions | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // normalised label -> chosen id. "" means unresolved, "skip" means
  // deliberately not imported.
  const [actionChoice, setActionChoice] = useState<Record<string, string>>({});
  const [clinicChoice, setClinicChoice] = useState<Record<string, string>>({});

  const aliasByAction = new Map(actionAliases.map((a) => [a.normalised, a.action_type_id]));
  const aliasByClinic = new Map(clinicAliases.map((a) => [a.normalised, a.clinic_id]));
  const typeByKey = new Map(actionTypes.map((t) => [matchKey(t.name), t.id]));
  const clinicByKey = new Map(clinics.map((c) => [normaliseClinic(c.name), c.id]));
  const clinicName = new Map(clinics.map((c) => [c.id, c.name]));
  const typeName = new Map(actionTypes.map((t) => [t.id, t.name]));

  /** Stored alias first, then an exact canonical match, then nothing. */
  function suggestAction(normalised: string): number | null {
    return aliasByAction.get(normalised) ?? typeByKey.get(matchKey(normalised)) ?? null;
  }
  function suggestClinic(raw: string): number | null {
    const n = normaliseClinic(raw);
    return aliasByClinic.get(n) ?? clinicByKey.get(n) ?? null;
  }

  async function onFile(file: File) {
    setResult(null);
    setFileName(file.name);
    setParsed(null);

    try {
      const buf = await file.arrayBuffer();
      const p = parseCollectionActions(buf);
      setParsed(p);

      // Pre-fill every choice the app can work out for itself, so only the
      // genuinely unknown names need a decision.
      const ac: Record<string, string> = {};
      for (const a of p.actionTotals) {
        const id = suggestAction(a.action);
        ac[a.action] = id ? String(id) : "";
      }
      const cc: Record<string, string> = {};
      for (const c of p.clinics) {
        const id = suggestClinic(c);
        cc[c] = id ? String(id) : "";
      }
      setActionChoice(ac);
      setClinicChoice(cc);
    } catch (err) {
      setResult({
        ok: false,
        message: `Could not read that file: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const errors = parsed?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = parsed?.issues.filter((i) => i.level === "warning") ?? [];

  const unresolvedActions = parsed
    ? parsed.actionTotals.filter((a) => !actionChoice[a.action])
    : [];
  const unresolvedClinics = parsed ? parsed.clinics.filter((c) => !clinicChoice[c]) : [];

  const skippedClinics = parsed ? parsed.clinics.filter((c) => clinicChoice[c] === "skip") : [];

  const canImport =
    !!parsed &&
    !!parsed.period &&
    errors.length === 0 &&
    unresolvedActions.length === 0 &&
    unresolvedClinics.length === 0 &&
    !busy;

  async function commit() {
    if (!parsed || !parsed.period) return;
    setBusy(true);
    setResult(null);

    const period = `${parsed.period}-01`;

    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({
        source_type: "file",
        source_name: fileName,
        report_kind: "collection_actions",
        period_month: period,
        status: "running",
      })
      .select("id")
      .single();

    if (batchError || !batch) {
      setBusy(false);
      setResult({ ok: false, message: `Could not start the import: ${batchError?.message}` });
      return;
    }
    const batchId = batch.id as number;

    const fail = async (message: string) => {
      await supabase
        .from("import_batches")
        .update({ status: "failed", finished_at: new Date().toISOString(), error_detail: message })
        .eq("id", batchId);
      setBusy(false);
      setResult({ ok: false, message });
    };

    // --- collectors, upserted on their code ------------------------------
    const codes = Array.from(new Set(parsed.rows.map((r) => r.collector).filter(Boolean)));
    const { data: savedCollectors, error: collectorError } = await supabase
      .from("collectors")
      .upsert(
        codes.map((c) => ({ code: c, display_name: c })),
        { onConflict: "code" }
      )
      .select("id, code");
    if (collectorError) return fail(`Collectors: ${collectorError.message}`);

    const collectorId = new Map((savedCollectors ?? []).map((c) => [c.code as string, c.id as number]));

    // --- remember every mapping made here, so next month is quiet --------
    const newActionAliases = parsed.actionTotals
      .filter((a) => actionChoice[a.action] && actionChoice[a.action] !== "skip")
      .map((a) => ({
        normalised: a.action,
        action_type_id: Number(actionChoice[a.action]),
        raw_example: a.variants[0] ?? a.action,
      }));
    if (newActionAliases.length) {
      const { error } = await supabase
        .from("action_type_aliases")
        .upsert(newActionAliases, { onConflict: "normalised" });
      if (error) return fail(`Action names: ${error.message}`);
    }

    const newClinicAliases = parsed.clinics
      .filter((c) => clinicChoice[c] && clinicChoice[c] !== "skip")
      .map((c) => ({
        normalised: normaliseClinic(c),
        clinic_id: Number(clinicChoice[c]),
        raw_example: c,
        source: "collection_action_report",
      }));
    if (newClinicAliases.length) {
      const { error } = await supabase
        .from("clinic_aliases")
        .upsert(newClinicAliases, { onConflict: "normalised" });
      if (error) return fail(`Clinic names: ${error.message}`);
    }

    // --- the facts -------------------------------------------------------
    // Rows are merged on the natural key before writing. Postgres refuses an
    // upsert payload that touches the same row twice, and a report can
    // legitimately repeat a key across two raw spellings of one action.
    type Fact = {
      clinic_id: number;
      period_month: string;
      action_type_id: number;
      collector_id: number;
      action_count: number;
      is_ot: boolean;
      raw_action: string;
      raw_clinic: string;
      source_batch_id: number;
    };
    const merged = new Map<string, Fact>();
    const unmapped: {
      period_month: string;
      raw_clinic: string;
      raw_action: string;
      raw_collector: string;
      action_count: number;
      reason: string;
      source_batch_id: number;
    }[] = [];

    for (const r of parsed.rows) {
      const cChoice = clinicChoice[r.clinicRaw];
      const aChoice = actionChoice[r.actionNormalised];
      const colId = collectorId.get(r.collector);

      if (!cChoice || cChoice === "skip" || !aChoice || aChoice === "skip" || !colId) {
        unmapped.push({
          period_month: period,
          raw_clinic: r.clinicRaw,
          raw_action: r.actionRaw,
          raw_collector: r.collector,
          action_count: r.count,
          reason:
            !cChoice || cChoice === "skip"
              ? "clinic not matched"
              : !aChoice || aChoice === "skip"
                ? "action not matched"
                : "collector not saved",
          source_batch_id: batchId,
        });
        continue;
      }

      const key = `${cChoice}|${aChoice}|${colId}|${r.isOt}`;
      const existing = merged.get(key);
      if (existing) {
        existing.action_count += r.count;
      } else {
        merged.set(key, {
          clinic_id: Number(cChoice),
          period_month: period,
          action_type_id: Number(aChoice),
          collector_id: colId,
          action_count: r.count,
          is_ot: r.isOt,
          raw_action: r.actionRaw,
          raw_clinic: r.clinicRaw,
          source_batch_id: batchId,
        });
      }
    }

    const facts = Array.from(merged.values());
    for (let i = 0; i < facts.length; i += 400) {
      const { error } = await supabase
        .from("collection_actions_monthly")
        .upsert(facts.slice(i, i + 400), {
          onConflict: "clinic_id,period_month,action_type_id,collector_id,is_ot",
        });
      if (error) return fail(`Actions: ${error.message}`);
    }

    if (unmapped.length) {
      const { error } = await supabase.from("unmapped_action_rows").insert(unmapped);
      if (error) return fail(`Unmatched rows: ${error.message}`);
    }

    const accepted = facts.reduce((s, f) => s + f.action_count, 0);
    const rejected = unmapped.reduce((s, u) => s + u.action_count, 0);

    await supabase
      .from("import_batches")
      .update({
        status: unmapped.length ? "partial" : "success",
        finished_at: new Date().toISOString(),
        rows_read: parsed.rows.length,
        rows_accepted: facts.length,
        rows_rejected: unmapped.length,
      })
      .eq("id", batchId);

    setBusy(false);
    setResult({
      ok: true,
      message:
        `Imported ${accepted.toLocaleString()} actions into ${monthLabel(parsed.period)}` +
        (rejected
          ? `. ${rejected.toLocaleString()} actions were set aside because their clinic was skipped — they are kept and can be matched later.`
          : "."),
    });
    router.refresh();
  }

  const field =
    "rounded-card border border-hairline bg-surface shadow-card px-2 py-1 text-sm outline-none focus:border-accent";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";
  const thR = "py-2 text-right font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <div className="space-y-8">
      {/* 1 — file */}
      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">
          1 · Choose the file
        </h2>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
          className="mt-3 block w-full text-sm file:mr-4 file:rounded file:border-0 file:bg-accent
                     file:px-4 file:py-2 file:text-sm file:text-white"
        />
        {fileName && <p className="mt-2 text-xs text-muted">{fileName}</p>}
      </section>

      {result && (
        <p
          className={`rounded border px-4 py-3 text-sm ${
            result.ok ? "border-good/30 bg-good/5 text-good" : "border-bad/30 bg-bad/5 text-bad"
          }`}
        >
          {result.message}
        </p>
      )}

      {parsed && (
        <>
          {/* 2 — what the file holds */}
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">
              2 · What the file contains
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Month", parsed.period ? monthLabel(parsed.period) : "not stated"],
                ["Actions", parsed.totalActions.toLocaleString()],
                ["Clinics", String(parsed.clinics.length)],
                ["Collectors", String(parsed.collectors.length)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-card border border-hairline bg-surface shadow-card px-4 py-3">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-muted">
                    {label}
                  </div>
                  <div className="tnum mt-1 text-lg font-medium">{value}</div>
                </div>
              ))}
            </div>

            {!parsed.period && (
              <p className="mt-3 rounded border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
                The file does not state which month it covers, so there is nowhere to file it.
                The date column should carry a month-end date.
              </p>
            )}

            {errors.map((i, n) => (
              <p
                key={n}
                className="mt-3 rounded border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad"
              >
                {i.message}
              </p>
            ))}
            {warnings.map((i, n) => (
              <p
                key={n}
                className="mt-3 rounded border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn"
              >
                {i.message}
              </p>
            ))}
          </section>

          {/* 3 — action names */}
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">
              3 · Action names
            </h2>
            <p className="mt-2 text-sm text-muted">
              {parsed.actionTotals.length} distinct actions after collapsing the spellings.
              {unresolvedActions.length > 0
                ? ` ${unresolvedActions.length} need a match — the report has a phrase MOne has not seen before.`
                : " All of them are already recognised."}
            </p>

            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={thL}>As typed</th>
                  <th className={thR}>Actions</th>
                  <th className={thL}>Counts as</th>
                </tr>
              </thead>
              <tbody>
                {parsed.actionTotals.map((a) => {
                  const chosen = actionChoice[a.action] ?? "";
                  return (
                    <tr key={a.action} className="border-b border-hairline/60 align-top">
                      <td className="py-2 pr-4">
                        {a.action}
                        {a.variants.length > 1 && (
                          <div className="mt-0.5 text-xs text-muted">
                            {a.variants.length} spellings collapsed
                          </div>
                        )}
                      </td>
                      <td className="tnum py-2 pr-4 text-right">{a.total.toLocaleString()}</td>
                      <td className="py-2">
                        <select
                          className={`${field} ${chosen ? "" : "border-warn"}`}
                          value={chosen}
                          onChange={(e) =>
                            setActionChoice({ ...actionChoice, [a.action]: e.target.value })
                          }
                        >
                          <option value="">— choose —</option>
                          {actionTypes.map((t) => (
                            <option key={t.id} value={String(t.id)}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        {chosen && typeName.get(Number(chosen)) && (
                          <div className="mt-0.5 text-xs text-muted">
                            {actionTypes.find((t) => t.id === Number(chosen))?.category ?? ""}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* 4 — clinic names */}
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">
              4 · Clinic names
            </h2>
            <p className="mt-2 text-sm text-muted">
              This report abbreviates clinics differently from every other file, so a name
              that does not match has to be pointed at the right clinic once. After that it
              is remembered.
              {unresolvedClinics.length > 0 &&
                ` ${unresolvedClinics.length} still need a decision.`}
            </p>

            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={thL}>As typed</th>
                  <th className={thL}>Is this clinic</th>
                </tr>
              </thead>
              <tbody>
                {parsed.clinics.map((c) => {
                  const chosen = clinicChoice[c] ?? "";
                  return (
                    <tr key={c} className="border-b border-hairline/60">
                      <td className="py-2 pr-4">{c}</td>
                      <td className="py-2">
                        <select
                          className={`${field} ${chosen ? "" : "border-warn"}`}
                          value={chosen}
                          onChange={(e) =>
                            setClinicChoice({ ...clinicChoice, [c]: e.target.value })
                          }
                        >
                          <option value="">— choose —</option>
                          {clinics.map((cl) => (
                            <option key={cl.id} value={String(cl.id)}>
                              {cl.name}
                              {cl.status !== "active" ? ` (${cl.status})` : ""}
                            </option>
                          ))}
                          <option value="skip">Not one of ours — set these rows aside</option>
                        </select>
                        {chosen && chosen !== "skip" && (
                          <span className="ml-2 text-xs text-muted">
                            {clinicName.get(Number(chosen))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {skippedClinics.length > 0 && (
              <p className="mt-3 rounded border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
                {skippedClinics.length} clinic{skippedClinics.length === 1 ? "" : "s"} set aside.
                Those rows are kept in full and can be matched later — nothing is thrown away.
                If any of them is a real clinic, add it under Settings first and it will appear
                in this list.
              </p>
            )}
          </section>

          {/* 5 — commit */}
          <section className="border-t border-hairline pt-6">
            <button
              disabled={!canImport}
              onClick={commit}
              className="rounded bg-accent px-5 py-2.5 text-sm text-white disabled:opacity-40"
            >
              {busy
                ? "Importing…"
                : parsed.period
                  ? `Import ${parsed.totalActions.toLocaleString()} actions into ${monthLabel(parsed.period)}`
                  : "Import"}
            </button>

            {!canImport && !busy && (
              <p className="mt-2 text-xs text-muted">
                {errors.length > 0
                  ? "The file has to read cleanly first."
                  : unresolvedActions.length > 0 || unresolvedClinics.length > 0
                    ? "Every action and clinic above needs a decision before anything is written."
                    : !parsed.period
                      ? "The month has to be readable from the file."
                      : ""}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              Re-importing the same month replaces its figures rather than adding to them.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
