import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import type { WorkStatus } from "@/lib/supabase/pending.types";

import { setTaskStatus } from "./actions";
import { NewTaskForm } from "./new-task-form";
import { SchemaNotice } from "../schema-notice";

export const metadata = { title: "Tasks · MOne" };

// Must be a single literal: supabase-js infers the row shape from the string,
// and concatenation widens it to `string`, losing all of the typing.
const SELECT =
  "id, title, detail, status, due_date, created_at, clinic_id, assigned_to, assigned_by, clinics ( name ), assignee:profiles!tasks_assigned_to_fkey ( full_name ), assigner:profiles!tasks_assigned_by_fkey ( full_name )";

const NEXT_STATUS: Partial<Record<WorkStatus, { to: WorkStatus; label: string }>> =
  {
    open: { to: "in_progress", label: "Start" },
    in_progress: { to: "done", label: "Done" },
    blocked: { to: "in_progress", label: "Unblock" },
  };

type Named = { full_name: string } | null;

/** Overdue is only meaningful while the task is still live. */
function isOverdue(due: string | null, status: WorkStatus) {
  if (!due || status === "done" || status === "cancelled") return false;
  return new Date(due) < new Date(new Date().toDateString());
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // "In" is what's been assigned to me; "Out" is what I've assigned to others.
  const view = searchParams.view === "out" ? "out" : "in";

  const [{ data: people }, { data: clinics }, { data: tasks, error }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name"),
      supabase.from("clinics").select("id, name").order("name"),
      supabase
        .from("tasks")
        .select(SELECT)
        .eq(view === "in" ? "assigned_to" : "assigned_by", user?.id ?? "")
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false }),
    ]);

  const rows = tasks ?? [];

  return (
    <main className="page page--wide">
      <header className="page-header">
        <div>
          <h1>Tasks</h1>
          <p className="muted">
            {view === "in"
              ? "Assigned to you."
              : "Assigned by you to other people."}
          </p>
        </div>
        <NewTaskForm
          people={(people ?? []).map((p) => ({
            id: p.id,
            label: p.full_name,
          }))}
          clinics={(clinics ?? []).map((c) => ({ id: c.id, label: c.name }))}
        />
      </header>

      <nav className="filters">
        <a href="/tasks?view=in" className={view === "in" ? "active" : ""}>
          In
        </a>
        <a href="/tasks?view=out" className={view === "out" ? "active" : ""}>
          Out
        </a>
      </nav>

      {error ? (
        <SchemaNotice feature="tasks" tables={["tasks"]} message={error.message} />
      ) : null}

      {error ? null : rows.length === 0 ? (
        <p className="muted">
          {view === "in"
            ? "Nothing assigned to you."
            : "You haven't assigned anything yet."}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Clinic</th>
                <th>{view === "in" ? "From" : "To"}</th>
                <th>Status</th>
                <th>Due</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((task) => {
                const next = NEXT_STATUS[task.status];
                const overdue = isOverdue(task.due_date, task.status);
                const counterpart =
                  view === "in"
                    ? (task.assigner as Named)?.full_name
                    : (task.assignee as Named)?.full_name;
                return (
                  <tr key={task.id}>
                    <td>
                      {task.title}
                      {task.detail ? (
                        <span className="muted sub">{task.detail}</span>
                      ) : null}
                    </td>
                    <td className="muted">
                      {(task.clinics as { name: string } | null)?.name ?? "—"}
                    </td>
                    <td className="muted">{counterpart ?? "—"}</td>
                    <td>
                      <span className={`pill pill--${task.status}`}>
                        {task.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className={overdue ? "stale" : "muted"}>
                      {formatDate(task.due_date)}
                    </td>
                    <td>
                      {next ? (
                        <form action={setTaskStatus}>
                          <input type="hidden" name="id" value={task.id} />
                          <input type="hidden" name="status" value={next.to} />
                          <button type="submit" className="secondary small">
                            {next.label}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
