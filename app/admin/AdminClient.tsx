"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Clinic } from "@/lib/types";
import EmployeeManager, { type Employee } from "./EmployeeManager";
import ClinicProfileEditor, { type ClinicFull, type ClinicPerson } from "./ClinicProfileEditor";

type Alias = { id: number; normalised: string; raw_example: string | null; clinic_id: number; source: string | null };
type ActionType = { id: number; name: string; category: string | null; sort_order: number };
type ActionAlias = { id: number; normalised: string; raw_example: string | null; action_type_id: number };

const STATUSES = ["active", "onboarding", "inactive", "terminated"] as const;

/** Same normalisation the importer uses, so a mapping added here actually matches. */
function normalise(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export default function AdminClient({
  clinics,
  aliases,
  actionTypes,
  actionAliases,
  employees,
  profiles,
  timePolicy,
  rates,
  clinicPeople,
}: {
  clinics: Clinic[];
  aliases: Alias[];
  actionTypes: ActionType[];
  actionAliases: ActionAlias[];
  employees: Employee[];
  profiles: { id: string; full_name: string; email: string; role: string }[];
  timePolicy: { kind: string; label: string; billable: boolean; productive: boolean; note: string | null }[];
  rates: { employee_id: number; hourly_rate: number; currency: string; effective_from: string }[];
  clinicPeople: ClinicPerson[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"employees" | "clinics" | "names" | "actions" | "hours">("employees");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // new clinic
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [goLive, setGoLive] = useState("");
  const [notes, setNotes] = useState("");

  // new clinic alias
  const [aliasRaw, setAliasRaw] = useState("");
  const [aliasClinic, setAliasClinic] = useState("");

  // new action alias
  const [actRaw, setActRaw] = useState("");
  const [actType, setActType] = useState("");

  // new action type
  const [newActName, setNewActName] = useState("");
  const [newActCat, setNewActCat] = useState("");

  const supabase = createClient();
  const clinicName = new Map(clinics.map((c) => [c.id, c.name]));
  const actionName = new Map(actionTypes.map((a) => [a.id, a.name]));

  // Supabase query builders are thenable but not Promises, so the callback is
  // typed as PromiseLike rather than Promise.
  async function run(
    label: string,
    fn: () => PromiseLike<{ error: { message: string } | null }>
  ) {
    setBusy(true);
    setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: `${label} failed: ${error.message}` });
      return false;
    }
    setMsg({ ok: true, text: `${label} done.` });
    router.refresh();
    return true;
  }

  async function addClinic() {
    if (!name.trim()) return;
    const ok = await run("Adding clinic", () =>
      supabase.from("clinics").insert({
        name: name.trim(),
        code: code.trim() || null,
        status,
        go_live_date: goLive || null,
        notes: notes.trim() || null,
      })
    );
    if (ok) {
      setName("");
      setCode("");
      setGoLive("");
      setNotes("");
    }
  }

  async function setClinicStatus(id: number, next: string) {
    await run("Updating clinic", () => supabase.from("clinics").update({ status: next }).eq("id", id));
  }

  async function addAlias() {
    if (!aliasRaw.trim() || !aliasClinic) return;
    const ok = await run("Adding name mapping", () =>
      supabase.from("clinic_aliases").insert({
        normalised: normalise(aliasRaw),
        raw_example: aliasRaw.trim(),
        clinic_id: Number(aliasClinic),
        source: "manual",
      })
    );
    if (ok) setAliasRaw("");
  }

  async function removeAlias(id: number) {
    await run("Removing mapping", () => supabase.from("clinic_aliases").delete().eq("id", id));
  }

  async function addActionAlias() {
    if (!actRaw.trim() || !actType) return;
    const ok = await run("Adding action mapping", () =>
      supabase.from("action_type_aliases").insert({
        normalised: actRaw.toUpperCase().replace(/\s+/g, " ").trim(),
        raw_example: actRaw.trim(),
        action_type_id: Number(actType),
      })
    );
    if (ok) setActRaw("");
  }

  async function setBillable(kind: string, billable: boolean) {
    await run("Saving policy", () =>
      supabase
        .from("time_policy")
        .update({ billable, updated_at: new Date().toISOString() })
        .eq("kind", kind)
    );
  }

  async function removeActionAlias(id: number) {
    await run("Removing mapping", () => supabase.from("action_type_aliases").delete().eq("id", id));
  }

  async function addActionType() {
    const name = newActName.trim();
    if (!name) return;
    // Sorted after everything that exists, so the seeded 18 keep the order the
    // report is usually read in and additions land at the end.
    const nextSort = Math.max(0, ...actionTypes.map((a) => a.sort_order)) + 10;
    const ok = await run("Adding action", () =>
      supabase
        .from("action_types")
        .insert({ name, category: newActCat.trim() || null, sort_order: nextSort })
    );
    if (ok) {
      setNewActName("");
      setNewActCat("");
    }
  }

  async function renameActionType(id: number, name: string, category: string) {
    if (!name.trim()) return;
    await run("Renaming action", () =>
      supabase
        .from("action_types")
        .update({ name: name.trim(), category: category.trim() || null })
        .eq("id", id)
    );
  }

  async function removeActionType(id: number) {
    // Deliberately not cascaded. If actions have already been imported against
    // this type, the database's foreign key refuses the delete and the message
    // says so — better than silently detaching figures from their label.
    await run("Removing action", () => supabase.from("action_types").delete().eq("id", id));
  }

  const field =
    "rounded-card border border-hairline bg-surface shadow-card px-3 py-2 text-sm outline-none focus:border-accent";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <div>
      <nav className="flex flex-wrap gap-1 border-b border-hairline">
        {[
          ["employees", `Employees (${employees.length})`],
          ["clinics", `Clinics (${clinics.length})`],
          ["names", `Clinic names (${aliases.length})`],
          ["actions", `Action names (${actionAliases.length})`],
          ["hours", "Billable hours"],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k as typeof tab)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === k ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {msg && (
        <p
          className={`mt-4 rounded border p-3 text-sm ${
            msg.ok ? "border-good/30 bg-good/5 text-good" : "border-bad/30 bg-bad/5 text-bad"
          }`}
        >
          {msg.text}
        </p>
      )}

      {tab === "employees" && (
        <div className="mt-8">
          <EmployeeManager employees={employees} profiles={profiles} rates={rates} />
        </div>
      )}

      {/* ---------------- CLINICS ---------------- */}
      {tab === "clinics" && (
        <div className="mt-8 space-y-8">
          <section>
            <h2 className={thL}>Add a clinic</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-muted">Name (as you want it shown)</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 w-full ${field}`} />
              </label>
              <label className="block">
                <span className="text-xs text-muted">Code (optional)</span>
                <input value={code} onChange={(e) => setCode(e.target.value)} className={`mt-1 w-full ${field}`} />
              </label>
              <label className="block">
                <span className="text-xs text-muted">Status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={`mt-1 w-full ${field}`}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted">Go-live date (optional)</span>
                <input type="date" value={goLive} onChange={(e) => setGoLive(e.target.value)} className={`mt-1 w-full ${field}`} />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs text-muted">Note (optional)</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`mt-1 w-full ${field}`} />
              </label>
            </div>
            <button
              onClick={addClinic}
              disabled={busy || !name.trim()}
              className="mt-3 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Add clinic
            </button>
            <p className="mt-2 text-xs text-muted">
              If the reports write this clinic&apos;s name differently — an abbreviation, say — add the
              spelling under <strong>Clinic names</strong> too, or imports will not find it.
            </p>
          </section>

          <ClinicProfileEditor
            clinics={clinics as unknown as ClinicFull[]}
            people={clinicPeople}
          />

          <section>
            <h2 className={thL}>All clinics</h2>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={thL}>Clinic</th>
                  <th className={thL}>Status</th>
                  <th className={thL}>Note</th>
                </tr>
              </thead>
              <tbody>
                {clinics.map((c) => (
                  <tr key={c.id} className="border-b border-hairline/60">
                    <td className="py-2">{c.name}</td>
                    <td className="py-2">
                      <select
                        value={c.status}
                        onChange={(e) => setClinicStatus(c.id, e.target.value)}
                        className="rounded-card border border-hairline bg-surface shadow-card px-2 py-1 text-xs"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 text-xs text-muted">{c.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              Clinics are never deleted — a terminated clinic keeps its history and stops appearing in
              current-month views.
            </p>
          </section>
        </div>
      )}

      {/* ---------------- CLINIC NAME MAPPINGS ---------------- */}
      {tab === "names" && (
        <div className="mt-8 space-y-8">
          <section>
            <h2 className={thL}>Map a name the reports use</h2>
            <p className="mt-1 text-sm text-muted">
              The reports do not agree with each other. The collection action report says
              &ldquo;PRO ACTIVE&rdquo; where the clinic list says &ldquo;ProActive PT&rdquo;. Record it
              once here and every future import matches it.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <input
                value={aliasRaw}
                onChange={(e) => setAliasRaw(e.target.value)}
                placeholder="Name as it appears in the file"
                className={`${field} min-w-[240px]`}
              />
              <select value={aliasClinic} onChange={(e) => setAliasClinic(e.target.value)} className={field}>
                <option value="">Which clinic is it?</option>
                {clinics.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                onClick={addAlias}
                disabled={busy || !aliasRaw.trim() || !aliasClinic}
                className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                Add mapping
              </button>
            </div>
            {aliasRaw.trim() && (
              <p className="mt-2 font-mono text-xs text-muted">stored as: {normalise(aliasRaw)}</p>
            )}
          </section>

          <section>
            <h2 className={thL}>Existing mappings</h2>
            {aliases.length === 0 ? (
              <p className="mt-3 text-sm text-muted">None yet.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={thL}>In the file</th>
                    <th className={thL}>Means</th>
                    <th className={thL}></th>
                  </tr>
                </thead>
                <tbody>
                  {aliases.map((a) => (
                    <tr key={a.id} className="border-b border-hairline/60">
                      <td className="py-2 font-mono text-xs">{a.raw_example ?? a.normalised}</td>
                      <td className="py-2">{clinicName.get(a.clinic_id) ?? "—"}</td>
                      <td className="py-2 text-right">
                        <button onClick={() => removeAlias(a.id)} className="text-xs text-bad hover:underline">
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {/* ---------------- ACTION NAME MAPPINGS ---------------- */}
      {tab === "hours" && (
        <div className="mt-8 space-y-6">
          <section>
            <h2 className="text-base font-medium">What counts as billable</h2>
            <p className="mt-1 text-sm text-muted">
              Momentum bills on hours, so this decides what appears in the Billable column on the
              Hours report. It is set here rather than fixed in the software, because the rule
              belongs to whoever runs the business — not to whoever wrote the code.
            </p>

            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={thL}>Kind of time</th>
                  <th className={thL}>Billable</th>
                  <th className={thL}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {timePolicy.map((t) => (
                  <tr key={t.kind} className="border-b border-hairline/60 align-top">
                    <td className="py-3 pr-4 font-medium">{t.label}</td>
                    <td className="py-3 pr-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          defaultChecked={t.billable}
                          disabled={busy}
                          onChange={(e) => setBillable(t.kind, e.target.checked)}
                        />
                        <span className={t.billable ? "text-good" : "text-muted"}>
                          {t.billable ? "Charged" : "Not charged"}
                        </span>
                      </label>
                    </td>
                    <td className="py-3 text-muted">{t.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-4 text-xs text-muted">
              Changing a setting here changes every report, including months already shown to a
              client. If a rule changes going forward rather than retrospectively, say so and I will
              date the policy instead of replacing it.
            </p>
          </section>
        </div>
      )}

      {tab === "actions" && (
        <div className="mt-8 space-y-8">
          <section>
            <h2 className={thL}>Map an action the collectors typed</h2>
            <p className="mt-1 text-sm text-muted">
              Collectors type the action by hand, so the same action arrives spelled several ways. The
              importer already collapses the common variations; anything it cannot place gets recorded
              as unmapped, and you map it here once.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <input
                value={actRaw}
                onChange={(e) => setActRaw(e.target.value)}
                placeholder="Action as typed in the file"
                className={`${field} min-w-[280px]`}
              />
              <select value={actType} onChange={(e) => setActType(e.target.value)} className={field}>
                <option value="">Which action is it?</option>
                {actionTypes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                onClick={addActionAlias}
                disabled={busy || !actRaw.trim() || !actType}
                className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                Add mapping
              </button>
            </div>
          </section>

          <section>
            <h2 className="text-base font-medium">Add a new action</h2>
            <p className="mt-1 text-sm text-muted">
              The list below is what the collectors are meant to be doing. Add one when the
              team starts doing something the list does not cover — the category is what
              groups it on the Actions report.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <input
                value={newActName}
                onChange={(e) => setNewActName(e.target.value)}
                placeholder="What the action is called"
                className={`${field} min-w-[280px]`}
              />
              <input
                list="action-categories"
                value={newActCat}
                onChange={(e) => setNewActCat(e.target.value)}
                placeholder="Category"
                className={field}
              />
              <datalist id="action-categories">
                {Array.from(new Set(actionTypes.map((a) => a.category).filter(Boolean))).map((c) => (
                  <option key={c as string} value={c as string} />
                ))}
              </datalist>
              <button
                onClick={addActionType}
                disabled={busy || !newActName.trim()}
                className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                Add action
              </button>
            </div>
          </section>

          <section>
            <h2 className={thL}>The {actionTypes.length} actions</h2>
            <p className="mt-1 text-sm text-muted">
              Edit a name or category and click Save. Removing one is refused if figures have
              already been imported against it — that is deliberate, since deleting it would
              leave those actions with no label.
            </p>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={thL}>Action</th>
                  <th className={thL}>Category</th>
                  <th className={thL} />
                </tr>
              </thead>
              <tbody>
                {actionTypes.map((a) => (
                  <ActionTypeRow
                    key={a.id}
                    type={a}
                    busy={busy}
                    onSave={renameActionType}
                    onRemove={removeActionType}
                  />
                ))}
              </tbody>
            </table>
          </section>

          {actionAliases.length > 0 && (
            <section>
              <h2 className={thL}>Mappings added by hand</h2>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {actionAliases.map((a) => (
                    <tr key={a.id} className="border-b border-hairline/60">
                      <td className="py-2 font-mono text-xs">{a.raw_example ?? a.normalised}</td>
                      <td className="py-2">{actionName.get(a.action_type_id) ?? "—"}</td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => removeActionAlias(a.id)}
                          className="text-xs text-bad hover:underline"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One editable row of the action list.
 *
 * Its own component because each row needs its own draft state — a single
 * shared "editing" object in the parent would re-render every row on every
 * keystroke, and typing in one row would blank another.
 */
function ActionTypeRow({
  type,
  busy,
  onSave,
  onRemove,
}: {
  type: ActionType;
  busy: boolean;
  onSave: (id: number, name: string, category: string) => void;
  onRemove: (id: number) => void;
}) {
  const [name, setName] = useState(type.name);
  const [cat, setCat] = useState(type.category ?? "");

  const dirty = name !== type.name || cat !== (type.category ?? "");
  const box = "w-full rounded border border-hairline px-2 py-1 text-sm outline-none focus:border-accent";

  return (
    <tr className="border-b border-hairline/60">
      <td className="py-2 pr-3">
        <input value={name} onChange={(e) => setName(e.target.value)} className={box} />
      </td>
      <td className="py-2 pr-3">
        <input value={cat} onChange={(e) => setCat(e.target.value)} className={box} />
      </td>
      <td className="whitespace-nowrap py-2 text-right text-xs">
        {dirty && (
          <button
            onClick={() => onSave(type.id, name, cat)}
            disabled={busy}
            className="mr-3 text-accent underline"
          >
            Save
          </button>
        )}
        <button onClick={() => onRemove(type.id)} disabled={busy} className="text-bad underline">
          Remove
        </button>
      </td>
    </tr>
  );
}
