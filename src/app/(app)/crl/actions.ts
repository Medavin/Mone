"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { CrlStatus } from "@/lib/supabase/pending.types";

const STATUSES: CrlStatus[] = ["open", "pending", "answered", "closed"];

export async function createCrlEntry(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const clinicId = Number(formData.get("clinic_id"));
  const detail = String(formData.get("detail") ?? "").trim();
  const requestedFrom = String(formData.get("requested_from") ?? "");

  if (!Number.isInteger(clinicId)) return { error: "Pick a clinic." };
  if (!detail) return { error: "Describe what's needed." };
  if (requestedFrom !== "clinic" && requestedFrom !== "patient") {
    return { error: "Choose who the request is going to." };
  }

  const { error } = await supabase.from("crl_entries").insert({
    clinic_id: clinicId,
    detail,
    requested_from: requestedFrom,
    request_type: String(formData.get("request_type") ?? "").trim() || null,
    opened_by: user.id,
  });

  if (error) return { error: error.message };
  revalidatePath("/crl");
  return { error: null };
}

export async function setCrlStatus(formData: FormData) {
  const supabase = createClient();
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") ?? "") as CrlStatus;
  if (!Number.isInteger(id) || !STATUSES.includes(status)) return;

  // Stamp the moment the request left "waiting on someone else", so ageing
  // can be measured later without reconstructing it from an audit log.
  const now = new Date().toISOString();
  await supabase
    .from("crl_entries")
    .update({
      status,
      updated_at: now,
      ...(status === "answered" ? { responded_at: now } : {}),
      ...(status === "closed" ? { closed_at: now } : {}),
    })
    .eq("id", id);

  revalidatePath("/crl");
}
