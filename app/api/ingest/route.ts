import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { targetFor } from "@/lib/importTargets";
import { buildRows, norm, type Mapping, type Sheet } from "@/lib/importEngine";

/**
 * The door that data arrives through when nobody is sitting at a screen.
 *
 * A runner at Momentum's end executes an ODBC query and posts the result
 * here. That result is a header row and some rows — exactly the shape a
 * spreadsheet has — so it goes through THE SAME mapping, coercion and
 * validation as a file dropped into /import/data. One path, not two.
 *
 * ⚠ WHY THAT MATTERS MORE THAN IT SOUNDS: a second path would drift. The
 * file import would learn that "(1,234.56)" is negative and this one would
 * not, and the two would disagree about the same report depending on how it
 * arrived. Everything specific to reading a rectangle lives in
 * lib/importEngine.ts and is shared.
 *
 * AUTHENTICATION is a per-runner key, hashed in the database. The route
 * verifies it through a SECURITY DEFINER function, so this endpoint needs no
 * elevated rights of its own — a leaked deployment cannot read the key table.
 *
 * ⚠ THIS ROUTE RUNS UNAUTHENTICATED BY DESIGN — a scheduled job has no
 * session. The key IS the authentication. Keep it out of URLs, logs and
 * screenshots; it goes in the Authorization header.
 */

export const dynamic = "force-dynamic";

