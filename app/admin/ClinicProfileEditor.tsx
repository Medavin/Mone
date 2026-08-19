"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type ClinicFull = {
  id: number;
  name: string;
  code: string | null;
  status: string;
  notes: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
  website: string | null;
  group_npi: string | null;
  tax_id: string | null;
  amd_office_key: string | null;
  specialty: string | null;
  profile_note: string | null;
};

export type ClinicPerson = {
  id: number;
  clinic_id: number;
  kind: string;
  full_name: string;
  title: string | null;
  credential: string | null;
  npi: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  is_active: boolean;
  note: string | null;
};

const KINDS = [
  ["contact", "Contact"],
  ["owner", "Owner"],
  ["billing", "Billing"],
  ["front_desk", "Front desk"],
  ["provider", "Provider / doctor"],
  ["other", "Other"],
] as const;

const FIELDS: [keyof ClinicFull, string, string][] = [
  ["address_line1", "Address", "1234 Main Street"],
  ["address_line2", "Address line 2", "Suite 200"],
  ["city", "City", ""],
  ["state", "State", "CA"],
  ["postal_code", "ZIP", ""],
  ["phone", "Phone", ""],
  ["fax", "Fax", ""],
  ["email", "Email", ""],
  ["website", "Website", "https://…"],
  ["specialty", "Specialty", "Physical therapy"],
  ["group_npi", "Group NPI", ""],
  ["tax_id", "Tax ID", ""],
  ["amd_office_key", "AdvancedMD office key", "used later to match the ODBC feed"],
];

/**
 * Where the clinic's own details and its people are entered.
 *
 * The Profile tab on the clinic page can only ever show blanks without this —
 * a read-only screen with no way to fill it is worse than no screen, because
 * it looks broken rather than empty.
 */
