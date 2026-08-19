import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";

import { NewProjectForm } from "./new-project-form";
import { SchemaNotice } from "../schema-notice";

export const metadata = { title: "Projects · MOne" };

// Single literal — see the note in tasks/page.tsx.
const SELECT =
  "id, name, status, progress_pct, amount, claim_count, tat_days, started_on, due_on, completed_at, clinics ( name ), assignee:profiles!projects_assigned_to_fkey ( full_name )";

/**
 * Turnaround against target. Counts against today while a project is still
 * running, so something drifting overdue shows up before it completes rather
 * than only in hindsight.
 */
function turnaround(project: {
  started_on: string | null;
  completed_at: string | null;
  tat_days: number | null;
}) {
  if (!project.started_on) return { elapsed: null, overdue: false };
  const start = new Date(project.started_on).getTime();
  const end = project.completed_at
    ? new Date(project.completed_at).getTime()
    : Date.now();
  const elapsed = Math.max(0, Math.floor((end - start) / 86_400_000));
  return {
    elapsed,
    overdue: project.tat_days !== null && elapsed > project.tat_days,
  };
}

export default async function ProjectsPage() {
  const supabase = createClient();

  const [{ data: people }, { data: clinics }, { data: projects, error }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name"),
      supabase.from("clinics").select("id, name").order("name"),
      supabase
        .from("projects")
        .select(SELECT)
        .order("status")
        .order("due_on", { ascending: true, nullsFirst: false }),
    ]);

  const rows = projects ?? [];
  const totalAmount = rows.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const totalClaims = rows.reduce((sum, p) => sum + (p.claim_count ?? 0), 0);

  return (
    <main className="page page--wide">
      <header className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="muted">
            Scoped pieces of work with an owner, a value and a turnaround
            target.
          </p>
        </div>
        <NewProjectForm
          people={(people ?? []).map((p) => ({ id: p.id, label: p.full_name }))}
          clinics={(clinics ?? []).map((c) => ({ id: c.id, label: c.name }))}
        />
      </header>

      {error ? (
        <SchemaNotice
          feature="projects"
          tables={["projects", "project_updates", "project_assignments"]}
          message={error.message}
        />
      ) : null}

      {error ? null : rows.length === 0 ? (
        <p className="muted">No projects yet.</p>
      ) : (
        <>
          <div className="stats">
            <div className="stat stat--lead">
              <span className="stat-label">Projects</span>
              <span className="stat-value">{formatNumber(rows.length)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Value</span>
              <span className="stat-value">{formatCurrency(totalAmount)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Claims</span>
              <span className="stat-value">{formatNumber(totalClaims)}</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Clinic</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th className="num">Amount</th>
                  <th className="num">Claims</th>
                  <th className="num">TAT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((project) => {
                  const tat = turnaround(project);
                  return (
                    <tr key={project.id}>
                      <td>
                        <Link href={`/projects/${project.id}`}>
                          {project.name}
                        </Link>
                        {project.started_on ? (
                          <span className="muted sub">
                            started {formatDate(project.started_on)}
                          </span>
                        ) : null}
                      </td>
                      <td className="muted">
                        {(project.clinics as { name: string } | null)?.name ??
                          "—"}
                      </td>
                      <td className="muted">
                        {(project.assignee as { full_name: string } | null)
                          ?.full_name ?? "—"}
                      </td>
                      <td>
                        <span className={`pill pill--${project.status}`}>
                          {project.status.replace("_", " ")}
                        </span>
                      </td>
                      <td>
                        <div
                          className="meter"
                          role="progressbar"
                          aria-valuenow={project.progress_pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <span style={{ width: `${project.progress_pct}%` }} />
                        </div>
                        <span className="muted sub">
                          {project.progress_pct}%
                        </span>
                      </td>
                      <td className="num">{formatCurrency(project.amount)}</td>
                      <td className="num">{formatNumber(project.claim_count)}</td>
                      <td className={`num ${tat.overdue ? "stale" : "muted"}`}>
                        {tat.elapsed === null
                          ? "—"
                          : `${tat.elapsed}d${project.tat_days ? ` / ${project.tat_days}d` : ""}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
