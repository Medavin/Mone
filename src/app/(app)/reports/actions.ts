"use server";

import { parseReportBuffer, type ParsedReport } from "@/lib/report/parse.mjs";
import { createClient } from "@/lib/supabase/server";

/** Workbooks run to a few MB; this is a sanity bound, not a real limit. */
const MAX_BYTES = 25 * 1024 * 1024;

export type ParseResult =
  | { ok: true; report: ParsedReport }
  | { ok: false; error: string };

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
