"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TARGETS, targetFor } from "@/lib/importTargets";
import type { Profile } from "@/lib/types";

type Source = {
  id: number;
  name: string;
  kind: string;
  connection_hint: string | null;
  vault_ref: string | null;
  owner_contact: string | null;
  cadence: string;
  is_active: boolean;
  note: string | null;
  last_seen_at: string | null;
};

type Query = {
  id: number;
  source_id: number;
  name: string;
  target_table: string;
  sql_text: string | null;
  cadence: string;
  profile_id: number | null;
  is_active: boolean;
  last_run_at: string | null;
  last_rows: number | null;
  last_error: string | null;
};

type Key = {
  id: number;
  source_id: number | null;
  label: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
};

const KINDS = [
  ["odbc", "ODBC"],
  ["snowflake", "Snowflake"],
  ["fabric", "Microsoft Fabric"],
  ["api", "API"],
  ["folder", "Watched folder"],
  ["manual", "Sent by hand"],
] as const;

const CADENCE = ["daily", "weekly", "monthly", "on_demand"] as const;

/**
 * Where MBOne records what it can be fed from, and what to ask for.
 *
 * The queries live here rather than on the machine that runs them, so they
 * can be read and changed without touching anything holding credentials —
 * and so they survive the move to Snowflake, when the same SQL will be run
 * a different way.
 */
