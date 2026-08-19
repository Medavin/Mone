"use server";

import { revalidatePath } from "next/cache";

import { parseReportBuffer, type ParsedReport } from "@/lib/report/parse.mjs";
import { loadReport } from "@/lib/report/load";
import { createClient } from "@/lib/supabase/server";

/** Workbooks run to a few MB; this is a sanity bound, not a real limit. */
const MAX_BYTES = 25 * 1024 * 1024;

export type ParseResult =
  | { ok: true; report: ParsedReport }
  | { ok: false; error: string };

/**
 * Loads the uploaded workbook into the monthly tables.
 *
 * The file is re-read and re-parsed here rather than trusting figures posted
 * from the browser — otherwise anyone could write arbitrary numbers into AR by
 * editing the request.
 */
export async function loadUploadedReport(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  written?: { table: string; rows: number }[];
  skipped?: string[];
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const file = formData.get("report");
  const clinicId = Number(formData.get("clinic_id"));
  const periodMonth = String(formData.get("period_month") ?? "");
  const replace = formData.get("replace") === "on";

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose the workbook again to load it." };
  }
  if (!Number.isInteger(clinicId)) {
    return { ok: false, message: "Pick which clinic this report belongs to." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodMonth)) {
    return { ok: false, message: "Could not determine the report month." };
  }

  try {
    const report = await parseReportBuffer(await file.arrayBuffer(), file.name);
    const outcome = await loadReport(supabase, report, {
      clinicId,
      periodMonth,
      userId: user.id,
      replace,
    });
    revalidatePath("/clinics");
    revalidatePath(`/clinics/${clinicId}`);
    revalidatePath("/reports");
    return {
      ok: outcome.ok,
      message: outcome.message,
      written: outcome.written,
      skipped: outcome.skipped,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Load failed.",
    };
  }
}

export async function parseUploadedReport(
  formData: FormData,
): Promise<ParseResult> {
  // The parse itself touches no data, but the file does, so require a session.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const file = formData.get("report");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a report workbook first." };
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return { ok: false, error: "Expected an .xlsx workbook." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "That file is larger than 25MB." };
  }

  try {
    const report = await parseReportBuffer(await file.arrayBuffer(), file.name);
    return { ok: true, report };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not read that file.",
    };
  }
}
