"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { notifyUser, notifyManagement } from "@/lib/notify";

export type Task = {
  id: number;
  title: string;
  detail: string | null;
  clinic_id: number | null;
  flag_id: number | null;
  assigned_to: string | null;
  assigned_team: string | null;
  created_by: string | null;
  due_on: string | null;
  priority: string;
  status: string;
  completed_at: string | null;
};

export type Flag = {
  id: number;
  clinic_id: number;
  reason: string;
  detail: string | null;
  severity: string;
  status: string;
  period_month: string | null;
  raised_by: string | null;
  raised_at: string;
  resolution: string | null;
};

type Person = { id: string; full_name: string };
type ClinicLite = { id: number; name: string };

const STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const;
const PRIORITIES = ["low", "normal", "high"] as const;
const SEVERITIES = ["watch", "concern", "urgent"] as const;

const SEVERITY_TONE: Record<string, string> = {
  watch: "border-l-muted",
  concern: "border-l-warn",
  urgent: "border-l-bad",
};

export default function TasksClient({
  me,
  tasks,
  flags,
  people,
  clinics,
  teams,
}: {
  me: string;
  tasks: Task[];
  flags: Flag[];
  people: Person[];
  clinics: ClinicLite[];
  teams: string[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [view, setView] = useState<"inward" | "outward" | "all" | "flags">("inward");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [composing, setComposing] = useState(false);

  const [task, setTask] = useState({
    title: "",
    detail: "",
    clinic_id: "",
    assigned_to: "",
    assigned_team: "",
    due_on: "",
    priority: "normal",
  });

  const [flag, setFlag] = useState({ clinic_id: "", reason: "", detail: "", severity: "watch" });

  const nameOf = new Map(people.map((p) => [p.id, p.full_name]));
  const clinicOf = new Map(clinics.map((c) => [c.id, c.name]));

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

  async function addTask() {
    if (!task.title.trim()) return;
    const ok = await run("Creating task", () =>
      supabase.from("tasks").insert({
        title: task.title.trim(),
        detail: task.detail.trim() || null,
        clinic_id: task.clinic_id ? Number(task.clinic_id) : null,
        assigned_to: task.assigned_to || null,
        assigned_team: task.assigned_team.trim() || null,
        due_on: task.due_on || null,
        priority: task.priority,
        created_by: me,
      })
    );
    if (ok) {
      // Told, not left to be discovered. Assigning to yourself is not news.
      if (task.assigned_to && task.assigned_to !== me) {
        await notifyUser(supabase, {
          to: task.assigned_to,
          kind: "task_assigned",
          title: task.title.trim(),
          body: task.due_on ? `Due ${task.due_on}` : undefined,
          link: "/tasks",
          actorName: nameOf.get(me) ?? undefined,
        });
      }
      setTask({
        title: "",
        detail: "",
        clinic_id: "",
        assigned_to: "",
        assigned_team: "",
        due_on: "",
        priority: "normal",
      });
    }
  }

  async function setStatus(id: number, status: string) {
    await run("Updating", () =>
      supabase
        .from("tasks")
        .update({
          status,
          completed_at: status === "done" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
    );
  }

  async function addFlag() {
    if (!flag.clinic_id || !flag.reason.trim()) return;
    const ok = await run("Raising flag", () =>
      supabase.from("clinic_flags").insert({
        clinic_id: Number(flag.clinic_id),
        reason: flag.reason.trim(),
        detail: flag.detail.trim() || null,
        severity: flag.severity,
        raised_by: me,
      })
    );
    if (ok) {
      // A flag has no single owner, so it goes to whoever manages the place.
      // The dedupe key stops the same clinic and reason piling up.
      await notifyManagement(supabase, {
        kind: "flag_raised",
        title: `${clinicOf.get(Number(flag.clinic_id)) ?? "A clinic"} flagged: ${flag.reason.trim()}`,
        body: flag.detail.trim() || undefined,
        link: "/tasks?view=flags",
        dedupeKey: `flag:${flag.clinic_id}:${flag.reason.trim().toLowerCase()}`,
      });
      setFlag({ clinic_id: "", reason: "", detail: "", severity: "watch" });
    }
  }

  async function resolveFlag(id: number) {
    await run("Resolving", () =>
      supabase
        .from("clinic_flags")
        .update({ status: "resolved", resolved_by: me, resolved_at: new Date().toISOString() })
        .eq("id", id)
    );
  }

  const field =
    "rounded-card border border-hairline bg-surface shadow-card px-3 py-2 text-sm outline-none focus:border-accent";
  const small = "rounded-card border border-hairline bg-surface shadow-card px-2 py-1 text-xs";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";

  const inward = tasks.filter((t) => t.assigned_to === me);
  const outward = tasks.filter((t) => t.created_by === me && t.assigned_to !== me);
  const openFlags = flags.filter((f) => f.status === "open");

  const list =
    view === "inward" ? inward : view === "outward" ? outward : view === "all" ? tasks : [];
  const shown = list.filter((t) => showDone || !["done", "cancelled"].includes(t.status));

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <nav className="flex flex-wrap gap-1 border-b border-hairline">
        {[
          ["inward", `Assigned to me (${inward.filter((t) => t.status !== "done").length})`],
          ["outward", `I assigned (${outward.filter((t) => t.status !== "done").length})`],
          ["all", `All tasks (${tasks.filter((t) => t.status !== "done").length})`],
          ["flags", `Flagged clinics (${openFlags.length})`],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k as typeof view)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              view === k
                ? "border-accent font-medium text-ink"
                : "border-transparent text-muted hover:text-ink"
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

      {view !== "flags" ? (
        <div className="mt-6 space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {view === "inward"
                ? "Work other people have given you."
                : view === "outward"
                  ? "Work you have given other people. You still see it move as they update it."
                  : "Everything you have visibility of."}
            </p>
            <button
              onClick={() => setComposing(!composing)}
              className="rounded bg-accent px-3 py-1.5 text-sm text-white"
            >
              {composing ? "Cancel" : "New task"}
            </button>
          </div>

          {composing && (
          <section className="rounded-card border border-hairline bg-surface shadow-card p-4">
            <h2 className={thL}>Send work to someone</h2>
            <div className="mt-3 space-y-3">
              <input
                value={task.title}
                onChange={(e) => setTask({ ...task, title: e.target.value })}
                placeholder="What needs doing?"
                className={`w-full ${field}`}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <select
                  value={task.assigned_to}
                  onChange={(e) => setTask({ ...task, assigned_to: e.target.value })}
                  className={field}
                >
                  <option value="">To a person…</option>
                  <option value={me}>Myself</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
                <input
                  value={task.assigned_team}
                  onChange={(e) => setTask({ ...task, assigned_team: e.target.value })}
                  placeholder="…or a team"
                  list="team-list"
                  className={field}
                />
                <datalist id="team-list">
                  {teams.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <select
                  value={task.clinic_id}
                  onChange={(e) => setTask({ ...task, clinic_id: e.target.value })}
                  className={field}
                >
                  <option value="">No clinic</option>
                  {clinics.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={task.due_on}
                  onChange={(e) => setTask({ ...task, due_on: e.target.value })}
                  className={field}
                />
                <select
                  value={task.priority}
                  onChange={(e) => setTask({ ...task, priority: e.target.value })}
                  className={field}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p} priority
                    </option>
                  ))}
                </select>
                <input
                  value={task.detail}
                  onChange={(e) => setTask({ ...task, detail: e.target.value })}
                  placeholder="Detail (optional)"
                  className={field}
                />
              </div>
              <button
                onClick={addTask}
                disabled={busy || !task.title.trim()}
                className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                Create task
              </button>
              <p className="text-xs text-muted">
                A task can go to a person or to a team by name — useful when the team has no logins
                yet. Assign it to yourself and it appears under &ldquo;Assigned to me&rdquo;; assign it
                to anyone else and it appears under &ldquo;I assigned&rdquo;.
              </p>
            </div>
          </section>
          )}

          <section>
            <div className="flex items-center justify-between">
              <h2 className={thL}>
                {view === "inward" ? "Assigned to me" : view === "outward" ? "I assigned" : "All tasks"}
              </h2>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
                Show finished
              </label>
            </div>

            {shown.length === 0 ? (
              <p className="mt-3 rounded border border-dashed border-hairline px-4 py-8 text-center text-sm text-muted">
                {view === "inward"
                  ? "Nothing is assigned to you."
                  : view === "outward"
                    ? "You have not assigned anything to anyone yet."
                    : "No tasks at all yet."}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {shown.map((t) => {
                  const overdue = t.due_on && t.due_on < today && !["done", "cancelled"].includes(t.status);
                  return (
                    <div
                      key={t.id}
                      className={`rounded border border-hairline border-l-[3px] bg-white p-3 ${
                        t.priority === "high" ? "border-l-bad" : "border-l-hairline"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className={`font-medium ${t.status === "done" ? "text-muted line-through" : ""}`}>
                            {t.title}
                          </div>
                          {t.detail && <div className="mt-0.5 text-sm text-muted">{t.detail}</div>}
                          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
                            {t.clinic_id && (
                              <Link href={`/clinics/${t.clinic_id}`} className="text-accent hover:underline">
                                {clinicOf.get(t.clinic_id)}
                              </Link>
                            )}
                            <span>
                              {t.assigned_to
                                ? `→ ${nameOf.get(t.assigned_to) ?? "someone"}`
                                : t.assigned_team
                                  ? `→ ${t.assigned_team}`
                                  : "unassigned"}
                            </span>
                            {t.created_by && t.created_by !== me && (
                              <span>from {nameOf.get(t.created_by) ?? "someone"}</span>
                            )}
                            {t.due_on && (
                              <span className={overdue ? "font-medium text-bad" : ""}>
                                due {t.due_on}
                                {overdue ? " — overdue" : ""}
                              </span>
                            )}
                          </div>
                        </div>
                        <select
                          value={t.status}
                          onChange={(e) => setStatus(t.id, e.target.value)}
                          className={small}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s.replace("_", " ")}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          <section>
            <h2 className={thL}>Flag a clinic</h2>
            <p className="mt-1 text-sm text-muted">
              A flag marks a clinic as needing attention. It is a state, not a job — create tasks
              underneath it for the actual work.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <select
                value={flag.clinic_id}
                onChange={(e) => setFlag({ ...flag, clinic_id: e.target.value })}
                className={field}
              >
                <option value="">Which clinic?</option>
                {clinics.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={flag.severity}
                onChange={(e) => setFlag({ ...flag, severity: e.target.value })}
                className={field}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                value={flag.reason}
                onChange={(e) => setFlag({ ...flag, reason: e.target.value })}
                placeholder="Why?"
                className={field}
              />
              <input
                value={flag.detail}
                onChange={(e) => setFlag({ ...flag, detail: e.target.value })}
                placeholder="Detail (optional)"
                className={field}
              />
            </div>
            <button
              onClick={addFlag}
              disabled={busy || !flag.clinic_id || !flag.reason.trim()}
              className="mt-3 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Raise flag
            </button>
          </section>

          <section>
            <h2 className={thL}>Open flags</h2>
            {openFlags.length === 0 ? (
              <p className="mt-3 rounded border border-dashed border-hairline px-4 py-8 text-center text-sm text-muted">
                No clinics flagged.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {openFlags.map((f) => (
                  <div
                    key={f.id}
                    className={`rounded border border-hairline border-l-[3px] bg-white p-3 ${
                      SEVERITY_TONE[f.severity]
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link href={`/clinics/${f.clinic_id}`} className="font-medium text-accent hover:underline">
                          {clinicOf.get(f.clinic_id)}
                        </Link>
                        <span className="ml-2 text-xs uppercase tracking-wider text-muted">
                          {f.severity}
                        </span>
                        <div className="mt-0.5">{f.reason}</div>
                        {f.detail && <div className="text-sm text-muted">{f.detail}</div>}
                        <div className="mt-1 text-xs text-muted">
                          raised by {nameOf.get(f.raised_by ?? "") ?? "someone"} on{" "}
                          {f.raised_at.slice(0, 10)}
                        </div>
                      </div>
                      <button
                        onClick={() => resolveFlag(f.id)}
                        disabled={busy}
                        className="rounded border border-hairline px-3 py-1 text-xs hover:border-ink"
                      >
                        Resolve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