export default function SourcesClient({
  me,
  sources,
  queries,
  keys,
  clinics,
  profiles,
  links,
}: {
  me: Profile;
  sources: Source[];
  queries: Query[];
  keys: Key[];
  clinics: { id: number; name: string; amd_office_key: string | null }[];
  profiles: { id: number; name: string; target_table: string }[];
  links: { source_id: number; clinic_id: number; office_key: string | null }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(sources[0]?.id ?? null);
  const [newSource, setNewSource] = useState({ name: "", kind: "odbc", hint: "", contact: "" });
  const [newQuery, setNewQuery] = useState<Record<number, Record<string, string>>>({});
  const [freshKey, setFreshKey] = useState<{ sourceId: number; key: string } | null>(null);
  const [showRunner, setShowRunner] = useState<number | null>(null);

  const clinicName = useMemo(() => new Map(clinics.map((c) => [c.id, c.name])), [clinics]);

  async function addSource() {
    if (!newSource.name.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("data_sources").insert({
      name: newSource.name.trim(),
      kind: newSource.kind,
      connection_hint: newSource.hint.trim() || null,
      owner_contact: newSource.contact.trim() || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setNewSource({ name: "", kind: "odbc", hint: "", contact: "" });
    router.refresh();
  }

  async function addQuery(sourceId: number) {
    const d = newQuery[sourceId] ?? {};
    if (!d.name?.trim() || !d.target) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("source_queries").insert({
      source_id: sourceId,
      name: d.name.trim(),
      target_table: d.target,
      sql_text: d.sql?.trim() || null,
      cadence: d.cadence || "weekly",
      profile_id: d.profile ? Number(d.profile) : null,
    });
    setBusy(false);
    if (err) {
      setError(err.message.includes("source_queries_source_id_name_key")
        ? "That source already has a query with that name." : err.message);
      return;
    }
    setNewQuery({ ...newQuery, [sourceId]: {} });
    router.refresh();
  }

  /**
   * The key is generated in the browser, hashed, and only the hash is sent.
   * MBOne never holds the key itself — which is why it is shown once and
   * cannot be looked up afterwards. Lost means replaced, not recovered.
   */
  async function makeKey(sourceId: number) {
    setBusy(true);
    setError(null);

    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const key = "mbone_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const { error: err } = await supabase.from("ingest_keys").insert({
      source_id: sourceId,
      label: `Runner key ${new Date().toISOString().slice(0, 10)}`,
      key_hash: hash,
      created_by: me.id,
    });

    setBusy(false);
    if (err) return setError(err.message);
    setFreshKey({ sourceId, key });
    router.refresh();
  }

  async function revokeKey(id: number) {
    setBusy(true);
    const { error: err } = await supabase
      .from("ingest_keys")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("id", id);
    setBusy(false);
    if (err) setError(err.message);
    else router.refresh();
  }

  /** A complete runner for one source. Deliberately short enough to read. */
  function runnerFor(source: Source) {
    const mine = queries.filter((q) => q.source_id === source.id && q.is_active);
    const queryBlock = mine
      .map((q) => `    {
        "name": ${JSON.stringify(q.name)},
        "sql": ${JSON.stringify(q.sql_text ?? "-- add the SQL in MBOne")},
    },`)
      .join("\n");

    return `#!/usr/bin/env python3
"""
MBOne runner for: ${source.name}

Runs each query below against ${source.kind.toUpperCase()} and posts the rows to MBOne.
The queries live in MBOne and are copied in here; change them there, not here.

Needs:  pip install pyodbc requests
Set two environment variables and nothing else:
    MBONE_KEY   the ingest key MBOne showed you once
    ODBC_DSN    the DSN or connection string for AdvancedMD

Run it weekly from Task Scheduler, cron, or whatever already runs jobs.
"""

import os, sys, json, datetime
import pyodbc, requests

ENDPOINT = "https://mone-mauve.vercel.app/api/ingest"
KEY      = os.environ["MBONE_KEY"]
DSN      = os.environ["ODBC_DSN"]

# The period each run asks for. Weekly by default; change the 7 if needed.
TO   = datetime.date.today()
FROM = TO - datetime.timedelta(days=7)

QUERIES = [
${queryBlock || '    # No queries defined in MBOne yet.'}
]

def run(cursor, sql):
    sql = sql.replace(":from", "'%s'" % FROM).replace(":to", "'%s'" % TO)
    cursor.execute(sql)
    headers = [c[0] for c in cursor.description]
    rows = [[None if v is None else str(v) for v in r] for r in cursor.fetchall()]
    return headers, rows

def main():
    conn = pyodbc.connect(DSN)
    cur = conn.cursor()
    failed = False

    for q in QUERIES:
        try:
            headers, rows = run(cur, q["sql"])
        except Exception as e:
            print("QUERY FAILED %s: %s" % (q["name"], e)); failed = True; continue

        # expected_rows lets MBOne refuse a transfer that stopped halfway
        # rather than loading a partial week as if it were a quiet one.
        body = {
            "query": q["name"],
            "headers": headers,
            "rows": rows,
            "expected_rows": len(rows),
        }

        r = requests.post(ENDPOINT, json=body,
                          headers={"Authorization": "Bearer " + KEY}, timeout=300)
        out = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}

        if r.status_code == 200 and out.get("ok"):
            print("%s: sent %d, loaded %d, rejected %d"
                  % (q["name"], len(rows), out.get("loaded", 0), out.get("rejected", 0)))
            for why in out.get("reasons", [])[:5]:
                print("   row %s: %s" % (why.get("row"), "; ".join(why.get("why", []))))
        else:
            print("%s FAILED: %s" % (q["name"], out.get("error") or r.text[:300])); failed = True

    cur.close(); conn.close()
    # A non-zero exit is what makes a scheduler tell somebody it broke.
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
`;
  }

  const field =
    "rounded border border-hairline bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <div>
      <div className="border-b border-hairline pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Data sources</h1>
        <p className="mt-1 text-sm text-muted">
          Where MBOne can be fed from, what to ask for, and how often.
        </p>
      </div>

      <div className="mt-4 rounded-card border border-accent/30 bg-accentSoft px-4 py-3 text-sm">
        <strong>MBOne cannot query AdvancedMD itself</strong> — it has no persistent process and no
        ODBC driver. A small runner does that where the database is reachable, and posts the rows
        back here. <strong>The queries live here; only the credentials live there.</strong> When
        AdvancedMD moves to Snowflake, the same SQL can be run without a runner at all.
      </div>

      {error && (
        <p className="mt-4 rounded-card border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</p>
      )}

      {/* add a source */}
      <section className="mt-6 rounded-card border border-hairline bg-surface p-5 shadow-card">
        <h2 className="text-base font-medium">Add a source</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <input value={newSource.name} onChange={(e) => setNewSource({ ...newSource, name: e.target.value })}
            placeholder="AdvancedMD ODBC" className={field} />
          <select value={newSource.kind} onChange={(e) => setNewSource({ ...newSource, kind: e.target.value })} className={field}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={newSource.hint} onChange={(e) => setNewSource({ ...newSource, hint: e.target.value })}
            placeholder="Where it runs — never a password" className={field} />
          <input value={newSource.contact} onChange={(e) => setNewSource({ ...newSource, contact: e.target.value })}
            placeholder="Who to ask — Chris" className={field} />
        </div>
        <button onClick={addSource} disabled={busy || !newSource.name.trim()}
          className="mt-3 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">
          Add source
        </button>
        <p className="mt-2 text-xs text-muted">
          Credentials never go in MBOne. Record where they live — the vault, the machine — not what
          they are.
        </p>
      </section>

      {sources.length === 0 ? (
        <p className="mt-8 rounded-card border border-dashed border-hairline bg-surface p-10 text-center text-sm text-muted">
          No sources yet. Add one for the AdvancedMD ODBC connection once Chris confirms how it is
          reached.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {sources.map((s) => {
            const isOpen = open === s.id;
            const mine = queries.filter((q) => q.source_id === s.id);
            const myKeys = keys.filter((k) => k.source_id === s.id && k.is_active);
            const myClinics = links.filter((l) => l.source_id === s.id);
            return (
              <div key={s.id} className="rounded-card border border-hairline bg-surface shadow-card">
                <button onClick={() => setOpen(isOpen ? null : s.id)}
                  className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left">
                  <div>
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-2 text-xs text-muted">
                      {KINDS.find(([v]) => v === s.kind)?.[1] ?? s.kind} · {s.cadence}
                    </span>
                    <div className="text-xs text-muted">
                      {mine.length} quer{mine.length === 1 ? "y" : "ies"} ·{" "}
                      {myClinics.length ? `${myClinics.length} clinics` : "no clinics linked"} ·{" "}
                      {s.last_seen_at ? `last received ${s.last_seen_at.slice(0, 10)}` : "nothing received yet"}
                    </div>
                  </div>
                  <span className="text-xs text-muted">{isOpen ? "▴" : "▾"}</span>
                </button>

                {isOpen && (
                  <div className="border-t border-hairline px-5 py-4">
                    {/* queries */}
                    <h3 className="eyebrow">What to pull</h3>
                    {mine.length > 0 && (
                      <table className="mt-2 w-full text-sm">
                        <thead>
                          <tr className="border-b border-hairline">
                            <th className={thL}>Query</th>
                            <th className={thL}>Into</th>
                            <th className={thL}>How often</th>
                            <th className={thL}>Last run</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mine.map((q) => (
                            <Fragment key={q.id}>
                              <tr className="border-b border-hairline/60 align-top">
                                <td className="py-2 pr-3">{q.name}</td>
                                <td className="py-2 pr-3 text-xs">{targetFor(q.target_table)?.label ?? q.target_table}</td>
                                <td className="py-2 pr-3 text-xs">{q.cadence}</td>
                                <td className="py-2 text-xs text-muted">
                                  {q.last_run_at ? `${q.last_run_at.slice(0, 10)} · ${q.last_rows ?? 0} rows` : "never"}
                                  {q.last_error && <div className="text-bad">{q.last_error}</div>}
                                </td>
                              </tr>
                              {q.sql_text && (
                                <tr className="border-b border-hairline/60">
                                  <td colSpan={4} className="pb-3">
                                    <pre className="overflow-x-auto rounded bg-canvas p-2 text-[11px] leading-relaxed">{q.sql_text}</pre>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <div className="mt-3 grid gap-2 sm:grid-cols-5">
                      <input value={newQuery[s.id]?.name ?? ""} placeholder="Weekly denials"
                        onChange={(e) => setNewQuery({ ...newQuery, [s.id]: { ...(newQuery[s.id] ?? {}), name: e.target.value } })}
                        className={field} />
                      <select value={newQuery[s.id]?.target ?? ""}
                        onChange={(e) => setNewQuery({ ...newQuery, [s.id]: { ...(newQuery[s.id] ?? {}), target: e.target.value } })}
                        className={field}>
                        <option value="">Into…</option>
                        {TARGETS.map((t) => <option key={t.table} value={t.table}>{t.label}</option>)}
                      </select>
                      <select value={newQuery[s.id]?.cadence ?? "weekly"}
                        onChange={(e) => setNewQuery({ ...newQuery, [s.id]: { ...(newQuery[s.id] ?? {}), cadence: e.target.value } })}
                        className={field}>
                        {CADENCE.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
                      </select>
                      <select value={newQuery[s.id]?.profile ?? ""}
                        onChange={(e) => setNewQuery({ ...newQuery, [s.id]: { ...(newQuery[s.id] ?? {}), profile: e.target.value } })}
                        className={field}>
                        <option value="">Columns already named ours</option>
                        {profiles.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                      </select>
                      <button onClick={() => addQuery(s.id)} disabled={busy}
                        className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40">
                        Add query
                      </button>
                      <textarea rows={3} value={newQuery[s.id]?.sql ?? ""}
                        placeholder="select ... from ... where service_date between :from and :to"
                        onChange={(e) => setNewQuery({ ...newQuery, [s.id]: { ...(newQuery[s.id] ?? {}), sql: e.target.value } })}
                        className={`${field} sm:col-span-5`} />
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Use <code>:from</code> and <code>:to</code> for the period — the runner
                      substitutes them each time it runs, so the query is written once.
                    </p>

                    {/* keys */}
                    <h3 className="eyebrow mt-6">Runner key</h3>
                    {freshKey?.sourceId === s.id && (
                      <div className="mt-2 rounded-card border border-warn/40 bg-warn/5 p-3">
                        <p className="text-sm text-warn">
                          <strong>Copy this now.</strong> MBOne stores only a hash, so it cannot be
                          shown again — a lost key is replaced, not recovered.
                        </p>
                        <code className="mt-2 block break-all rounded bg-surface px-2 py-1 text-xs">{freshKey.key}</code>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <button onClick={() => makeKey(s.id)} disabled={busy}
                        className="rounded border border-hairline px-3 py-1.5 text-sm text-muted hover:text-ink">
                        Create a key
                      </button>
                      {myKeys.map((k) => (
                        <span key={k.id} className="text-xs text-muted">
                          {k.label}
                          {k.last_used_at ? ` · used ${k.last_used_at.slice(0, 10)}` : " · never used"}
                          <button onClick={() => revokeKey(k.id)} className="ml-2 text-bad underline">revoke</button>
                        </span>
                      ))}
                    </div>

                    {/* the runner */}
                    <h3 className="eyebrow mt-6">The runner</h3>
                    <button onClick={() => setShowRunner(showRunner === s.id ? null : s.id)}
                      className="mt-1 rounded border border-hairline px-3 py-1.5 text-sm text-muted hover:text-ink">
                      {showRunner === s.id ? "Hide" : "Show the script"}
                    </button>
                    {showRunner === s.id && (
                      <>
                        <p className="mt-2 text-sm text-muted">
                          Give this to whoever runs jobs at Momentum. It needs two environment
                          variables and nothing else, and it is short enough to read before running.
                        </p>
                        <pre className="mt-2 max-h-96 overflow-auto rounded bg-canvas p-3 text-[11px] leading-relaxed">{runnerFor(s)}</pre>
                        <button
                          onClick={() => navigator.clipboard.writeText(runnerFor(s))}
                          className="mt-2 rounded border border-hairline px-3 py-1.5 text-xs text-muted hover:text-ink"
                        >
                          Copy the script
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