type Payload = {
  /** Which saved query this is answering, so the run can be recorded. */
  query?: string;
  /** Where it should land. Ignored when `query` names a saved one. */
  target?: string;
  /** Reuse a saved column mapping by name. */
  profile?: string;
  /** Column names, in order. */
  headers: string[];
  /** Rows, aligned to headers. */
  rows: (string | number | null)[][];
  /** Applied to every row — a clinic when the query does not name one. */
  defaults?: Record<string, string | number | boolean | null>;
  /** What the source says it sent, so a truncated transfer is caught. */
  expected_rows?: number;
};

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    request.headers.get("x-ingest-key")?.trim();

  if (!key) return bad("No ingest key.", 401);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return bad("The server is not configured.", 500);

  const supabase = createClient(url, anon, { auth: { persistSession: false } });

  const { data: sourceId, error: keyError } = await supabase.rpc("verify_ingest_key", {
    p_key: key,
  });
  if (keyError) return bad(`Could not check that key: ${keyError.message}`, 500);
  if (!sourceId) return bad("That ingest key is not recognised.", 401);

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return bad("The body was not valid JSON.");
  }

  if (!Array.isArray(body.headers) || !Array.isArray(body.rows)) {
    return bad("Expected `headers` and `rows`.");
  }

  // A transfer that stops halfway looks exactly like a short week. Say what
  // you sent and we will refuse the difference rather than load it quietly.
  if (typeof body.expected_rows === "number" && body.expected_rows !== body.rows.length) {
    return bad(
      `Expected ${body.expected_rows} rows but ${body.rows.length} arrived — refusing rather than loading a partial file.`
    );
  }

  // Resolve the saved query, which supplies the target and the mapping.
  let targetTable = body.target ?? "";
  let mapping: Mapping = {};
  let defaults = body.defaults ?? {};
  let queryId: number | null = null;

  if (body.query) {
    const { data: q } = await supabase
      .from("source_queries")
      .select("id, target_table, profile_id")
      .eq("source_id", sourceId)
      .eq("name", body.query)
      .maybeSingle();

    if (!q) return bad(`No saved query called "${body.query}" on this source.`);
    queryId = q.id as number;
    targetTable = q.target_table as string;

    if (q.profile_id) {
      const { data: p } = await supabase
        .from("import_profiles")
        .select("mapping, defaults")
        .eq("id", q.profile_id)
        .maybeSingle();
      if (p) {
        mapping = (p.mapping ?? {}) as Mapping;
        defaults = { ...(p.defaults ?? {}), ...defaults };
      }
    }
  } else if (body.profile) {
    const { data: p } = await supabase
      .from("import_profiles")
      .select("target_table, mapping, defaults")
      .eq("name", body.profile)
      .maybeSingle();
    if (!p) return bad(`No saved mapping called "${body.profile}".`);
    targetTable = p.target_table as string;
    mapping = (p.mapping ?? {}) as Mapping;
    defaults = { ...(p.defaults ?? {}), ...defaults };
  }

  const target = targetFor(targetTable);
  if (!target) return bad(`"${targetTable}" is not something MBOne can load into.`);

  // With no mapping given, assume the query already used our column names —
  // which is the sensible thing for a query we wrote ourselves.
  if (Object.keys(mapping).length === 0) {
    for (const f of target.fields) {
      const hit = body.headers.find((h) => norm(h) === norm(f.column) || norm(h) === norm(f.label));
      if (hit) mapping[f.column] = hit;
    }
  }

  const sheet: Sheet = {
    name: body.query ?? "ingest",
    headers: body.headers.map((h) => String(h ?? "")),
    rows: body.rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))),
  };

  const built = buildRows(target, sheet, mapping, defaults);

  // Clinic names resolve against the clinics and their recorded aliases,
  // exactly as they do for a file — so "B2H" finds Back 2 Health here too.
  const [{ data: clinics }, { data: aliases }] = await Promise.all([
    supabase.from("clinics").select("id, name"),
    supabase.from("clinic_aliases").select("normalised, clinic_id"),
  ]);

  const byName = new Map<string, number>();
  for (const c of (clinics ?? []) as { id: number; name: string }[]) byName.set(norm(c.name), c.id);
  for (const a of (aliases ?? []) as { normalised: string; clinic_id: number }[])
    byName.set(norm(a.normalised), a.clinic_id);

  const accepted: Record<string, unknown>[] = [];
  const rejected: { row: number; why: string[] }[] = [];

  built.forEach((r, i) => {
    const problems = [...r.problems];
    let clinicId = (defaults.clinic_id as number | undefined) ?? null;

    if (r.clinicName) {
      clinicId = byName.get(norm(r.clinicName)) ?? null;
      if (!clinicId) problems.push(`Clinic "${r.clinicName}" is not one of ours`);
    }

    if (problems.length) {
      rejected.push({ row: i + 1, why: problems });
      return;
    }

    const row: Record<string, unknown> = { ...r.values };
    if (clinicId) row.clinic_id = clinicId;
    if (target.table === "denials" && typeof row.denial_date === "string") {
      row.period_month = `${(row.denial_date as string).slice(0, 7)}-01`;
    }
    accepted.push(row);
  });

  let loaded = 0;
  for (let i = 0; i < accepted.length; i += 400) {
    const slice = accepted.slice(i, i + 400);
    const q = target.conflict
      ? supabase.from(target.table).upsert(slice, { onConflict: target.conflict.join(",") })
      : supabase.from(target.table).insert(slice);
    const { error: writeError } = await q;

    if (writeError) {
      if (queryId) {
        await supabase
          .from("source_queries")
          .update({ last_run_at: new Date().toISOString(), last_error: writeError.message })
          .eq("id", queryId);
      }
      return NextResponse.json(
        { ok: false, error: writeError.message, loaded, rejected: rejected.length },
        { status: 500 }
      );
    }
    loaded += slice.length;
  }

  const now = new Date().toISOString();
  await supabase.from("data_sources").update({ last_seen_at: now }).eq("id", sourceId);
  if (queryId) {
    await supabase
      .from("source_queries")
      .update({ last_run_at: now, last_rows: loaded, last_error: null })
      .eq("id", queryId);
  }

  // Rejected rows are REPORTED, not swallowed. A runner that gets a 200 and
  // a count of zero rejections is entitled to believe everything arrived.
  return NextResponse.json({
    ok: true,
    target: target.table,
    received: body.rows.length,
    loaded,
    rejected: rejected.length,
    reasons: rejected.slice(0, 20),
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "MBOne ingest",
    expects: "POST with an Authorization: Bearer <ingest key> header",
  });
}
