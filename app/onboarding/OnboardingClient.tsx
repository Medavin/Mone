"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TableControls from "@/components/TableControls";

type Onboarding = {
  id: number;
  clinic_id: number;
  stage: string;
  cam_id: string | null;
  owner_id: string | null;
  old_billing_system: string | null;
  old_billing_agency: string | null;
  old_ar_accounts: number | null;
  old_ar_amount: number | null;
  pending_payments: number | null;
  transition_note: string | null;
  provider_count: number | null;
  first_contact_on: string | null;
  agreement_sent_on: string | null;
  agreement_signed_on: string | null;
  go_live_on: string | null;
  terms_note: string | null;
  communications: string | null;
  note: string | null;
};

type Step = {
  id: number;
  onboarding_id: number;
  label: string;
  category: string | null;
  sort_order: number;
  status: string;
  owner_id: string | null;
  due_on: string | null;
  done_on: string | null;
  note: string | null;
};

type Template = { id: number; label: string; category: string | null; sort_order: number };
type Location = { id: number; clinic_id: number; name: string; city: string | null; state: string | null; location_npi: string | null; is_primary: boolean; is_active: boolean };
type Payer = { id: number; clinic_id: number; payer_name: string; payer_id: string | null; in_network: boolean | null; effective_from: string | null };
type Clinic = { id: number; name: string; status: string; go_live_date: string | null };

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const STAGES = [
  ["prospect", "Prospect"],
  ["agreed", "Agreed"],
  ["in_transition", "In transition"],
  ["live", "Live"],
  ["on_hold", "On hold"],
  ["lost", "Lost"],
] as const;

const STEP_STATUS = ["todo", "in_progress", "done", "blocked", "not_needed"] as const;

/**
 * Bringing a new client on.
 *
 * This is a wrapper around a clinic, not a second copy of one. The name,
 * address, contacts, providers, work distribution, portals and documents all
 * live where they already live — this holds what is true about the TRANSITION
 * and nothing else, so nothing has to be copied anywhere the day they go live.
 *
 * The checklist is the answer to "where are we with Peak PT". A single status
 * word never survives that question; a list of steps does.
 */
