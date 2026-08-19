"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export type Note = {
  id: number;
  clinic_id: number | null;
  period_month: string | null;
  title: string;
  met_on: string;
  attendees: string | null;
  body: string | null;
  decisions: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
};

type ClinicLite = { id: number; name: string; status: string };
type Person = { id: string; full_name: string };

const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const blank = {
  title: "",
  met_on: new Date().toISOString().slice(0, 10),
  clinic_id: "",
  period_month: "",
  attendees: "",
  body: "",
  decisions: "",
};

export default function NotesClient({
  me,
  isAdmin,
  notes,
  clinics,
  people,
  months,
  initialClinic,
  initialMonth,
}: {
  me: string;
  isAdmin: boolean;
  notes: Note[];
  clinics: ClinicLite[];
  people: Person[];
  months: string[];
  initialClinic: string;
  initialMonth: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(notes.length ? notes[0].id : null);

  const [filterClinic, setFilterClinic] = useState(initialClinic);
  const [filterMonth, setFilterMonth] = useState(initialMonth);

  const [form, setForm] = useState({ ...blank });

  const clinicOf = new Map(clinics.map((c) => [c.id, c.name]));
  const nameOf = new Map(people.map((p) => [p.id, p.full_name]));

  async function run(label: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: `${label} failed: ${error.message}` });
      return false;
    }
    router.refresh();
    return true;
  }

  function payload() {
    return {
      title: form.title.trim(),
      met_on: form.met_on,
      clinic_id: form.clinic_id ? Number(form.clinic_id) : null,
      period_month: form.period_month ? `${form.period_month}-01` : null,
      attendees: form.attendees.trim() || null,
      body: form.body.trim() || null,
      decisions: form.decisions.trim() || null,
    };
  }

  async function save() {
    if (!form.title.trim() || !form.met_on) return;

    if (editing !== null) {
      const ok = await run("Saving note", () =>
        supabase
          .from("meeting_notes")
          .update({ ...payload(), updated_at: new Date().toISOString() })
          .eq("id", editing)
      );
      if (ok) {
        setEditing(null);
        setComposing(false);
        setForm({ ...blank });
        setMsg({ ok: true, text: "Note saved." });
      }
      return;
    }

    const ok = await run("Saving note", () =>
      supabase.from("meeting_notes").insert({ ...payload(), author_id: me })
    );
    if (ok) {
      setComposing(false);
      setForm({ ...blank });
      setMsg({ ok: true, text: "Note saved." });
    }
  }

  function startEdit(n: Note) {
    setForm({
      title: n.title,
      met_on: n.met_on,
      clinic_id: n.clinic_id ? String(n.clinic_id) : "",
      period_month: n.period_month ? n.period_month.slice(0, 7) : "",
      attendees: n.attendees ?? "",
      body: n.body ?? "",
      decisions: n.decisions ?? "",
    });
    setEditing(n.id);
    setComposing(true);
  }

  async function remove(id: number) {
    await run("Deleting note", () => supabase.from("meeting_notes").delete().eq("id", id));
  }

  const field =
    "w-full rounded-card border border-hairline bg-surface shadow-card px-3 py-2 text-sm outline-none focus:border-accent";
  const label = "block font-mono text-[11px] uppercase tracking-wider text-muted";
  const small = "rounded-card border border-hairline bg-surface shadow-card px-2 py-1 text-xs";

  const shown = notes.filter((n) => {
    if (filterClinic && String(n.clinic_id ?? "") !== filterClinic) return false;
    if (filterMonth && (n.period_month ?? "").slice(0, 7) !== filterMonth) return false;
    return true;
  });

  // Only clinics that actually have a note are worth offering as a filter.
  const clinicsWithNotes = clinics.filter((c) => notes.some((n) => n.clinic_id === c.id));
  const monthsWithNotes = Array.from(
    new Set(notes.map((n) => (n.period_month ?? "").slice(0, 7)).filter(Boolean))
  ).sort((a, b) => b.localeCompare(a));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={small}
            value={filterClinic}
            onChange={(e) => setFilterClinic(e.target.value)}
          >
            <option value="">All clinics</option>
            {clinicsWithNotes.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            className={small}
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
          >
            <option value="">All months</option>
            {monthsWithNotes.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>

          {(filterClinic || filterMonth) && (
            <button
              className="text-xs text-muted underline"
              onClick={() => {
                setFilterClinic("");
                setFilterMonth("");
              }}
            >
              Clear
            </button>
          )}
        </div>

        <button
          onClick={() => {
            setComposing((c) => !c);
            setEditing(null);
            setForm({ ...blank });
          }}
          className="rounded bg-accent px-3 py-1.5 text-sm text-white"
        >
          {composing ? "Cancel" : "New note"}
        </button>
      </div>

      {msg && (
        <p className={`mt-4 text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>
      )}

      {composing && (
        <div className="mt-5 rounded-card border border-hairline bg-surface shadow-card p-5">
          <h2 className="text-sm font-medium">
            {editing !== null ? "Edit note" : "New meeting note"}
          </h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label}>Title</label>
              <input
                className={`${field} mt-1`}
                placeholder="Monthly review with Rapid Rehab"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>

            <div>
              <label className={label}>Met on</label>
              <input
                type="date"
                className={`${field} mt-1`}
                value={form.met_on}
                onChange={(e) => setForm({ ...form, met_on: e.target.value })}
              />
            </div>

            <div>
              <label className={label}>Clinic</label>
              <select
                className={`${field} mt-1`}
                value={form.clinic_id}
                onChange={(e) => setForm({ ...form, clinic_id: e.target.value })}
              >
                <option value="">Not about one clinic</option>
                {clinics
                  .filter((c) => c.status === "active")
                  .map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className={label}>Month discussed</label>
              <select
                className={`${field} mt-1`}
                value={form.period_month}
                onChange={(e) => setForm({ ...form, period_month: e.target.value })}
              >
                <option value="">No particular month</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                The month the figures relate to, not the month you met.
              </p>
            </div>

            <div>
              <label className={label}>Attendees</label>
              <input
                className={`${field} mt-1`}
                placeholder="Monty, Michelle, clinic owner"
                value={form.attendees}
                onChange={(e) => setForm({ ...form, attendees: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2">
              <label className={label}>What was discussed</label>
              <textarea
                rows={5}
                className={`${field} mt-1`}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2">
              <label className={label}>What was agreed</label>
              <textarea
                rows={3}
                className={`${field} mt-1`}
                placeholder="Decisions and commitments — the part somebody will be held to."
                value={form.decisions}
                onChange={(e) => setForm({ ...form, decisions: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted">
                Kept separate from the discussion so it can be found again without reading the
                whole note. Turn any of it into a task on the Tasks page.
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              disabled={busy || !form.title.trim()}
              onClick={save}
              className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : editing !== null ? "Save changes" : "Save note"}
            </button>
            <button
              onClick={() => {
                setComposing(false);
                setEditing(null);
                setForm({ ...blank });
              }}
              className="text-sm text-muted underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-hairline bg-surface p-10 text-center">
          <h2 className="text-lg font-medium">
            {notes.length === 0 ? "No meeting notes yet" : "Nothing matches that filter"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            {notes.length === 0
              ? "This fills up with what was said in client meetings — who was there, what was discussed, and what was agreed — each one attached to a clinic and the month its figures cover."
              : "Try clearing the clinic or month filter."}
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {shown.map((n) => {
            const isOpen = open === n.id;
            const mine = n.author_id === me;
            return (
              <li key={n.id} className="rounded-card border border-hairline bg-surface shadow-card">
                <button
                  onClick={() => setOpen(isOpen ? null : n.id)}
                  className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
                >
                  <div>
                    <div className="font-medium">{n.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>{dayLabel(n.met_on)}</span>
                      {n.clinic_id && <span className="text-accent">{clinicOf.get(n.clinic_id)}</span>}
                      {n.period_month && <span>on {monthLabel(n.period_month.slice(0, 7))}</span>}
                      {n.author_id && <span>by {nameOf.get(n.author_id) ?? "—"}</span>}
                    </div>
                  </div>
                  <span className="mt-1 shrink-0 text-xs text-muted">{isOpen ? "▴" : "▾"}</span>
                </button>

                {isOpen && (
                  <div className="border-t border-hairline px-5 py-4">
                    {n.attendees && (
                      <p className="text-sm">
                        <span className={label}>Attendees</span>
                        <span className="mt-1 block">{n.attendees}</span>
                      </p>
                    )}

                    {n.body && (
                      <div className="mt-4">
                        <span className={label}>Discussed</span>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{n.body}</p>
                      </div>
                    )}

                    {n.decisions && (
                      <div className="mt-4 border-l-2 border-accent pl-3">
                        <span className={label}>Agreed</span>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                          {n.decisions}
                        </p>
                      </div>
                    )}

                    {!n.body && !n.decisions && !n.attendees && (
                      <p className="text-sm text-muted">No detail was recorded.</p>
                    )}

                    <div className="mt-5 flex flex-wrap items-center gap-4 text-xs">
                      {n.clinic_id && (
                        <Link
                          href={`/clinics/${n.clinic_id}${
                            n.period_month ? `?month=${n.period_month.slice(0, 7)}` : ""
                          }`}
                          className="text-accent underline"
                        >
                          Open {clinicOf.get(n.clinic_id)}
                          {n.period_month ? `, ${monthLabel(n.period_month.slice(0, 7))}` : ""}
                        </Link>
                      )}
                      <Link
                        href={`/tasks`}
                        className="text-muted underline hover:text-ink"
                      >
                        Raise a task from this
                      </Link>
                      {(mine || isAdmin) && (
                        <>
                          <button onClick={() => startEdit(n)} className="text-muted underline">
                            Edit
                          </button>
                          <button
                            onClick={() => remove(n.id)}
                            disabled={busy}
                            className="text-bad underline"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
