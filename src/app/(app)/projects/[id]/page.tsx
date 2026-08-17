import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";

import { ProjectForms } from "./project-forms";

type Named = { full_name: string } | null;

export async function generateMetadata({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data } = await supabase
    .from("projects")
    .select("name")
    .eq("id", Number(params.id))
    .maybeSingle();
  return { title: data ? `${data.name} · MOne` : "Project · MOne" };
}

export default async function ProjectPage({
  params,
}: {
  params: { id: string };
}) {
  const projectId = Number(params.id);
  if (!Number.isInteger(projectId)) notFound();

  const supabase = createClient();

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, name, detail, status, progress_pct, amount, claim_count, tat_days, started_on, due_on, completed_at, created_at, assigned_to, clinics ( name ), assignee:profiles!projects_assigned_to_fkey ( full_name )",
    )
    .eq("id", projectId)
    .maybeSingle();

  if (!project) notFound();

  const [{ data: people }, { data: history }, { data: updates }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name"),
      supabase
        .from("project_assignments")
        .select(
          "id, assigned_at, comment, to:profiles!project_assignments_assigned_to_fkey ( full_name ), by:profiles!project_assignments_assigned_by_fkey ( full_name )",
        )
        .eq("project_id", projectId)
        .order("assigned_at", { ascending: false }),
      supabase
        .from("project_updates")
        .select(
          "id, created_at, comment, progress_pct, author:profiles!project_updates_author_id_fkey ( full_name )",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
    ]);

  return (
    <main className="page">
      <p>
        <Link href="/projects" className="back">
          ← All projects
        </Link>
      </p>

      <header className="page-header">
        <div>
          <h1>{project.name}</h1>
          <p className="muted">
            <span className={`pill pill--${project.status}`}>
              {project.status.replace("_", " ")}
            </span>
            {" · "}
            {(project.clinics as { name: string } | null)?.name ?? "No clinic"}
            {" · owned by "}
            {(project.assignee as Named)?.full_name ?? "—"}
          </p>
        </div>
      </header>

      {project.detail ? <p className="notes">{project.detail}</p> : null}

      <div className="stats">
        <div className="stat stat--lead">
          <span className="stat-label">Progress</span>
          <span className="stat-value">{project.progress_pct}%</span>
        </div>
        <div className="stat">
          <span className="stat-label">Amount</span>
          <span className="stat-value">{formatCurrency(project.amount)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Claims</span>
          <span className="stat-value">{formatNumber(project.claim_count)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">TAT target</span>
          <span className="stat-value">
            {project.tat_days ? `${project.tat_days}d` : "—"}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Started</span>
          <span className="stat-value small-value">
            {formatDate(project.started_on)}
          </span>
        </div>
      </div>

      <ProjectForms
        projectId={project.id}
        currentOwner={project.assigned_to}
        progress={project.progress_pct}
        people={(people ?? []).map((p) => ({ id: p.id, label: p.full_name }))}
      />

      <section>
        <h2>Progress</h2>
        {(updates ?? []).length === 0 ? (
          <p className="muted">No updates yet.</p>
        ) : (
          <ul className="timeline">
            {(updates ?? []).map((update) => (
              <li key={update.id}>
                <div className="timeline-meta">
                  <strong>
                    {(update.author as Named)?.full_name ?? "Unknown"}
                  </strong>
                  <span className="muted">{formatDate(update.created_at)}</span>
                  {update.progress_pct !== null ? (
                    <span className="pill pill--new">
                      {update.progress_pct}%
                    </span>
                  ) : null}
                </div>
                <p>{update.comment}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Handover history</h2>
        {(history ?? []).length === 0 ? (
          <p className="muted">No assignments recorded.</p>
        ) : (
          <ul className="timeline">
            {(history ?? []).map((entry) => (
              <li key={entry.id}>
                <div className="timeline-meta">
                  <strong>
                    → {(entry.to as Named)?.full_name ?? "Unknown"}
                  </strong>
                  <span className="muted">
                    by {(entry.by as Named)?.full_name ?? "Unknown"} ·{" "}
                    {formatDate(entry.assigned_at)}
                  </span>
                </div>
                {entry.comment ? <p>{entry.comment}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