export default function OnboardingClient({
  canEdit,
  records,
  clinics,
  people,
  steps,
  templates,
  locations,
  payers,
}: {
  canEdit: boolean;
  records: Onboarding[];
  clinics: Clinic[];
  people: { id: string; full_name: string; role: string }[];
  steps: Step[];
  templates: Template[];
  locations: Location[];
  payers: Payer[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(records.length ? records[0].id : null);
  const [adding, setAdding] = useState(false);
  const [newClinic, setNewClinic] = useState("");
  const [draft, setDraft] = useState<Record<number, Partial<Onboarding>>>({});
  const [newLoc, setNewLoc] = useState<Record<number, Record<string, string>>>({});
  const [newPayer, setNewPayer] = useState<Record<number, Record<string, string>>>({});

  const clinicName = useMemo(() => new Map(clinics.map((c) => [c.id, c.name])), [clinics]);
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.full_name])), [people]);

  const withoutOnboarding = clinics.filter((c) => !records.some((r) => r.clinic_id === c.id));

  const stepsFor = (id: number) => steps.filter((s) => s.onboarding_id === id);
  const progressOf = (id: number) => {
    const mine = stepsFor(id).filter((s) => s.status !== "not_needed");
    const done = mine.filter((s) => s.status === "done").length;
    return { done, total: mine.length, pct: mine.length ? (done / mine.length) * 100 : 0 };
  };

  /** Creating an onboarding also lays down the standard checklist, so nobody
   *  starts from a blank page and invents their own process. */
  async function create() {
    if (!newClinic) return;
    setBusy(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("client_onboarding")
      .insert({ clinic_id: Number(newClinic) })
      .select("id")
      .single();

    if (err || !data) {
      setBusy(false);
      setError(
        err?.message.includes("client_onboarding_clinic_id_key")
          ? "That clinic is already being onboarded."
          : err?.message ?? "Could not create it."
      );
      return;
    }

    if (templates.length) {
      await supabase.from("onboarding_steps").insert(
        templates.map((t) => ({
          onboarding_id: data.id as number,
          label: t.label,
          category: t.category,
          sort_order: t.sort_order,
        }))
      );
    }

    setBusy(false);
    setNewClinic("");
    setAdding(false);
    setOpen(data.id as number);
    router.refresh();
  }

  async function saveRecord(id: number) {
    const patch = draft[id];
    if (!patch || Object.keys(patch).length === 0) return;
    setBusy(true);
    const { error: err } = await supabase
      .from("client_onboarding")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    setBusy(false);
    if (err) setError(err.message);
    else {
      setDraft({ ...draft, [id]: {} });
      router.refresh();
    }
  }

  async function setStep(stepId: number, status: string) {
    setBusy(true);
    const { error: err } = await supabase
      .from("onboarding_steps")
      .update({
        status,
        done_on: status === "done" ? new Date().toISOString().slice(0, 10) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", stepId);
    setBusy(false);
    if (err) setError(err.message);
    else router.refresh();
  }

  async function addLocation(clinicId: number, obId: number) {
    const d = newLoc[obId] ?? {};
    if (!d.name?.trim()) return;
    setBusy(true);
    const { error: err } = await supabase.from("clinic_locations").insert({
      clinic_id: clinicId,
      name: d.name.trim(),
      city: d.city?.trim() || null,
      state: d.state?.trim() || null,
      location_npi: d.npi?.trim() || null,
    });
    setBusy(false);
    if (err) setError(err.message);
    else {
      setNewLoc({ ...newLoc, [obId]: {} });
      router.refresh();
    }
  }

  async function addPayer(clinicId: number, obId: number) {
    const d = newPayer[obId] ?? {};
    if (!d.payer_name?.trim()) return;
    setBusy(true);
    const { error: err } = await supabase.from("clinic_payers").insert({
      clinic_id: clinicId,
      payer_name: d.payer_name.trim(),
      payer_id: d.payer_id?.trim() || null,
      in_network: d.in_network === "" || d.in_network === undefined ? null : d.in_network === "yes",
    });
    setBusy(false);
    if (err) {
      setError(err.message.includes("clinic_payers_clinic_id_payer_name_key")
        ? "That payer is already listed for this clinic."
        : err.message);
    } else {
      setNewPayer({ ...newPayer, [obId]: {} });
      router.refresh();
    }
  }

  const set = (id: number, k: keyof Onboarding, v: string | number | null) =>
    setDraft({ ...draft, [id]: { ...(draft[id] ?? {}), [k]: v } });

  const field =
    "w-full rounded border border-hairline bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";

  const totalOldAr = records.reduce((t, r) => t + (r.old_ar_amount ?? 0), 0);
  const inFlight = records.filter((r) => r.stage === "agreed" || r.stage === "in_transition");

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Client onboarding</h1>
          <p className="mt-1 text-sm text-muted">
            Bringing a new client on: what they are coming from, and what is left to do.
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setAdding((v) => !v)} className="rounded bg-accent px-3 py-1.5 text-sm text-white print:hidden">
            {adding ? "Cancel" : "+ Start one"}
          </button>
        )}
      </div>

      <div className="mt-4 rounded-card border border-accent/30 bg-accentSoft px-4 py-3 text-sm">
        The client&apos;s name, address, contacts, providers, work distribution, portal logins and
        documents live on the clinic itself — this page holds only what is true about the move.
        Nothing has to be copied across on go-live day.
      </div>

      {error && (
        <p className="mt-4 rounded-card border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</p>
      )}

      {adding && canEdit && (
        <div className="mt-5 rounded-card border border-hairline bg-surface p-5 shadow-card">
          <p className="text-sm">
            Pick the clinic. <strong>Create it under Settings → Clinics first</strong> if it is not
            here — the clinic is the record everything else hangs from.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <select value={newClinic} onChange={(e) => setNewClinic(e.target.value)} className={`${field} max-w-xs`}>
              <option value="">Choose a clinic</option>
              {withoutOnboarding.map((c) => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </select>
            <button onClick={create} disabled={busy || !newClinic} className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">
              {busy ? "Creating…" : "Start onboarding"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            The standard {templates.length}-step checklist is added automatically, so nobody starts
            from a blank page and invents their own process.
          </p>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Clients", String(records.length)],
          ["In transition", String(inFlight.length)],
          ["Old A/R coming across", totalOldAr ? money(totalOldAr) : "—"],
          ["Live", String(records.filter((r) => r.stage === "live").length)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-card border border-hairline bg-surface px-4 py-3 shadow-card">
            <div className="eyebrow">{l}</div>
            <div className="tnum mt-1 text-lg font-medium">{v}</div>
          </div>
        ))}
      </div>

      {records.length === 0 ? (
        <p className="mt-8 rounded-card border border-dashed border-hairline bg-surface p-10 text-center text-sm text-muted">
          Nobody being onboarded yet. This is where a new client&apos;s transition lives — what they
          are leaving, what A/R comes with them, and what is still outstanding.
        </p>
      ) : (
        <>
          <div className="mt-6 flex justify-end print:hidden">
            <TableControls
              title="Client onboarding"
              rows={records}
              columns={[
                { header: "Client", value: (r) => clinicName.get(r.clinic_id) ?? "" },
                { header: "Stage", value: (r) => r.stage },
                { header: "CAM", value: (r) => (r.cam_id ? nameOf.get(r.cam_id) ?? "" : "") },
                { header: "Providers", value: (r) => r.provider_count ?? "" },
                { header: "Old system", value: (r) => r.old_billing_system ?? "" },
                { header: "Old agency", value: (r) => r.old_billing_agency ?? "" },
                { header: "Old A/R accounts", value: (r) => r.old_ar_accounts ?? "" },
                { header: "Old A/R amount", value: (r) => r.old_ar_amount ?? "" },
                { header: "Pending payments", value: (r) => r.pending_payments ?? "" },
                { header: "Agreement signed", value: (r) => r.agreement_signed_on ?? "" },
                { header: "Go live", value: (r) => r.go_live_on ?? "" },
                { header: "Steps done", value: (r) => `${progressOf(r.id).done}/${progressOf(r.id).total}` },
              ]}
            />
          </div>

          <table className="mt-3 w-full text-sm">
            <tbody>
              {records.map((r) => {
                const isOpen = open === r.id;
                const p = progressOf(r.id);
                const dirty = Object.keys(draft[r.id] ?? {}).length > 0;
                const myLocs = locations.filter((l) => l.clinic_id === r.clinic_id);
                const myPayers = payers.filter((x) => x.clinic_id === r.clinic_id);
                return (
                  <Fragment key={r.id}>
                    <tr className="border-b border-hairline/60">
                      <td className="py-3">
                        <button onClick={() => setOpen(isOpen ? null : r.id)} className="text-left font-medium hover:text-accent">
                          {clinicName.get(r.clinic_id) ?? "—"}
                        </button>
                        <div className="text-xs text-muted">
                          {[
                            STAGES.find(([v]) => v === r.stage)?.[1],
                            r.cam_id ? nameOf.get(r.cam_id) : null,
                            r.go_live_on ? `live ${r.go_live_on}` : null,
                          ].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="w-64 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded bg-canvas">
                            <div className="h-2 rounded bg-accent/70" style={{ width: `${p.pct}%` }} />
                          </div>
                          <span className="tnum text-xs text-muted">{p.done}/{p.total}</span>
                        </div>
                      </td>
                      <td className="py-3 text-right">
                        <button onClick={() => setOpen(isOpen ? null : r.id)} className="text-xs text-muted underline">
                          {isOpen ? "Close" : "Open"}
                        </button>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="border-b border-hairline/60 bg-canvas">
                        <td colSpan={3} className="p-4">
                          {/* ---- the transition facts ---- */}
                          <h3 className="eyebrow">Coming from</h3>
                          <div className="mt-2 grid gap-3 sm:grid-cols-4">
                            {([
                              ["old_billing_system", "Old billing system", "text"],
                              ["old_billing_agency", "Old billing agency", "text"],
                              ["old_ar_accounts", "Old A/R accounts", "number"],
                              ["old_ar_amount", "Old A/R amount", "number"],
                              ["pending_payments", "Pending payments", "number"],
                              ["provider_count", "Doctors / therapists", "number"],
                              ["first_contact_on", "First contact", "date"],
                              ["agreement_sent_on", "Agreement sent", "date"],
                              ["agreement_signed_on", "Agreement signed", "date"],
                              ["go_live_on", "Go live", "date"],
                            ] as const).map(([k, label, type]) => (
                              <label key={k} className="block">
                                <span className="eyebrow">{label}</span>
                                <input
                                  type={type}
                                  defaultValue={(r[k] as string | number | null) ?? ""}
                                  onChange={(e) =>
                                    set(r.id, k, type === "number"
                                      ? (e.target.value === "" ? null : Number(e.target.value))
                                      : e.target.value || null)
                                  }
                                  className={`${field} mt-1`}
                                />
                              </label>
                            ))}

                            <label className="block">
                              <span className="eyebrow">Stage</span>
                              <select defaultValue={r.stage} onChange={(e) => set(r.id, "stage", e.target.value)} className={`${field} mt-1`}>
                                {STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            </label>
                            <label className="block">
                              <span className="eyebrow">CAM</span>
                              <select defaultValue={r.cam_id ?? ""} onChange={(e) => set(r.id, "cam_id", e.target.value || null)} className={`${field} mt-1`}>
                                <option value="">—</option>
                                {people.map((pp) => <option key={pp.id} value={pp.id}>{pp.full_name}</option>)}
                              </select>
                            </label>

                            <label className="block sm:col-span-2">
                              <span className="eyebrow">Terms</span>
                              <input defaultValue={r.terms_note ?? ""} onChange={(e) => set(r.id, "terms_note", e.target.value || null)} placeholder="rate, term, notice period" className={`${field} mt-1`} />
                            </label>
                            <label className="block sm:col-span-2">
                              <span className="eyebrow">Communications</span>
                              <input defaultValue={r.communications ?? ""} onChange={(e) => set(r.id, "communications", e.target.value || null)} placeholder="how they want to be contacted" className={`${field} mt-1`} />
                            </label>
                            <label className="block sm:col-span-4">
                              <span className="eyebrow">Anything else worth knowing</span>
                              <textarea rows={2} defaultValue={r.note ?? ""} onChange={(e) => set(r.id, "note", e.target.value || null)} className={`${field} mt-1`} />
                            </label>
                          </div>

                          {canEdit && (
                            <button onClick={() => saveRecord(r.id)} disabled={busy || !dirty} className="mt-3 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">
                              Save
                            </button>
                          )}

                          {/* ---- where the rest lives ---- */}
                          <div className="mt-5 flex flex-wrap gap-3 text-xs">
                            <Link href={`/clinics/${r.clinic_id}?tab=profile`} className="rounded border border-hairline bg-surface px-3 py-1.5 text-accent hover:bg-canvas">
                              Contacts &amp; providers →
                            </Link>
                            <Link href="/assignments" className="rounded border border-hairline bg-surface px-3 py-1.5 text-accent hover:bg-canvas">
                              Work distribution →
                            </Link>
                            <Link href="/portals" className="rounded border border-hairline bg-surface px-3 py-1.5 text-accent hover:bg-canvas">
                              Insurance logins →
                            </Link>
                            <Link href="/files" className="rounded border border-hairline bg-surface px-3 py-1.5 text-accent hover:bg-canvas">
                              Agreement &amp; contracts →
                            </Link>
                          </div>

                          {/* ---- checklist ---- */}
                          <h3 className="eyebrow mt-6">What is left</h3>
                          <table className="mt-2 w-full text-sm">
                            <tbody>
                              {stepsFor(r.id).map((s) => (
                                <tr key={s.id} className="border-b border-hairline/50">
                                  <td className="py-1.5 pr-3">
                                    <span className={s.status === "done" ? "text-muted line-through" : ""}>{s.label}</span>
                                    {s.category && <span className="ml-2 text-[10px] text-muted">{s.category}</span>}
                                  </td>
                                  <td className="w-44 py-1.5">
                                    {canEdit ? (
                                      <select value={s.status} disabled={busy} onChange={(e) => setStep(s.id, e.target.value)} className="rounded border border-hairline px-1.5 py-1 text-xs">
                                        {STEP_STATUS.map((v) => <option key={v} value={v}>{v.replace("_", " ")}</option>)}
                                      </select>
                                    ) : (
                                      <span className="text-xs">{s.status.replace("_", " ")}</span>
                                    )}
                                  </td>
                                  <td className="w-24 py-1.5 text-right text-xs text-muted">{s.done_on ?? ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {/* ---- locations ---- */}
                          <h3 className="eyebrow mt-6">Locations</h3>
                          {myLocs.length === 0 && <p className="mt-1 text-sm text-muted">None recorded.</p>}
                          {myLocs.length > 0 && (
                            <ul className="mt-1 space-y-1 text-sm">
                              {myLocs.map((l) => (
                                <li key={l.id}>
                                  {l.name}
                                  {l.is_primary && <span className="ml-2 rounded bg-accentSoft px-1.5 py-0.5 text-[10px] text-accent">primary</span>}
                                  <span className="ml-2 text-xs text-muted">
                                    {[l.city, l.state, l.location_npi ? `NPI ${l.location_npi}` : null].filter(Boolean).join(" · ")}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {canEdit && (
                            <div className="mt-2 flex flex-wrap items-end gap-2">
                              {[["name", "Site name"], ["city", "City"], ["state", "State"], ["npi", "Location NPI"]].map(([k, ph]) => (
                                <input key={k} value={newLoc[r.id]?.[k] ?? ""} placeholder={ph}
                                  onChange={(e) => setNewLoc({ ...newLoc, [r.id]: { ...(newLoc[r.id] ?? {}), [k]: e.target.value } })}
                                  className={`${field} max-w-[10rem]`} />
                              ))}
                              <button onClick={() => addLocation(r.clinic_id, r.id)} disabled={busy} className="rounded border border-hairline bg-surface px-3 py-1.5 text-xs">
                                Add location
                              </button>
                            </div>
                          )}

                          {/* ---- payers ---- */}
                          <h3 className="eyebrow mt-6">In-network payers</h3>
                          {myPayers.length === 0 && <p className="mt-1 text-sm text-muted">None recorded.</p>}
                          {myPayers.length > 0 && (
                            <ul className="mt-1 space-y-1 text-sm">
                              {myPayers.map((x) => (
                                <li key={x.id}>
                                  {x.payer_name}
                                  <span className={`ml-2 text-xs ${x.in_network === true ? "text-good" : x.in_network === false ? "text-muted" : "text-warn"}`}>
                                    {x.in_network === true ? "in network" : x.in_network === false ? "out of network" : "not checked"}
                                  </span>
                                  {x.payer_id && <span className="ml-2 text-xs text-muted">{x.payer_id}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                          {canEdit && (
                            <div className="mt-2 flex flex-wrap items-end gap-2">
                              <input value={newPayer[r.id]?.payer_name ?? ""} placeholder="Payer"
                                onChange={(e) => setNewPayer({ ...newPayer, [r.id]: { ...(newPayer[r.id] ?? {}), payer_name: e.target.value } })}
                                className={`${field} max-w-[14rem]`} />
                              <input value={newPayer[r.id]?.payer_id ?? ""} placeholder="Payer ID"
                                onChange={(e) => setNewPayer({ ...newPayer, [r.id]: { ...(newPayer[r.id] ?? {}), payer_id: e.target.value } })}
                                className={`${field} max-w-[8rem]`} />
                              <select value={newPayer[r.id]?.in_network ?? ""}
                                onChange={(e) => setNewPayer({ ...newPayer, [r.id]: { ...(newPayer[r.id] ?? {}), in_network: e.target.value } })}
                                className={`${field} max-w-[10rem]`}>
                                <option value="">Not checked</option>
                                <option value="yes">In network</option>
                                <option value="no">Out of network</option>
                              </select>
                              <button onClick={() => addPayer(r.clinic_id, r.id)} disabled={busy} className="rounded border border-hairline bg-surface px-3 py-1.5 text-xs">
                                Add payer
                              </button>
                            </div>
                          )}
                          <p className="mt-2 text-xs text-muted">
                            &ldquo;Not checked&rdquo; is deliberately different from &ldquo;out of
                            network&rdquo; — one means nobody has looked yet, and that is worth
                            seeing.
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
