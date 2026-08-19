"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TableControls from "@/components/TableControls";

type Entry = {
  id: number;
  actor_name: string | null;
  action: string;
  table_name: string | null;
  record_id: string | null;
  changed: string[] | null;
  detail: string | null;
  at: string;
};

type Login = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  last_sign_in_at: string | null;
};

type Batch = {
  id: number;
  source_name: string | null;
  report_kind: string | null;
  clinic_id: number | null;
  period_month: string | null;
  status: string;
  started_at: string;
  rows_accepted: number | null;
  rows_rejected: number | null;
  undone_at: string | null;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export default function ActivityClient({
  entries,
  batches,
  clinics,
  logins = [],
}: {
  entries: Entry[];
  batches: Batch[];
  clinics: { id: number; name: string }[];
  logins?: Login[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [tab, setTab] = useState<"imports" | "log" | "logins">("imports");
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const clinicName = useMemo(() => new Map(clinics.map((c) => [c.id, c.name])), [clinics]);
  const never = useMemo(() => logins.filter((l) => !l.last_sign_in_at && l.is_active), [logins]);

  const actions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.action))).sort(),
    [entries]
  );

  const shown = entries.filter((e) => {
    if (action && e.action !== action) return false;
    if (!q.trim()) return true;
    const hay = [e.actor_name, e.action, e.table_name, e.record_id, e.detail]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  async function undo(batchId: number) {
    setBusy(batchId);
    setMsg(null);
    setConfirming(null);
    const { data, error } = await supabase.rpc("undo_import", { p_batch_id: batchId });
    setBusy(null);
    if (error) {
      setMsg({ ok: false, text: error.message });
      return;
    }
    setMsg({ ok: true, text: String(data ?? "Import undone.") });
    router.refresh();
  }

  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";

  return (
    <div>
      <div className="border-b border-hairline pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-1 text-sm text-muted">
          What has been imported, what can be taken back, and who changed what.
        </p>
      </div>

      {msg && (
        <p
          className={`mt-4 rounded-card border px-4 py-3 text-sm ${
            msg.ok ? "border-good/30 bg-good/5 text-good" : "border-bad/30 bg-bad/5 text-bad"
          }`}
        >
          {msg.text}
        </p>
      )}

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-hairline print:hidden">
        {([
          ["imports", `Imports (${batches.length})`],
          ["log", `Change log (${entries.length})`],
          ["logins", `Who has signed in (${logins.filter((l) => l.last_sign_in_at).length}/${logins.length})`],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === k ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "imports" && (
        <section className="mt-4">
          <p className="text-sm text-muted">
            Undoing removes that clinic&apos;s whole month from every figures table — not only the
            rows this run added. The imports overwrite rather than stack, so once a month has been
            loaded twice there is no such thing as &ldquo;just this run&rsquo;s rows&rdquo;. Re-import
            afterwards to put it back.
          </p>

          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thL}>When</th>
                <th className={thL}>File</th>
                <th className={thL}>Loaded</th>
                <th className={thL}>Status</th>
                <th className={thL} />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-b border-hairline/60 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{when(b.started_at)}</td>
                  <td className="py-2 pr-3">
                    {b.source_name ?? "—"}
                    <div className="text-xs text-muted">{b.report_kind ?? "monthly pack"}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {b.clinic_id ? clinicName.get(b.clinic_id) ?? `Clinic ${b.clinic_id}` : "all clinics"}
                    <div className="text-xs text-muted">
                      {b.period_month ? b.period_month.slice(0, 7) : "no month recorded"}
                      {b.rows_accepted ? ` · ${b.rows_accepted} rows` : ""}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        b.status === "success"
                          ? "text-good"
                          : b.status === "undone"
                            ? "text-muted"
                            : b.status === "failed"
                              ? "text-bad"
                              : "text-warn"
                      }
                    >
                      {b.status}
                    </span>
                    {b.undone_at && (
                      <div className="text-xs text-muted">undone {when(b.undone_at)}</div>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {b.status === "undone" || !b.period_month ? (
                      <span className="text-xs text-muted">
                        {b.period_month ? "already undone" : "no month recorded"}
                      </span>
                    ) : confirming === b.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-bad">Remove this month?</span>
                        <button
                          onClick={() => undo(b.id)}
                          disabled={busy === b.id}
                          className="rounded bg-bad px-2 py-1 text-xs text-white disabled:opacity-40"
                        >
                          {busy === b.id ? "Removing…" : "Yes, undo"}
                        </button>
                        <button
                          onClick={() => setConfirming(null)}
                          className="text-xs text-muted underline"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirming(b.id)}
                        className="rounded border border-hairline px-2 py-1 text-xs text-muted hover:border-bad hover:text-bad"
                      >
                        Undo
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {batches.length === 0 && (
            <p className="mt-6 text-sm text-muted">Nothing has been imported yet.</p>
          )}
        </section>
      )}

      {tab === "logins" && (
        <section className="mt-4">
          {never.length > 0 && (
            <p className="rounded-card border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
              {never.length === 1
                ? `${never[0].full_name ?? never[0].email} has never signed in.`
                : `${never.length} people have never signed in: ${never
                    .map((l) => l.full_name ?? l.email)
                    .join(", ")}.`}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
            <span className="text-xs text-muted">
              A login that has never been used usually means the password did not arrive, rather
              than that somebody chose not to look.
            </span>
            <span className="flex-1" />
            <TableControls
              title="Who has signed in"
              rows={logins}
              columns={[
                { header: "Name", value: (l) => l.full_name ?? "" },
                { header: "Email", value: (l) => l.email ?? "" },
                { header: "Role", value: (l) => l.role },
                { header: "Active", value: (l) => (l.is_active ? "yes" : "no") },
                { header: "Last signed in", value: (l) => l.last_sign_in_at ?? "never" },
                {
                  header: "Days since",
                  value: (l) =>
                    l.last_sign_in_at
                      ? Math.floor(
                          (Date.now() - new Date(l.last_sign_in_at).getTime()) / 86400000
                        )
                      : "",
                },
              ]}
            />
          </div>

          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thL}>Person</th>
                <th className={thL}>Role</th>
                <th className={thL}>Last signed in</th>
                <th className={thL} />
              </tr>
            </thead>
            <tbody>
              {logins.map((l) => {
                const days = l.last_sign_in_at
                  ? Math.floor((Date.now() - new Date(l.last_sign_in_at).getTime()) / 86400000)
                  : null;
                return (
                  <tr key={l.id} className="border-b border-hairline/60">
                    <td className="py-2">
                      {l.full_name ?? "—"}
                      <div className="text-xs text-muted">{l.email}</div>
                    </td>
                    <td className="py-2 text-xs">{l.role}</td>
                    <td className="py-2">
                      {l.last_sign_in_at ? (
                        <>
                          {when(l.last_sign_in_at)}
                          <div className="text-xs text-muted">
                            {days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}
                          </div>
                        </>
                      ) : (
                        <span className="text-warn">never</span>
                      )}
                    </td>
                    <td className="py-2 text-right text-xs">
                      {!l.is_active && <span className="text-muted">no longer active</span>}
                      {l.is_active && days !== null && days > 14 && (
                        <span className="text-muted">quiet for a while</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {logins.length === 0 && (
            <p className="mt-6 text-sm text-muted">
              No logins to show. If you expected some, migration 023 may not have run — this list
              comes from a view added by it.
            </p>
          )}
        </section>
      )}

      {tab === "log" && (
        <section className="mt-4">
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search person, table, detail…"
              className="w-64 rounded border border-hairline px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="rounded border border-hairline px-2 py-1.5 text-sm"
            >
              <option value="">Every action</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <span className="flex-1" />
            <TableControls
              title="Activity log"
              rows={shown}
              columns={[
                { header: "When", value: (e) => e.at },
                { header: "Who", value: (e) => e.actor_name ?? "" },
                { header: "Action", value: (e) => e.action },
                { header: "Table", value: (e) => e.table_name ?? "" },
                { header: "Record", value: (e) => e.record_id ?? "" },
                { header: "Fields changed", value: (e) => (e.changed ?? []).join(", ") },
                { header: "Detail", value: (e) => e.detail ?? "" },
              ]}
            />
          </div>

          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thL}>When</th>
                <th className={thL}>Who</th>
                <th className={thL}>Action</th>
                <th className={thL}>What</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className="border-b border-hairline/60 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted">{when(e.at)}</td>
                  <td className="py-2 pr-3">{e.actor_name ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        e.action === "delete"
                          ? "text-bad"
                          : e.action === "insert"
                            ? "text-good"
                            : "text-muted"
                      }
                    >
                      {e.action}
                    </span>
                  </td>
                  <td className="py-2">
                    {e.table_name && (
                      <span>
                        {e.table_name}
                        {e.record_id ? ` #${e.record_id}` : ""}
                      </span>
                    )}
                    {e.changed && e.changed.length > 0 && (
                      <div className="text-xs text-muted">{e.changed.join(", ")}</div>
                    )}
                    {e.detail && <div className="text-xs">{e.detail}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {shown.length === 0 && (
            <p className="mt-6 text-sm text-muted">Nothing matches that.</p>
          )}

          <p className="mt-4 text-xs text-muted">
            The 500 most recent entries. The log cannot be edited or deleted by anyone, including
            administrators — it is written by the database itself, which is the only way it is worth
            trusting. Reading is not recorded: Postgres has no way to notice a read, so &ldquo;who
            looked at this&rdquo; would need the app to report it screen by screen.
          </p>
        </section>
      )}
    </div>
  );
}