export default function ClinicProfileEditor({
  clinics,
  people,
}: {
  clinics: ClinicFull[];
  people: ClinicPerson[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState<Record<number, Partial<ClinicFull>>>({});
  const [newPerson, setNewPerson] = useState<Record<number, Record<string, string>>>({});

  const field =
    "w-full rounded border border-hairline bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";

  async function saveClinic(id: number) {
    const patch = draft[id];
    if (!patch || Object.keys(patch).length === 0) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from("clinics").update(patch).eq("id", id);
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
      return;
    }
    setDraft({ ...draft, [id]: {} });
    setMsg({ ok: true, text: "Saved." });
    router.refresh();
  }

  async function addPerson(clinicId: number) {
    const p = newPerson[clinicId] ?? {};
    if (!p.full_name?.trim()) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from("clinic_people").insert({
      clinic_id: clinicId,
      kind: p.kind || "contact",
      full_name: p.full_name.trim(),
      credential: p.credential?.trim() || null,
      title: p.title?.trim() || null,
      npi: p.npi?.trim() || null,
      email: p.email?.trim() || null,
      phone: p.phone?.trim() || null,
      is_primary: p.is_primary === "yes",
    });
    setBusy(false);
    if (error) {
      // The one-primary-per-kind index is the likeliest rejection, and the
      // raw Postgres message would not tell him what to do about it.
      setMsg({
        ok: false,
        text: error.message.includes("clinic_people_one_primary")
          ? "There is already a primary for that kind at this clinic. Clear the other one first."
          : error.message,
      });
      return;
    }
    setNewPerson({ ...newPerson, [clinicId]: {} });
    router.refresh();
  }

  async function updatePerson(id: number, patch: Partial<ClinicPerson>) {
    setBusy(true);
    const { error } = await supabase.from("clinic_people").update(patch).eq("id", id);
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
    else router.refresh();
  }

  async function removePerson(id: number) {
    setBusy(true);
    const { error } = await supabase.from("clinic_people").delete().eq("id", id);
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
    else router.refresh();
  }

  const setField = (id: number, key: keyof ClinicFull, value: string) =>
    setDraft({ ...draft, [id]: { ...(draft[id] ?? {}), [key]: value || null } });

  const setPersonField = (clinicId: number, key: string, value: string) =>
    setNewPerson({
      ...newPerson,
      [clinicId]: { ...(newPerson[clinicId] ?? {}), [key]: value },
    });

  return (
    <section>
      <h2 className="text-base font-medium">Clinic details and people</h2>
      <p className="mt-1 text-sm text-muted">
        The address, contacts and treating providers shown on each clinic&apos;s Profile tab. None of
        this comes from the monthly pack — the pack carries figures and nothing else.
      </p>

      {msg && (
        <p className={`mt-3 text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>
      )}

      <table className="mt-4 w-full text-sm">
        <tbody>
          {clinics.map((c) => {
            const mine = people.filter((p) => p.clinic_id === c.id);
            const isOpen = open === c.id;
            const dirty = Object.keys(draft[c.id] ?? {}).length > 0;
            return (
              <Fragment key={c.id}>
                <tr className="border-b border-hairline/60">
                  <td className="py-2">
                    <button
                      onClick={() => setOpen(isOpen ? null : c.id)}
                      className="text-left hover:text-accent"
                    >
                      {c.name}
                    </button>
                    <div className="text-xs text-muted">
                      {[c.city, c.state].filter(Boolean).join(", ") || "no address yet"}
                      {mine.length > 0 && ` · ${mine.length} ${mine.length === 1 ? "person" : "people"}`}
                    </div>
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => setOpen(isOpen ? null : c.id)}
                      className="rounded border border-hairline px-2 py-1 text-xs text-muted hover:text-ink"
                    >
                      {isOpen ? "Close" : "Edit details"}
                    </button>
                  </td>
                </tr>

                {isOpen && (
                  <tr className="border-b border-hairline/60 bg-canvas">
                    <td colSpan={2} className="p-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        {FIELDS.map(([key, label, ph]) => (
                          <label key={key as string} className="block">
                            <span className="eyebrow">{label}</span>
                            <input
                              defaultValue={(c[key] as string) ?? ""}
                              placeholder={ph}
                              onChange={(e) => setField(c.id, key, e.target.value)}
                              className={`${field} mt-1`}
                            />
                          </label>
                        ))}
                        <label className="block sm:col-span-3">
                          <span className="eyebrow">Notes for the profile page</span>
                          <textarea
                            rows={2}
                            defaultValue={c.profile_note ?? ""}
                            onChange={(e) => setField(c.id, "profile_note", e.target.value)}
                            className={`${field} mt-1`}
                          />
                        </label>
                      </div>

                      <button
                        onClick={() => saveClinic(c.id)}
                        disabled={busy || !dirty}
                        className="mt-3 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
                      >
                        {busy ? "Saving…" : "Save details"}
                      </button>

                      {/* ---- people ---- */}
                      <h3 className="eyebrow mt-6">People at this clinic</h3>

                      {mine.length > 0 && (
                        <table className="mt-2 w-full text-sm">
                          <tbody>
                            {mine.map((p) => (
                              <tr key={p.id} className="border-b border-hairline/50">
                                <td className="py-1.5 pr-3">
                                  <span className="font-medium">{p.full_name}</span>
                                  {p.credential && (
                                    <span className="ml-1 text-muted">{p.credential}</span>
                                  )}
                                  <div className="text-xs text-muted">
                                    {[p.title, p.email, p.phone].filter(Boolean).join(" · ")}
                                  </div>
                                </td>
                                <td className="py-1.5 pr-3">
                                  <select
                                    defaultValue={p.kind}
                                    onChange={(e) => updatePerson(p.id, { kind: e.target.value })}
                                    className="rounded border border-hairline px-1.5 py-1 text-xs"
                                  >
                                    {KINDS.map(([v, l]) => (
                                      <option key={v} value={v}>
                                        {l}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-1.5 pr-3 text-xs">
                                  <label className="flex items-center gap-1">
                                    <input
                                      type="checkbox"
                                      defaultChecked={p.is_active}
                                      onChange={(e) =>
                                        updatePerson(p.id, { is_active: e.target.checked })
                                      }
                                    />
                                    active
                                  </label>
                                </td>
                                <td className="py-1.5 text-right">
                                  <button
                                    onClick={() => removePerson(p.id)}
                                    disabled={busy}
                                    className="text-xs text-bad underline"
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}

                      <div className="mt-3 grid gap-2 sm:grid-cols-6">
                        <select
                          value={newPerson[c.id]?.kind ?? "contact"}
                          onChange={(e) => setPersonField(c.id, "kind", e.target.value)}
                          className={field}
                        >
                          {KINDS.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                        {[
                          ["full_name", "Name"],
                          ["credential", "PT, DPT, MD"],
                          ["title", "Title"],
                          ["npi", "NPI"],
                          ["email", "Email"],
                          ["phone", "Phone"],
                        ].map(([k, ph]) => (
                          <input
                            key={k}
                            value={newPerson[c.id]?.[k] ?? ""}
                            onChange={(e) => setPersonField(c.id, k, e.target.value)}
                            placeholder={ph}
                            className={field}
                          />
                        ))}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-xs text-muted">
                          <input
                            type="checkbox"
                            checked={newPerson[c.id]?.is_primary === "yes"}
                            onChange={(e) =>
                              setPersonField(c.id, "is_primary", e.target.checked ? "yes" : "")
                            }
                          />
                          This is the primary for that kind
                        </label>
                        <button
                          onClick={() => addPerson(c.id)}
                          disabled={busy || !newPerson[c.id]?.full_name?.trim()}
                          className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40"
                        >
                          Add person
                        </button>
                      </div>

                      <p className="mt-2 text-xs text-muted">
                        Somebody who leaves should be unticked rather than removed — a provider who
                        treated patients last year still explains last year&apos;s claims.
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
