"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TableControls from "@/components/TableControls";

type Portal = {
  id: number;
  name: string;
  payer: string | null;
  url: string | null;
  kind: string;
  vault: string | null;
  vault_item: string | null;
  account_owner: string | null;
  who_has_access: string | null;
  login_hint: string | null;
  password_changed_on: string | null;
  rotation_days: number | null;
  mfa: string | null;
  note: string | null;
  is_active: boolean;
};

const KINDS = [
  ["payer", "Payer"],
  ["clearinghouse", "Clearing house"],
  ["state", "State / Medicaid"],
  ["hospital", "Hospital"],
  ["other", "Other"],
] as const;

const blank = {
  name: "",
  payer: "",
  url: "",
  kind: "payer",
  vault: "",
  vault_item: "",
  account_owner: "",
  who_has_access: "",
  login_hint: "",
  password_changed_on: "",
  rotation_days: "",
  mfa: "",
  note: "",
};

/** Days since a date, or null when there is no date. */
function daysSince(d: string | null) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(`${d}T12:00:00`).getTime()) / 86_400_000);
}

export default function PortalDirectory({
  canEdit,
  portals,
  links,
  clinics,
}: {
  canEdit: boolean;
  portals: Portal[];
  links: { portal_id: number; clinic_id: number }[];
  clinics: { id: number; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const clinicName = useMemo(() => new Map(clinics.map((c) => [c.id, c.name])), [clinics]);
  const clinicsFor = (portalId: number) =>
    links.filter((l) => l.portal_id === portalId).map((l) => clinicName.get(l.clinic_id) ?? "—");

  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  async function add() {
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("portals").insert({
      name: form.name.trim(),
      payer: form.payer.trim() || null,
      url: form.url.trim() || null,
      kind: form.kind,
      vault: form.vault.trim() || null,
      vault_item: form.vault_item.trim() || null,
      account_owner: form.account_owner.trim() || null,
      who_has_access: form.who_has_access.trim() || null,
      login_hint: form.login_hint.trim() || null,
      password_changed_on: form.password_changed_on || null,
      rotation_days: form.rotation_days ? Number(form.rotation_days) : null,
      mfa: form.mfa.trim() || null,
      note: form.note.trim() || null,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm({ ...blank });
    setAdding(false);
    router.refresh();
  }

  const field =
    "w-full rounded border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";

  const due = portals.filter((p) => {
    const d = daysSince(p.password_changed_on);
    return p.is_active && p.rotation_days && (d === null || d > p.rotation_days);
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Insurance portals</h1>
          <p className="mt-1 text-sm text-muted">
            Which portal, whose login, and when it was last changed.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded bg-accent px-3 py-1.5 text-sm text-white print:hidden"
          >
            {adding ? "Cancel" : "+ Add portal"}
          </button>
        )}
      </div>

      {/* The thing that must be said on this page, every time it is opened. */}
      <div className="mt-6 rounded-card border border-accent/30 bg-accentSoft px-4 py-3 text-sm">
        <strong>No passwords are stored here, on purpose.</strong> These logins reach patient data,
        and anything kept in this database can be read by anyone with the database — the access
        rules that protect the rest of the app do not protect a stored secret. Keep the passwords in
        a proper vault such as Bitwarden or 1Password; this page records which vault, who owns the
        account, and when it was last rotated.
      </div>

      {error && (
        <p className="mt-4 rounded-card border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {due.length > 0 && (
        <p className="mt-4 rounded-card border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
          {due.length} portal{due.length === 1 ? " is" : "s are"} past the rotation period set for
          them, or have never had a change recorded.
        </p>
      )}

      {adding && canEdit && (
        <div className="mt-5 rounded-card border border-hairline bg-surface p-5 shadow-card">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["name", "Portal name", "Availity, Navinet, Optum…"],
              ["payer", "Payer or owner", "Blue Shield of California"],
              ["url", "Web address", "https://…"],
              ["account_owner", "Account owner", "Who is responsible for it"],
              ["who_has_access", "Who has access", "AR team, Diana, Michelle"],
              ["login_hint", "How to sign in", "Group NPI as the username — never the password"],
              ["vault", "Vault", "Bitwarden — Billing collection"],
              ["vault_item", "Item name in the vault", "Availity — Back to Health"],
              ["mfa", "Second factor", "App on the office phone / SMS to front desk / none"],
            ].map(([k, label, ph]) => (
              <label key={k} className="block">
                <span className="eyebrow">{label}</span>
                <input
                  value={(form as Record<string, string>)[k]}
                  onChange={(e) => set(k, e.target.value)}
                  placeholder={ph}
                  className={`${field} mt-1`}
                />
              </label>
            ))}

            <label className="block">
              <span className="eyebrow">Kind</span>
              <select value={form.kind} onChange={(e) => set("kind", e.target.value)} className={`${field} mt-1`}>
                {KINDS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="eyebrow">Password last changed</span>
              <input
                type="date"
                value={form.password_changed_on}
                onChange={(e) => set("password_changed_on", e.target.value)}
                className={`${field} mt-1`}
              />
            </label>

            <label className="block">
              <span className="eyebrow">Change every (days)</span>
              <input
                type="number"
                min="0"
                value={form.rotation_days}
                onChange={(e) => set("rotation_days", e.target.value)}
                placeholder="90"
                className={`${field} mt-1`}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="eyebrow">Notes</span>
              <textarea
                rows={2}
                value={form.note}
                onChange={(e) => set("note", e.target.value)}
                placeholder="Anything the next person needs — but never the password."
                className={`${field} mt-1`}
              />
            </label>
          </div>

          <button
            onClick={add}
            disabled={busy || !form.name.trim()}
            className="mt-4 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save portal"}
          </button>
        </div>
      )}

      {portals.length === 0 ? (
        <p className="mt-8 rounded-card border border-dashed border-hairline bg-surface p-10 text-center text-sm text-muted">
          No portals recorded yet. This becomes the answer to &ldquo;which portal do I use for this
          clinic, and whose login is it&rdquo; — the question that currently costs somebody a
          message and a wait.
        </p>
      ) : (
        <>
          <div className="mt-6">
            <TableControls
              title="Insurance portals"
              rows={portals}
              columns={[
                { header: "Portal", value: (p) => p.name },
                { header: "Payer", value: (p) => p.payer ?? "" },
                { header: "Kind", value: (p) => p.kind },
                { header: "URL", value: (p) => p.url ?? "" },
                { header: "Account owner", value: (p) => p.account_owner ?? "" },
                { header: "Who has access", value: (p) => p.who_has_access ?? "" },
                { header: "Vault", value: (p) => [p.vault, p.vault_item].filter(Boolean).join(" / ") },
                { header: "Second factor", value: (p) => p.mfa ?? "" },
                { header: "Password changed", value: (p) => p.password_changed_on ?? "" },
                { header: "Days since", value: (p) => daysSince(p.password_changed_on) ?? "" },
                { header: "Clinics", value: (p) => clinicsFor(p.id).join("; ") },
              ]}
            />
          </div>

          <ul className="mt-4 space-y-3">
            {portals.map((p) => {
              const d = daysSince(p.password_changed_on);
              const overdue = p.rotation_days ? d === null || d > p.rotation_days : false;
              const isOpen = open === p.id;
              return (
                <li key={p.id} className="rounded-card border border-hairline bg-surface shadow-card">
                  <button
                    onClick={() => setOpen(isOpen ? null : p.id)}
                    className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
                  >
                    <div>
                      <span className="font-medium">{p.name}</span>
                      {p.payer && <span className="ml-2 text-sm text-muted">{p.payer}</span>}
                      <div className="mt-1 text-xs text-muted">
                        {clinicsFor(p.id).length
                          ? `${clinicsFor(p.id).length} clinic${clinicsFor(p.id).length === 1 ? "" : "s"}`
                          : "no clinics linked"}
                        {p.account_owner && ` · owned by ${p.account_owner}`}
                      </div>
                    </div>
                    <span className={`shrink-0 text-xs ${overdue ? "text-warn" : "text-muted"}`}>
                      {p.password_changed_on
                        ? `changed ${d} day${d === 1 ? "" : "s"} ago`
                        : "never recorded"}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="grid gap-4 border-t border-hairline px-5 py-4 text-sm sm:grid-cols-2">
                      {[
                        ["Web address", p.url],
                        ["How to sign in", p.login_hint],
                        ["Who has access", p.who_has_access],
                        ["Vault", [p.vault, p.vault_item].filter(Boolean).join(" / ")],
                        ["Second factor", p.mfa],
                        [
                          "Rotation",
                          p.rotation_days ? `every ${p.rotation_days} days` : "no rule set",
                        ],
                        ["Clinics", clinicsFor(p.id).join(", ")],
                        ["Notes", p.note],
                      ].map(([label, value]) => (
                        <div key={label as string}>
                          <div className="eyebrow">{label as string}</div>
                          <div className={value ? "mt-0.5" : "mt-0.5 text-muted"}>
                            {label === "Web address" && value ? (
                              <a
                                href={value as string}
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent underline"
                              >
                                {value as string}
                              </a>
                            ) : (
                              (value as string) || "—"
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
