"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function createProject(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const name = String(formData.get("name") ?? "").trim();
  const assignedTo = String(formData.get("assigned_to") ?? "");
  if (!name) return { error: "Give the project a name." };
  if (!assignedTo) return { error: "Choose who owns it." };

  const clinicId = Number(formData.get("clinic_id"));
  const amount = Number(formData.get("amount"));
  const claims = Number(formData.get("claim_count"));
  const tat = Number(formData.get("tat_days"));

  const { data, error } = await supabase
    .from("projects")
    .insert({
      name,
      detail: String(formData.get("detail") ?? "").trim() || null,
      assigned_to: assignedTo,
      assigned_by: user.id,
      clinic_id: Number.isInteger(clinicId) ? clinicId : null,
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      claim_count: Number.isInteger(claims) && claims > 0 ? claims : null,
      tat_days: Number.isInteger(tat) && tat > 0 ? tat : null,
      started_on: String(formData.get("started_on") ?? "") || null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Seed the handover trail with the original assignment, so the history is
  // complete rather than starting at the first reassignment.
  await supabase.from("project_assignments").insert({
    project_id: data.id,
    assigned_to: assignedTo,
    assigned_by: user.id,
    comment: "Created",
  });

  revalidatePath("/projects");
  return { error: null };
}

/** Reassignment and progress notes both append to history — never overwrite. */
export async function reassignProject(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const projectId = Number(formData.get("project_id"));
  const assignedTo = String(formData.get("assigned_to") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();
  if (!Number.isInteger(projectId) || !assignedTo) {
    return { error: "Pick who it's moving to." };
  }
  if (!comment) return { error: "Say why it's moving." };

  const { error } = await supabase.from("project_assignments").insert({
    project_id: projectId,
    assigned_to: assignedTo,
    assigned_by: user.id,
    comment,
  });
  if (error) return { error: error.message };

  await supabase
    .from("projects")
    .update({ assigned_to: assignedTo, updated_at: new Date().toISOString() })
    .eq("id", projectId);

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  return { error: null };
}

export async function addProjectUpdate(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const projectId = Number(formData.get("project_id"));
  const comment = String(formData.get("comment") ?? "").trim();
  const raw = formData.get("progress_pct");
  const progress = raw === null || raw === "" ? null : Number(raw);
  if (!Number.isInteger(projectId)) return { error: "Unknown project." };
  if (!comment) return { error: "Write an update." };
  if (progress !== null && (progress < 0 || progress > 100)) {
    return { error: "Progress must be between 0 and 100." };
  }

  const { error } = await supabase.from("project_updates").insert({
    project_id: projectId,
    author_id: user.id,
    progress_pct: progress,
    comment,
  });
  if (error) return { error: error.message };

  if (progress !== null) {
    await supabase
      .from("projects")
      .update({
        progress_pct: progress,
        updated_at: new Date().toISOString(),
        ...(progress === 100
          ? { status: "done" as const, completed_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", projectId);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  return { error: null };
}
