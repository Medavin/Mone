import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import Missing from "@/components/Missing";
import ExportButtons from "@/components/ExportButtons";
import { fetchAllRows } from "@/lib/fetchAll";
import type { Profile } from "@/lib/types";
import { manages } from "@/lib/types";

export const dynamic = "force-dynamic";

const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

const plain = (n: number) => n.toLocaleString("en-US");

type Row = {
  clinic_id: number;
  period_month: string;
  action_type_id: number;
  collector_id: number;
  action_count: number;
  is_ot: boolean;
};

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: { month?: string; view?: string };
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const profile = (profileRow as Profile) ?? null;

  const [clinicRes, typeRes, collectorRes, monthRes] = await Promise.all([
    supabase.from("clinics").select("id, name").order("name"),
    supabase.from("action_types").select("id, name, category").order("sort_order"),
    supabase.from("collectors").select("id, code, display_name"),
    supabase.from("collection_actions_monthly").select("period_month").order("period_month"),
  ]);

  const clinicName = new Map(
    ((clinicRes.data ?? []) as { id: number; name: string }[]).map((c) => [c.id, c.name])
  );
  const types = (typeRes.data ?? []) as { id: number; name: string; category: string | null }[];
  const typeById = new Map(types.map((t) => [t.id, t]));
  const collectorName = new Map(
    ((collectorRes.data ?? []) as { id: number; code: string; display_name: string | null }[]).map(
      (c) => [c.id, c.display_name || c.code]
    )
  );

  const months = Array.from(
    new Set(
      ((monthRes.data ?? []) as { period_month: string }[]).map((r) => r.period_month.slice(0, 7))
    )
  ).sort();

  const selected =
    searchParams.month && months.includes(searchParams.month)
      ? searchParams.month
      : months[months.length - 1];

  const view = ["action", "collector", "clinic"].includes(searchParams.view ?? "")
    ? (searchParams.view as "action" | "collector" | "clinic")
    : "action";

  let rows: Row[] = [];
  if (selected) {
    const res = await fetchAllRows<Row>((lo, hi) =>
      supabase
        .from("collection_actions_monthly")
        .select("clinic_id, period_month, action_type_id, collector_id, action_count, is_ot")
        .eq("period_month", `${selected}-01`)
        .order("clinic_id")
        .order("action_type_id")
        .range(lo, hi)
    );
    rows = res.rows;
  }

  const total = rows.reduce((s, r) => s + r.action_count, 0);
  const otTotal = rows.filter((r) => r.is_ot).reduce((s, r) => s + r.action_count, 0);
  const collectorCount = new Set(rows.map((r) => r.collector_id)).size;
  const clinicCount = new Set(rows.map((r) => r.clinic_id)).size;

  const groupBy = (key: (r: Row) => number) => {
    const m = new Map<number, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.action_count);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  };

  const byAction = groupBy((r) => r.action_type_id);
  const byCollector = groupBy((r) => r.collector_id);
  const byClinic = groupBy((r) => r.clinic_id);

  // By category, since "what kind of work is this team doing" is the question
  // behind the list — eighteen action names is too many to read as a shape.
  const byCategory = new Map<string, number>();
  for (const [id, n] of byAction) {
    const cat = typeById.get(id)?.category ?? "Uncategorised";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + n);
  }
  const categories = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]);

  const list =
    view === "action"
      ? byAction.map(([id, n]) => ({
          label: typeById.get(id)?.name ?? "—",
          note: typeById.get(id)?.category ?? "",
          count: n,
        }))
      : view === "collector"
        ? byCollector.map(([id, n]) => ({
            label: collectorName.get(id) ?? "—",
            note: "",
            count: n,
          }))
        : byClinic.map(([id, n]) => ({
            label: clinicName.get(id) ?? "—",
            note: "",
            count: n,
          }));

  const biggest = list[0]?.count ?? 0;

  const thL = "py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted";
  const thR = "py-2 text-right font-mono text-[11px] uppercase tracking-wider text-muted";

  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    if (selected) p.set("month", selected);
    p.set("view", view);
    for (const [k, v] of Object.entries(over)) p.set(k, v);
    return `/actions?${p.toString()}`;
  };

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Collector actions</h1>
            <p className="mt-1 text-sm text-muted">
              {selected
                ? `${monthLabel(selected)} · what the team worked, and where`
                : "What the team worked, and where"}
            </p>
          </div>

          {months.length > 0 && (
            <form method="get" className="flex items-end gap-2">
              <input type="hidden" name="view" value={view} />
              <select
                name="month"
                defaultValue={selected}
                className="rounded-card border border-hairline bg-surface shadow-card px-3 py-1.5 text-sm"
              >
                {[...months].reverse().map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-white"
              >
                Show
              </button>
            </form>
          )}
        </div>

        {!selected || rows.length === 0 ? (
          <div className="mt-8">
            <Missing needs="No collection action report imported yet. Once one is loaded this shows how many actions were worked, by whom, on which clinics, and what kind of work it was." />
            {manages(profile?.role) && (
              <p className="mt-4 text-sm">
                <Link href="/import/actions" className="text-accent underline">
                  Import a collection action report
                </Link>
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Actions worked", plain(total)],
                ["Collectors", plain(collectorCount)],
                ["Clinics touched", plain(clinicCount)],
                ["Average per collector", collectorCount ? plain(Math.round(total / collectorCount)) : "—"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-card border border-hairline bg-surface shadow-card px-4 py-3">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-muted">
                    {label}
                  </div>
                  <div className="tnum mt-1 text-xl font-medium">{value}</div>
                </div>
              ))}
            </div>

            <p className="mt-3 text-sm text-muted">
              Counts only. The source report records how many actions were taken, not what they
              were worth — a dollar figure per action would have to come from the direct
              AdvancedMD connection.
              {otTotal > 0 &&
                ` ${plain(otTotal)} of these are occupational-therapy work, flagged in the report with an OT prefix rather than a column of its own.`}
            </p>

            {/* categories */}
            <section className="mt-8">
              <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">
                What kind of work
              </h2>
              <div className="mt-3 space-y-2">
                {categories.map(([cat, n]) => (
                  <div key={cat} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 text-sm">{cat}</div>
                    <div className="h-4 flex-1 rounded bg-canvas">
                      <div
                        className="h-4 rounded bg-accent/70"
                        style={{ width: `${total ? (n / total) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="tnum w-28 shrink-0 text-right text-sm">
                      {plain(n)}
                      <span className="ml-2 text-xs text-muted">
                        {total ? ((n / total) * 100).toFixed(0) : 0}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* the breakdown, three ways */}
            <section className="mt-8">
              <div className="mb-3 flex justify-end">
                <ExportButtons
                  title={`Collector actions ${selected}`}
                  headers={[view === "action" ? "Action" : view === "collector" ? "Collector" : "Clinic", "Actions", "Share %"]}
                  rows={list.map((r) => [
                    r.label,
                    r.count,
                    total ? Math.round((r.count / total) * 1000) / 10 : 0,
                  ])}
                />
              </div>
              <nav className="flex flex-wrap gap-1 border-b border-hairline">
                {[
                  ["action", "By action"],
                  ["collector", "By collector"],
                  ["clinic", "By clinic"],
                ].map(([k, label]) => (
                  <Link
                    key={k}
                    href={link({ view: k })}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                      view === k
                        ? "border-accent font-medium text-ink"
                        : "border-transparent text-muted hover:text-ink"
                    }`}
                  >
                    {label}
                  </Link>
                ))}
              </nav>

              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={thL}>
                      {view === "action" ? "Action" : view === "collector" ? "Collector" : "Clinic"}
                    </th>
                    <th className={thR}>Actions</th>
                    <th className={thR}>Share</th>
                    <th className={thL} />
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.label} className="border-b border-hairline/60">
                      <td className="py-2 pr-4">
                        {r.label}
                        {r.note && <span className="ml-2 text-xs text-muted">{r.note}</span>}
                      </td>
                      <td className="tnum py-2 text-right">{plain(r.count)}</td>
                      <td className="tnum py-2 text-right text-muted">
                        {total ? ((r.count / total) * 100).toFixed(1) : 0}%
                      </td>
                      <td className="w-1/3 py-2 pl-4">
                        <div className="h-2 rounded bg-canvas">
                          <div
                            className="h-2 rounded bg-accent/60"
                            style={{ width: `${biggest ? (r.count / biggest) * 100 : 0}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="mt-3 text-xs text-muted">
                Bars are relative to the largest row. Actions are counted against their
                canonical name, not the phrase a collector typed — several spellings of the
                same action are added together here rather than split apart.
              </p>
            </section>
          </>
        )}
      </main>
    </>
  );
}
