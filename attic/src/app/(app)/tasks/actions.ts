"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { WorkStatus } from "@/lib/supabase/pending.types";

const STATUSES: WorkStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
];

export async function createTask(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const title = String(formData.get("title") ?? "").trim();
  const assignedTo = String(formData.get("assigned_to") ?? "");
  if (!title) return { error: "Give the task a title." };
  if (!assignedTo) return { error: "Choose who it's for." };

  const clinicId = Number(formData.get("clinic_id"));

  const { error } = await supabase.from("tasks").insert({
    title,
    detail: String(formData.get("detail") ?? "").trim() || null,
    assigned_to: assignedTo,
    // RLS requires this to be the caller — anyone may assign to anyone, but
    // only as themselves.
    assigned_by: user.id,
    clinic_id: Number.isInteger(clinicId) ? clinicId : null,
    due_date: String(formData.get("due_date") ?? "") || null,
  });

  if (error) return { error: error.message };
  revalidatePath("/tasks");
  return { error: null };
}

export async function setTaskStatus(formData: FormData) {
  const supabase = createClient();
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") ?? "") as WorkStatus;
  if (!Number.isInteger(id) || !STATUSES.includes(status)) return;

  await supabase
    .from("tasks")
    .update({
      status,
      updated_at: new Date().toISOString(),
      completed_at: status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", id);

  revalidatePath("/tasks");
}
