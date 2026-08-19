"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type Employee = {
  id: number;
  profile_id: string | null;
  full_name: string;
  email: string | null;
  job_title: string | null;
  department: string | null;
  landing_page: string;
  intended_role: string;
  default_location: string;
  region: string | null;
  manager_id: number | null;
  started_on: string | null;
  ended_on: string | null;
  status: string;
  note: string | null;
};

type ProfileLite = { id: string; full_name: string; email: string; role: string };

const LANDING = [
  ["dashboard", "Portfolio — the executive view"],
  ["operations", "Operations"],
  ["cam", "My clinics (account manager)"],
  ["clinics", "Clinic list"],
  ["people", "People"],
  ["guest", "Guest view"],
] as const;

const ROLES = [
  ["exec", "Executive — sees everything, read-heavy"],
  ["ops", "Operations — sees every clinic and the team"],
  ["cam", "Account manager — only their own clinics"],
  ["agent", "Agent — works accounts"],
  ["admin", "Administrator — full control including settings"],
  ["guest", "Guest — restricted"],
] as const;

const STATUS = ["active", "on_leave", "notice", "left"] as const;

export default function EmployeeManager({
  employees,
  profiles,
  rates = [],
}: {
  employees: Employee[];
  profiles: ProfileLite[];
  rates?: { employee_id: number; hourly_rate: number; currency: string; effective_from: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(employees.length === 0);
  const [rateDraft, setRateDraft] = useState<Record<number, { rate: string; from: string }>>({});

  /** The rate in force today: the latest one that has already started. */
  function currentRate(employeeId: number) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = rates
      .filter((r) => r.employee_id === employeeId && r.effective_from <= today)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    return rows[0] ?? null;
  }

  async function saveRate(employeeId: number) {
    const draft = rateDraft[employeeId];
    if (!draft?.rate) return;
    const value = Number(draft.rate);
    if (!Number.isFinite(value) || value < 0) {
      setMsg({ ok: false, text: "That rate is not a number." });
      return;
    }
    setBusy(true);
    setMsg(null);
    // A NEW ROW, never an update: a rate is dated, so last month keeps last
    // month's price after a raise. Same date twice simply replaces that date.
    const { error } = await supabase.from("employee_rates").upsert(
      {
        employee_id: employeeId,
        hourly_rate: value,
        effective_from: draft.from || new Date().toISOString().slice(0, 10),
      },
      { onConflict: "employee_id,effective_from" }
    );
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: `Saving rate: ${error.message}` });
      return;
    }
    setMsg({ ok: true, text: "Rate saved." });
    setRateDraft({ ...rateDraft, [employeeId]: { rate: "", from: "" } });
    router.refresh();
  }
  const [showLeft, setShowLeft] = useState(false);

  const blank = {
    full_name: "",
    email: "",
    job_title: "",
    department: "",
    landing_page: "dashboard",
    intended_role: "agent",
    default_location: "office",
    region: "",
    manager_id: "",
    started_on: "",
    status: "active",
    note: "",
  };
  const [form, setForm] = useState({ ...blank });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function run(label: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
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

  async function add() {
    if (!form.full_name.trim()) return;
    const ok = await run("Adding employee", () =>
      supabase.from("employees").insert({
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        job_title: form.job_title.trim() || null,
        department: form.department.trim() || null,
        landing_page: form.landing_page,
        intended_role: form.intended_role,
        default_location: form.default_location,
        region: form.region.trim() || null,
        manager_id: form.manager_id ? Number(form.manager_id) : null,
        started_on: form.started_on || null,
        status: form.status,
        note: form.note.trim() || null,
      })
    );
    if (ok) {
      setForm({ ...blank });
      setShowAdd(false);
    }
  }

  async function update(id: number, patch: Record<string, unknown>) {
    await run("Updating employee", () =>
      supabase.from("employees").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id)
    );
  }

  async function linkProfile(id: number, profileId: string, intendedRole: string) {
    setBusy(true);
    setMsg(null);
    const { error: e1 } = await supabase
      .from("employees")
      .update({ profile_id: profileId || null })
      .eq("id", id);

    // The profile's own role is what the database enforces, so linking also
    // applies the intended role rather than leaving the two disagreeing.
    let e2: { message: string } | null = null;
    if (profileId) {
      const r = await supabase.from("profiles").update({ role: intendedRole }).eq("id", profileId);
      e2 = r.error;
    }
    setBusy(false);
    if (e1 || e2) {
      setMsg({ ok: false, text: `Linking failed: ${(e1 ?? e2)!.message}` });
      return;
    }
    setMsg({ ok: true, text: "Login linked and role applied." });
    router.refresh();
  }

  const field = "rounded-card border border-hairline bg-surface shadow-card px-3 py-2 text-sm outline-none focus:border-accent";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";

  const linkedProfileIds = new Set(employees.map((e) => e.profile_id).filter(Boolean));
  const unlinkedProfiles = profiles.filter((p) => !linkedProfileIds.has(p.id));
  const managers = employees.filter((e) => e.status !== "left");
  const shown = employees.filter((e) => (showLeft ? true : e.status !== "left"));
  const nameById = new Map(employees.map((e) => [e.id, e.full_name]));
  const landingLabel = new Map(LANDING as unknown as [string, string][]);

  return (
    <div className="space-y-8">
      {msg && (
        <p
          className={`rounded border p-3 text-sm ${
            msg.ok ? "border-good/30 bg-good/5 text-good" : "border-bad/30 bg-bad/5 text-bad"
          }`}
        >
          {msg.text}
        </p>
      )}

      {unlinkedProfiles.length > 0 && (
        <p className="rounded border border-warn/30 bg-warn/5 p-3 text-sm text-warn">
          {unlinkedProfiles.length} {unlinkedProfiles.length === 1 ? "login has" : "logins have"} no
          employee record: {unlinkedProfiles.map((p) => p.full_name).join(", ")}. Add them below, or
          link an existing row.
        </p>
      )}

      {/* ---- add ---- */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-medium">Add an employee</h2>
          {/* A real button. This was a tiny "Show form" text link next to a
              muted uppercase label, and it read as plain text — Pravin could
              not tell there was anything to click. */}
          <button
            onClick={() => setShowAdd(!showAdd)}
            className={
              showAdd
                ? "rounded border border-hairline px-3 py-1.5 text-sm hover:bg-canvas"
                : "rounded bg-accent px-4 py-2 text-sm text-white hover:brightness-110"
            }
          >
            {showAdd ? "Cancel" : "+ Add employee"}
          </button>
        </div>

        {showAdd && (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-muted">Full name</span>
                <input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} className={`mt-1 w-full ${field}`} />
              </label>
              <label className="block">
                <span className="text-xs text-muted">Work email</span>
                <input value={form.email} onChange={(e) => set("email", e.target.value)} className={`mt-1 w-full ${field}`} />
              </label>
              <label className="block">
                <span className="text-xs text-muted">Job title</span>
                <input value={form.job_title} onChange={(e) => set("job_title", e.target.value)} className={`mt-1 w-full ${field}`} />
              </label>
              <label className="block">
                <span className="text-xs text-muted">Department</span>
                <input value={form.department} onChange={(e) => set("department", e.target.value)} className={`mt-1 w-full ${field}`} />
              </label>

              <label className="block">
                <span className="text-xs text-muted">Role</span>
                <select value={form.intended_role} onChange={(e) => set("intended_role", e.target.value)} className={`mt-1 w-full ${field}`}>
                  {ROLES.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted">Lands on</span>
                <select value={form.landing_page} onChange={(e) => set("landing_page", e.target.value)} className={`mt-1 w-full ${field}`}>
                  {LANDING.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-muted">Usually works from</span>
                <select value={form.default_location} onChange={(e) => set("default_location", e.target.value)} className={`mt-1 w-full ${field}`}>
                  <option value="office">Office</option>
                  <option value="home">Home</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted">Region (for the clocks)</span>
                <input
                  value={form.region}
                  onChange={(e) => set("region", e.target.value)}
                  placeholder="e.g. Dehradun, or Las Vegas"
                  className={`mt-1 w-full ${field}`}
                />
              </label>

              <label className="block">
                <span className="text-xs text-muted">Reports to</span>
                <select value={form.manager_id} onChange={(e) => set("manager_id", e.target.value)} className={`mt-1 w-full ${field}`}>
                  <option value="">—</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted">Started on</span>
                <input type="date" value={form.started_on} onChange={(e) => set("started_on", e.target.value)} className={`mt-1 w-full ${field}`} />
              </label>

              <label className="block sm:col-span-2">
                <span className="text-xs text-muted">Note</span>
                <input value={form.note} onChange={(e) => set("note", e.target.value)} className={`mt-1 w-full ${field}`} />
              </label>
            </div>

            <button
              onClick={add}
              disabled={busy || !form.full_name.trim()}
              className="mt-3 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Add employee
            </button>
            <p className="mt-2 text-xs text-muted">
              This creates the employee record, not a login. Create the login in Supabase under
              Authentication → Users, then link it from the list below — at which point the role above
              is applied and they can sign in and punch a clock.
            </p>
          </>
        )}
      </section>

      {/* ---- list ---- */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className={thL}>
            The team ({shown.length}
            {employees.length !== shown.length ? ` of ${employees.length}` : ""})
          </h2>
          {employees.some((e) => e.status === "left") && (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
              Include people who have left
            </label>
          )}
        </div>

        {shown.length === 0 ? (
          <p className="mt-3 rounded border border-dashed border-hairline px-4 py-8 text-center text-sm text-muted">
            No employees yet. Add the first one above.
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thL}>Name</th>
                <th className={thL}>Role</th>
                <th className={thL}>Lands on</th>
                <th className={thL}>Login</th>
                <th className={thL}>Status</th>
                <th className={thL}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <Fragment key={e.id}>
                  <tr className="border-b border-hairline/60">
                    <td className="py-2">
                      <div className="font-medium">{e.full_name}</div>
                      <div className="text-xs text-muted">
                        {[e.job_title, e.department, e.region].filter(Boolean).join(" · ") || "—"}
                        {e.manager_id && ` · reports to ${nameById.get(e.manager_id) ?? "—"}`}
                      </div>
                    </td>
                    <td className="py-2 text-muted">{e.intended_role}</td>
                    <td className="py-2 text-muted">
                      {landingLabel.get(e.landing_page)?.split(" — ")[0] ?? e.landing_page}
                    </td>
                    <td className="py-2">
                      {e.profile_id ? (
                        <span className="text-good">linked</span>
                      ) : (
                        <span className="text-muted">none</span>
                      )}
                    </td>
                    <td className="py-2">
                      <select
                        value={e.status}
                        onChange={(ev) => update(e.id, { status: ev.target.value })}
                        className="rounded-card border border-hairline bg-surface shadow-card px-2 py-1 text-xs"
                      >
                        {STATUS.map((s) => (
                          <option key={s} value={s}>
                            {s.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => setEditing(editing === e.id ? null : e.id)}
                        className="text-xs text-accent hover:underline"
                      >
                        {editing === e.id ? "Close" : "Edit"}
                      </button>
                    </td>
                  </tr>

                  {editing === e.id && (
                    <tr className="border-b border-hairline/60 bg-canvas">
                      <td colSpan={6} className="p-4">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <label className="block">
                            <span className="text-xs text-muted">Role</span>
                            <select
                              defaultValue={e.intended_role}
                              onChange={(ev) => update(e.id, { intended_role: ev.target.value })}
                              className={`mt-1 w-full ${field}`}
                            >
                              {ROLES.map(([v, label]) => (
                                <option key={v} value={v}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="block sm:col-span-3">
                            <span className="text-xs text-muted">Hourly rate</span>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="tnum text-sm">
                                {currentRate(e.id)
                                  ? `Currently ${currentRate(e.id)!.currency} ${Number(
                                      currentRate(e.id)!.hourly_rate
                                    ).toFixed(2)} from ${currentRate(e.id)!.effective_from}`
                                  : "No rate set"}
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="New rate"
                                value={rateDraft[e.id]?.rate ?? ""}
                                onChange={(ev) =>
                                  setRateDraft({
                                    ...rateDraft,
                                    [e.id]: { rate: ev.target.value, from: rateDraft[e.id]?.from ?? "" },
                                  })
                                }
                                className={`${field} w-28`}
                              />
                              <input
                                type="date"
                                title="The date this rate starts"
                                value={rateDraft[e.id]?.from ?? ""}
                                onChange={(ev) =>
                                  setRateDraft({
                                    ...rateDraft,
                                    [e.id]: { rate: rateDraft[e.id]?.rate ?? "", from: ev.target.value },
                                  })
                                }
                                className={field}
                              />
                              <button
                                onClick={() => saveRate(e.id)}
                                disabled={busy || !rateDraft[e.id]?.rate}
                                className="rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-40"
                              >
                                Save rate
                              </button>
                            </div>
                            <p className="mt-1 text-xs text-muted">
                              Rates are kept as a history, so a raise does not re-price a month you
                              have already invoiced. Leave the date blank to start today.
                            </p>
                          </div>

                          <label className="block">
                            <span className="text-xs text-muted">Lands on</span>
                            <select
                              defaultValue={e.landing_page}
                              onChange={(ev) => update(e.id, { landing_page: ev.target.value })}
                              className={`mt-1 w-full ${field}`}
                            >
                              {LANDING.map(([v, label]) => (
                                <option key={v} value={v}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-xs text-muted">Usually works from</span>
                            <select
                              defaultValue={e.default_location}
                              onChange={(ev) => update(e.id, { default_location: ev.target.value })}
                              className={`mt-1 w-full ${field}`}
                            >
                              <option value="office">Office</option>
                              <option value="home">Home</option>
                            </select>
                          </label>

                          <label className="block sm:col-span-2">
                            <span className="text-xs text-muted">Link a login</span>
                            <select
                              defaultValue={e.profile_id ?? ""}
                              onChange={(ev) => linkProfile(e.id, ev.target.value, e.intended_role)}
                              className={`mt-1 w-full ${field}`}
                            >
                              <option value="">Not linked</option>
                              {profiles
                                .filter((p) => p.id === e.profile_id || !linkedProfileIds.has(p.id))
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.full_name} · {p.email}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-xs text-muted">Left on</span>
                            <input
                              type="date"
                              defaultValue={e.ended_on ?? ""}
                              onChange={(ev) => update(e.id, { ended_on: ev.target.value || null })}
                              className={`mt-1 w-full ${field}`}
                            />
                          </label>
                        </div>
                        <p className="mt-3 text-xs text-muted">
                          Linking a login also applies the role above to that account, so the two cannot
                          drift apart. Employees are never deleted — mark them as left and the record
                          keeps its history.
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
