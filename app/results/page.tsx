import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import Panel from "@/components/Panel";
import ExportButtons from "@/components/ExportButtons";
import Missing from "@/components/Missing";
import { manages, type Profile } from "@/lib/types";
import { fetchAllRows } from "@/lib/fetchAll";
import { DAYS_IN_AR_METHOD, PAYMENT_PER_VISIT_METHOD } from "@/lib/arMetrics";
import {
  clientSnapshot, combinedSnapshot, daysTrend, signals, monthEnd, daysBetween,
  DAYS_IN_AR_TARGET, OVER_120_LIMIT, TREND_TOLERANCE,
  type MonthFacts, type Snapshot, type Signal,
} from "@/lib/results";
import ResultsFilters from "./ResultsFilters";
import { CamPicker, AddonEditor } from "./ResultsAdmin";

/**
 * CLIENT & CAM RESULTS — Michelle's page (spec + mockup, 29 Sep 2026).
 *
 * Built from what MBOne already holds. Each card says where its figures
 * come from and when that source last arrived; a card whose source does
 * not exist yet says what it needs, rather than showing zeros.
 *
 * Company → CAM → client, over a month range. Balances are read at the
 * last month of the range, flows are summed across it, and every ratio is
 * recomputed from its parts — never averaged across clients.
 */

export const dynamic = "force-dynamic";

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const plain = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Math.round(n).toLocaleString("en-US");
const pct1 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);
const monthLabel = (m: string | null) =>
  m ? new Date(`${m}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—";
const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never";

/** Shift a YYYY-MM month by n months. */
function shiftMonth(m: string, n: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const SIGNAL_STYLE: Record<Signal, string> = {
  ok: "bg-good/10 text-good",
  watch: "bg-warn/10 text-warn",
  unknown: "bg-canvas text-muted",
};

function Chip({ s, children, title }: { s: Signal; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${SIGNAL_STYLE[s]}`}>
      {children}
    </span>
  );
}

/** A tiny server-drawn trend line. Gaps (no data) break the line. */
function Spark({ values, limit }: { values: (number | null)[]; limit?: number }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return <span className="text-xs text-muted">—</span>;
  const w = 90, h = 24;
  const max = Math.max(...known, limit ?? 0) * 1.1 || 1;
  const x = (i: number) => (values.length === 1 ? 0 : (i / (values.length - 1)) * w);
  const y = (v: number) => h - (v / max) * h;
  let d = "";
  values.forEach((v, i) => {
    if (v === null) return;
    const prev = i > 0 ? values[i - 1] : null;
    d += `${prev === null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
  });
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden="true">
      {limit !== undefined && (
        <line x1={0} x2={w} y1={y(limit)} y2={y(limit)} stroke="currentColor" strokeDasharray="2 2" className="text-hairline" />
      )}
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-accent" />
    </svg>
  );
}

function Tile({
  title, value, sub, tone,
}: { title: string; value: string; sub: string; tone: "good" | "warn" | "muted" }) {
  const toneCls = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-muted";
  return (
    <div className="rounded-card border border-hairline bg-surface p-4 shadow-card">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{title}</div>
      <div className={`tnum mt-1 text-2xl font-semibold ${toneCls}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </div>
  );
}

function SourceLine({ text }: { text: string }) {
  return <p className="mt-3 border-t border-hairline pt-2 text-[11px] text-muted">{text}</p>;
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; cam?: string; client?: string; system?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profileRow } = await supabase
    .from("profiles").select("id, full_name, email, role, is_active")
    .eq("id", user?.id ?? "").maybeSingle();
  const profile = (profileRow as Profile) ?? null;
  const isManager = manages(profile?.role);

  // ---- reference lists --------------------------------------------------
  const [clinicRes, assignRes, partyRes, peopleRes, monthRes] = await Promise.all([
    // "*" rather than a column list so the page keeps working before
    // migration 031 adds billing_system.
    supabase.from("clinics").select("*").order("name"),
    supabase.from("cam_assignments").select("id, clinic_id, cam_id, party_id, effective_from, effective_to"),
    supabase.from("work_parties").select("id, name, kind, profile_id, is_active").order("name"),
    supabase.from("profiles").select("id, full_name, role"),
    supabase.from("activity_month_list").select("period_month").order("period_month"),
  ]);

  const clinics = (clinicRes.data ?? []) as { id: number; name: string; status: string; billing_system?: string | null }[];
  const parties = (partyRes.data ?? []) as { id: number; name: string; kind: string; profile_id: string | null; is_active: boolean }[];
  const people = (peopleRes.data ?? []) as { id: string; full_name: string | null; role: string }[];
  const assignments = (assignRes.data ?? []) as {
    id: number; clinic_id: number; cam_id: string | null; party_id: number | null;
    effective_from: string; effective_to: string | null;
  }[];
  const months = (monthRes.data ?? []).map((r) => (r.period_month as string).slice(0, 7));

  // ---- the period: defaults to year-to-date of the latest month held ----
  const latest = months[months.length - 1] ?? null;
  const to = searchParams.to && months.includes(searchParams.to) ? searchParams.to : latest;
  const ytdStart = to ? months.find((m) => m >= `${to.slice(0, 4)}-01`) ?? to : null;
  const from = searchParams.from && months.includes(searchParams.from) && to && searchParams.from <= to
    ? searchParams.from : ytdStart;
  const periodEnd = to ? monthEnd(to) : null;
  const periodStart = from ? `${from}-01` : null;
  const periodMonths = from && to ? months.filter((m) => m >= from && m <= to) : [];

  // ---- who owns each client AT THE END OF THE PERIOD -------------------
  // Dated, so looking at last March shows last March's CAM.
  const nameOfParty = new Map(parties.map((p) => [p.id, p.name]));
  const nameOfPerson = new Map(people.map((p) => [p.id, p.full_name ?? "—"]));
  const camOn = (clinicId: number, day: string) => {
    const a = assignments.find(
      (x) => x.clinic_id === clinicId && x.effective_from <= day && (x.effective_to === null || x.effective_to >= day)
    );
    if (!a) return null;
    return {
      name: a.party_id ? nameOfParty.get(a.party_id) ?? null : a.cam_id ? nameOfPerson.get(a.cam_id) ?? null : null,
      id: a.id,
      current: a.effective_to === null,
    };
  };
  const asOfDay = periodEnd ?? new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const active = clinics.filter((c) => c.status === "active");
  const clientList = active.map((c) => ({
    id: c.id, name: c.name, cam: camOn(c.id, asOfDay)?.name ?? null,
    system: c.billing_system ?? "advancedmd",
  }));
  const systemsInUse = Array.from(new Set(clientList.map((c) => c.system))).sort();
  const camNames = Array.from(new Set(clientList.map((c) => c.cam).filter((x): x is string => !!x))).sort();

  const camFilter = searchParams.cam ?? "";
  const clientFilter = searchParams.client ? Number(searchParams.client) : null;
  let scope = clientList;
  if (camFilter === "__none") scope = scope.filter((c) => !c.cam);
  else if (camFilter) scope = scope.filter((c) => c.cam === camFilter);
  // Billing system: Prompt clients do not arrive in the AdvancedMD packs or
  // feed, so being able to look at them apart matters.
  const systemFilter = searchParams.system ?? "";
  if (systemFilter) scope = scope.filter((c) => c.system === systemFilter);
  if (clientFilter) scope = clientList.filter((c) => c.id === clientFilter);
  const scopeIds = scope.map((c) => c.id);

  const scopeLabel = clientFilter
    ? scope[0]?.name ?? "—"
    : camFilter === "__none"
      ? `${scope.length} clients with no CAM set`
      : camFilter
        ? `${camFilter}'s ${scope.length} clients`
        : `all ${scope.length} active clients`;
  const scopeLabelFull = systemFilter && !clientFilter
    ? `${scopeLabel} on ${systemFilter === "prompt" ? "Prompt" : systemFilter === "advancedmd" ? "AdvancedMD" : "another system"}`
    : scopeLabel;

  // ---- monthly facts: the period plus six months before it -------------
  // The extra months are the base for days in A/R and its trend; they are
  // never counted as part of the period.
  const factFrom = from ? `${shiftMonth(from, -6)}-01` : null;
  const factTo = to ? `${to}-01` : null;

  const facts = new Map<number, Map<string, MonthFacts>>();
  const cell = (clinic: number, month: string) => {
    let byM = facts.get(clinic);
    if (!byM) facts.set(clinic, (byM = new Map()));
    let f = byM.get(month);
    if (!f) {
      f = { month, visits: null, payments: null, charges: null, arChange: null, closingAr: null, insTotal: null, ins120: null, insNet: null };
      byM.set(month, f);
    }
    return f;
  };

  if (factFrom && factTo && scopeIds.length) {
    const ranged = <T,>(table: string, cols: string, extra?: (q: any) => any) =>
      fetchAllRows<T>((lo, hi) => {
        let q = supabase.from(table).select(cols)
          .in("clinic_id", scopeIds).gte("period_month", factFrom).lte("period_month", factTo);
        if (extra) q = extra(q);
        return q.order("period_month").order("clinic_id").range(lo, hi) as unknown as PromiseLike<{ data: T[] | null; error: unknown }>;
      });

    const [act, ar, cm, ins] = await Promise.all([
      ranged<{ clinic_id: number; period_month: string; charges: number | null; payments: number | null; visits: number | null }>(
        "activity_clinic_month", "clinic_id, period_month, charges, payments, visits"),
      ranged<{ clinic_id: number; period_month: string; closing_ar: number | null }>(
        "ar_clinic_month", "clinic_id, period_month, closing_ar"),
      ranged<{ clinic_id: number; period_month: string; ar_change: number | null }>(
        "clinic_monthly", "clinic_id, period_month, ar_change"),
      ranged<{ clinic_id: number; period_month: string; total_ar: number | null; bucket_120_plus: number | null; net_ar: number | null }>(
        "ar_split_monthly", "clinic_id, period_month, total_ar, bucket_120_plus, net_ar",
        (q) => q.eq("payer_type", "insurance")),
    ]);

    for (const r of act.rows) {
      const f = cell(r.clinic_id, r.period_month.slice(0, 7));
      f.charges = r.charges !== null ? Number(r.charges) : null;
      f.payments = r.payments !== null ? Number(r.payments) : null;
      f.visits = r.visits !== null ? Number(r.visits) : null;
    }
    for (const r of ar.rows) cell(r.clinic_id, r.period_month.slice(0, 7)).closingAr = r.closing_ar !== null ? Number(r.closing_ar) : null;
    for (const r of cm.rows) cell(r.clinic_id, r.period_month.slice(0, 7)).arChange = r.ar_change !== null ? Number(r.ar_change) : null;
    for (const r of ins.rows) {
      const f = cell(r.clinic_id, r.period_month.slice(0, 7));
      f.insTotal = r.total_ar !== null ? Number(r.total_ar) : null;
      f.ins120 = r.bucket_120_plus !== null ? Number(r.bucket_120_plus) : null;
      f.insNet = r.net_ar !== null ? Number(r.net_ar) : null;
    }
  }

  const historyOf = (id: number) => Array.from(facts.get(id)?.values() ?? []);

  type Row = {
    id: number; name: string; cam: string | null; system: string; camAssignmentId: number | null;
    snap: Snapshot; trend: { month: string; days: number | null }[];
    sig: ReturnType<typeof signals>;
  };
  const rows: Row[] = scope.map((c) => {
    const h = historyOf(c.id);
    const snap = from && to ? clientSnapshot(h, from, to) : clientSnapshot([], "", "");
    const trend = from && to ? daysTrend(h, shiftMonth(from, -3) < from ? shiftMonth(from, -3) : from, to) : [];
    const own = camOn(c.id, today);
    return {
      id: c.id, name: c.name, cam: c.cam, system: c.system,
      camAssignmentId: own?.current ? own.id : null,
      snap, trend, sig: signals(snap, trend),
    };
  });
  const withData = rows.filter((r) => r.snap.monthsWithData > 0);
  const combined = from && to ? combinedSnapshot(withData.map((r) => historyOf(r.id)), from, to) : null;

  // ---- CRL --------------------------------------------------------------
  type Crl = {
    id: number; clinic_id: number | null; entry_date: string | null; responded_on: string | null;
    resolved_on: string | null; status: string; sent_to: string | null;
    cam_id: string | null; party_id: number | null;
  };
  let crl: Crl[] = [];
  let crlError: string | null = null;
  if (periodEnd && scopeIds.length) {
    const res = await fetchAllRows<Crl>((lo, hi) =>
      supabase.from("crl_entries")
        .select("id, clinic_id, entry_date, responded_on, resolved_on, status, sent_to, cam_id, party_id")
        .in("clinic_id", scopeIds).lte("entry_date", periodEnd)
        .order("id").range(lo, hi)
    );
    crl = res.rows;
    crlError = res.error ? String((res.error as { message?: string }).message ?? res.error) : null;
  }
  const isClosed = (c: Crl, day: string) =>
    (c.resolved_on !== null && c.resolved_on <= day) ||
    (c.resolved_on === null && ["resolved", "closed", "written_off"].includes(c.status));
  const crlNew = periodStart && periodEnd ? crl.filter((c) => c.entry_date && c.entry_date >= periodStart && c.entry_date <= periodEnd) : [];
  const crlOpen = periodEnd ? crl.filter((c) => !isClosed(c, periodEnd)) : [];
  const ageEnd = periodEnd && periodEnd < today ? periodEnd : today;
  const oldestOpen = crlOpen
    .filter((c) => c.entry_date)
    .sort((a, b) => (a.entry_date! < b.entry_date! ? -1 : 1))[0] ?? null;
  const responded = crlNew.filter((c) => c.responded_on && c.entry_date);
  const avgResponse = responded.length
    ? responded.reduce((t, c) => t + daysBetween(c.entry_date!, c.responded_on!), 0) / responded.length
    : null;
  const crlOpenBy = new Map<number, number>();
  for (const c of crlOpen) if (c.clinic_id) crlOpenBy.set(c.clinic_id, (crlOpenBy.get(c.clinic_id) ?? 0) + 1);

  // ---- denials ----------------------------------------------------------
  type Den = { denial_code: string | null; denial_type: string | null; amount: number | null; carrier: string | null };
  let denials: Den[] = [];
  let codeInfo = new Map<string, { label: string; category: string | null; preventable: boolean | null }>();
  if (periodStart && periodEnd && scopeIds.length) {
    const [d, codes] = await Promise.all([
      fetchAllRows<Den>((lo, hi) =>
        supabase.from("denials").select("denial_code, denial_type, amount, carrier")
          .in("clinic_id", scopeIds).gte("denial_date", periodStart).lte("denial_date", periodEnd)
          .order("id").range(lo, hi)),
      supabase.from("denial_codes").select("code, label, category, preventable"),
    ]);
    denials = d.rows;
    codeInfo = new Map(((codes.data ?? []) as { code: string; label: string; category: string | null; preventable: boolean | null }[])
      .map((c) => [c.code, c]));
  }
  const denialGroups = new Map<string, { count: number; amount: number; preventable: boolean | null }>();
  for (const d of denials) {
    const info = d.denial_code ? codeInfo.get(d.denial_code) : undefined;
    const key = info?.category || d.denial_type || info?.label || d.denial_code || "Uncategorised";
    const g = denialGroups.get(key) ?? { count: 0, amount: 0, preventable: info?.preventable ?? null };
    g.count += 1;
    g.amount += Number(d.amount ?? 0);
    denialGroups.set(key, g);
  }
  const topDenials = Array.from(denialGroups.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 6);

  // ---- add-on codes -----------------------------------------------------
  const addonRes = await supabase.from("addon_codes").select("code, label").eq("is_active", true).order("code");
  const addonTableMissing = !!addonRes.error;
  const addons = (addonRes.data ?? []) as { code: string; label: string | null }[];
  const addonUse = new Map<string, { units: number; charges: number; desc: string | null }>();
  if (addons.length && from && to && scopeIds.length) {
    const { data: procs } = await supabase.from("procedures").select("id, code, description")
      .in("code", addons.map((a) => a.code));
    const procById = new Map(((procs ?? []) as { id: number; code: string; description: string | null }[]).map((p) => [p.id, p]));
    if (procById.size) {
      const svc = await fetchAllRows<{ procedure_id: number; units: number | null; charges: number | null }>((lo, hi) =>
        supabase.from("service_monthly").select("procedure_id, units, charges")
          .in("clinic_id", scopeIds).in("procedure_id", Array.from(procById.keys()))
          .gte("period_month", `${from}-01`).lte("period_month", `${to}-01`)
          .order("id").range(lo, hi));
      for (const r of svc.rows) {
        const p = procById.get(r.procedure_id);
        if (!p) continue;
        const u = addonUse.get(p.code) ?? { units: 0, charges: 0, desc: p.description };
        u.units += Number(r.units ?? 0);
        u.charges += Number(r.charges ?? 0);
        addonUse.set(p.code, u);
      }
    }
  }
  const addonRows = Array.from(addonUse.entries()).sort((a, b) => b[1].charges - a[1].charges);
  const addonUnits = addonRows.reduce((t, [, u]) => t + u.units, 0);
  const addonCharges = addonRows.reduce((t, [, u]) => t + u.charges, 0);

  // ---- CAM work: tasks assigned to a CAM + "Sent to CAM" actions -------
  // A CAM is anyone holding a CAM assignment who has a login, plus anyone
  // whose role is cam. Tasks are counted by who they were assigned TO.
  const camProfileName = new Map<string, string>();
  for (const p of people) if (p.role === "cam") camProfileName.set(p.id, p.full_name ?? "—");
  for (const p of parties) if (p.profile_id && camNames.includes(p.name)) camProfileName.set(p.profile_id, p.name);
  for (const a of assignments) if (a.cam_id) camProfileName.set(a.cam_id, nameOfPerson.get(a.cam_id) ?? "—");

  type CamRow = { received: number; resolved: number; pending: number; pendingAge: number; sentToCam: number };
  const camWork = new Map<string, CamRow>();
  const camRow = (n: string) => {
    let r = camWork.get(n);
    if (!r) camWork.set(n, (r = { received: 0, resolved: 0, pending: 0, pendingAge: 0, sentToCam: 0 }));
    return r;
  };

  if (periodStart && periodEnd && camProfileName.size) {
    const tasks = await fetchAllRows<{ assigned_to: string | null; created_at: string; completed_at: string | null; status: string; clinic_id: number | null }>((lo, hi) =>
      supabase.from("tasks").select("assigned_to, created_at, completed_at, status, clinic_id")
        .in("assigned_to", Array.from(camProfileName.keys()))
        .lte("created_at", `${periodEnd}T23:59:59`)
        .order("id").range(lo, hi));
    for (const t of tasks.rows) {
      const name = t.assigned_to ? camProfileName.get(t.assigned_to) : undefined;
      if (!name) continue;
      // A CAM filter shows that CAM's own work; a client filter shows only
      // tasks raised about that client.
      if (camFilter && camFilter !== "__none" && name !== camFilter) continue;
      if (clientFilter && t.clinic_id !== clientFilter) continue;
      const r = camRow(name);
      const created = t.created_at.slice(0, 10);
      const done = t.completed_at?.slice(0, 10) ?? null;
      if (t.status === "cancelled") continue;
      if (created >= periodStart) r.received += 1;
      if (done && done >= periodStart && done <= periodEnd) r.resolved += 1;
      if (!done || done > periodEnd) {
        r.pending += 1;
        r.pendingAge += daysBetween(created, ageEnd);
      }
    }
  }

  // ---- collector actions (and the "Sent to CAM" count per CAM) ---------
  type Act = { clinic_id: number; collector_id: number; action_type_id: number; action_count: number };
  let actions: Act[] = [];
  const [actTypesRes, collectorsRes, actionBatchRes, packBatchRes] = await Promise.all([
    supabase.from("action_types").select("id, name, category"),
    supabase.from("collectors").select("id, code, display_name"),
    supabase.from("import_batches").select("finished_at, started_at, period_month")
      .eq("report_kind", "collection_actions").in("status", ["success", "partial"])
      .order("started_at", { ascending: false }).limit(1),
    supabase.from("import_batches").select("finished_at, started_at, period_month")
      .eq("report_kind", "amd_monthly_pack").in("status", ["success", "partial"])
      .order("started_at", { ascending: false }).limit(1),
  ]);
  if (from && to && scopeIds.length) {
    const res = await fetchAllRows<Act>((lo, hi) =>
      supabase.from("collection_actions_monthly").select("clinic_id, collector_id, action_type_id, action_count")
        .in("clinic_id", scopeIds).gte("period_month", `${from}-01`).lte("period_month", `${to}-01`)
        .order("id").range(lo, hi));
    actions = res.rows;
  }
  const actType = new Map(((actTypesRes.data ?? []) as { id: number; name: string; category: string | null }[]).map((a) => [a.id, a]));
  const collName = new Map(((collectorsRes.data ?? []) as { id: number; code: string; display_name: string | null }[])
    .map((c) => [c.id, c.display_name || c.code]));
  const sentToCamIds = new Set(Array.from(actType.values()).filter((a) => /sent to cam/i.test(a.name)).map((a) => a.id));
  const clientCam = new Map(scope.map((c) => [c.id, c.cam]));

  const byCollector = new Map<string, { actions: number; clinics: Set<number>; top: Map<string, number> }>();
  for (const a of actions) {
    const n = collName.get(a.collector_id) ?? `#${a.collector_id}`;
    const g = byCollector.get(n) ?? { actions: 0, clinics: new Set<number>(), top: new Map<string, number>() };
    g.actions += a.action_count;
    g.clinics.add(a.clinic_id);
    const t = actType.get(a.action_type_id)?.name ?? "—";
    g.top.set(t, (g.top.get(t) ?? 0) + a.action_count);
    byCollector.set(n, g);
    if (sentToCamIds.has(a.action_type_id)) {
      const cam = clientCam.get(a.clinic_id);
      if (cam) camRow(cam).sentToCam += a.action_count;
    }
  }
  const collectorRows = Array.from(byCollector.entries()).sort((a, b) => b[1].actions - a[1].actions);
  const totalActions = collectorRows.reduce((t, [, g]) => t + g.actions, 0);
  const camRows = Array.from(camWork.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const camPending = camRows.reduce((t, [, r]) => t + r.pending, 0);

  const packBatch = (packBatchRes.data ?? [])[0] as { finished_at: string | null; started_at: string } | undefined;
  const actionBatch = (actionBatchRes.data ?? [])[0] as { finished_at: string | null; started_at: string } | undefined;
  const packSource = `Source: AdvancedMD monthly packs (Mgmt Summary, Financial Class A-R, Financial Activity). Last import ${shortDate(packBatch?.finished_at ?? packBatch?.started_at)}.`;

  // ---- headline counts --------------------------------------------------
  const daysKnown = rows.filter((r) => r.sig.days !== "unknown");
  const daysOk = daysKnown.filter((r) => r.sig.days === "ok").length;
  const agingKnown = rows.filter((r) => r.sig.aging !== "unknown");
  const agingOk = agingKnown.filter((r) => r.sig.aging === "ok").length;

  // ---- snapshot table: metrics down, clients across (her layout) -------
  const columns: { key: string; label: string; sub: string | null; snap: Snapshot }[] = [
    ...(combined && withData.length > 1
      ? [{ key: "all", label: clientFilter ? "Selected" : camFilter ? "All of these" : "All clients", sub: `${withData.length} with figures`, snap: combined }]
      : []),
    ...rows.map((r) => ({
      key: String(r.id), label: r.name,
      sub: [r.cam, r.system === "prompt" ? "Prompt" : null].filter(Boolean).join(" · ") || null,
      snap: r.snap,
    })),
  ];
  const METRICS: { label: string; get: (s: Snapshot) => string; raw: (s: Snapshot) => number | null; neg?: boolean; flag?: (s: Snapshot) => boolean; note?: string }[] = [
    { label: "Visits", get: (s) => plain(s.visits), raw: (s) => s.visits },
    { label: "Payments", get: (s) => money(s.payments), raw: (s) => s.payments },
    { label: "Change in A/R", get: (s) => money(s.arChange), raw: (s) => s.arChange, neg: true },
    { label: "Avg payment per visit", get: (s) => money(s.paymentPerVisit), raw: (s) => s.paymentPerVisit, note: PAYMENT_PER_VISIT_METHOD },
    { label: "Days in A/R", get: (s) => plain(s.daysInAr), raw: (s) => s.daysInAr, flag: (s) => s.daysInAr !== null && s.daysInAr > DAYS_IN_AR_TARGET, note: DAYS_IN_AR_METHOD },
    { label: "% 120+ in carrier A/R", get: (s) => pct1(s.over120Share), raw: (s) => s.over120Share, flag: (s) => s.over120Share !== null && s.over120Share >= OVER_120_LIMIT, note: "insurance 120+ over insurance A/R, at the last month" },
    { label: "Total insurance net A/R", get: (s) => money(s.insNetAr), raw: (s) => s.insNetAr, note: "insurance side only, at the last month" },
  ];

  const exportHeaders = ["Metric", ...columns.map((c) => c.label)];
  const exportRows = METRICS.map((m) => [m.label, ...columns.map((c) => {
    const v = m.raw(c.snap);
    return v === null ? null : Math.round(v * 100) / 100;
  })]);

  const portfolioHeaders = ["Client", "CAM", "Days in A/R", "% 120+ insurance", "Days in A/R trend %", "Insurance net A/R", "Open CRL", "Figures as of"];
  const portfolioRows = rows.map((r) => [
    r.name, r.cam, r.snap.daysInAr,
    r.snap.over120Share === null ? null : Math.round(r.snap.over120Share * 10) / 10,
    r.sig.change === null ? null : Math.round(r.sig.change),
    r.snap.insNetAr, crlOpenBy.get(r.id) ?? 0, r.snap.asOf,
  ]);

  const camParties = parties.filter((p) => p.is_active && (p.kind === "person")).map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-1 text-xs font-medium uppercase tracking-wider text-accent">Operations</div>
        <h1 className="text-2xl font-semibold">Client &amp; CAM results</h1>
        <p className="mt-1 text-sm text-muted">
          {scopeLabelFull} · {monthLabel(from)} to {monthLabel(to)}
          {periodMonths.length ? ` (${periodMonths.length} month${periodMonths.length === 1 ? "" : "s"} of figures)` : ""}
        </p>

        <div className="mt-5">
          {months.length ? (
            <ResultsFilters
              months={months} from={from!} to={to!}
              cams={camNames} cam={camFilter}
              systems={systemsInUse} system={systemFilter}
              clients={clientList} client={clientFilter}
            />
          ) : (
            <Missing needs="No monthly figures have been imported yet. Import a monthly pack (Settings → Import a pack) and this page fills in." />
          )}
        </div>

        {camNames.length === 0 && (
          <p className="mt-4 rounded-card border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-ink">
            No client has a CAM set yet, so the CAM filter is empty. Run migration 030 (it loads the CAM list from the
            production template), or set a CAM per client in the portfolio table at the bottom of this page.
          </p>
        )}

        {/* ---------------- Overall health ---------------- */}
        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            title="A/R health"
            value={daysKnown.length ? `${daysOk} of ${daysKnown.length}` : "—"}
            sub={`clients at or under ${DAYS_IN_AR_TARGET} days in A/R · ${agingKnown.length ? `${agingOk} of ${agingKnown.length}` : "—"} under ${OVER_120_LIMIT}% past 120`}
            tone={daysKnown.length && daysOk === daysKnown.length ? "good" : daysKnown.length ? "warn" : "muted"}
          />
          <Tile
            title="Client responsiveness (CRL)"
            value={crlOpen.length ? `${crlOpen.length} open` : crl.length ? "0 open" : "—"}
            sub={oldestOpen ? `oldest waiting ${daysBetween(oldestOpen.entry_date!, ageEnd)} days` : crl.length ? "nothing outstanding" : "no CRL entries in scope"}
            tone={crlOpen.length ? "warn" : crl.length ? "good" : "muted"}
          />
          <Tile
            title="CAM workload"
            value={camRows.length ? `${camPending} pending` : "—"}
            sub={camRows.length ? `across ${camRows.length} CAM${camRows.length === 1 ? "" : "s"} at period end` : "no tasks assigned to CAMs yet"}
            tone={camRows.length ? (camPending ? "warn" : "good") : "muted"}
          />
          <Tile
            title="Collector workload"
            value={totalActions ? plain(totalActions) : "—"}
            sub={totalActions ? `actions by ${collectorRows.length} collectors in the period` : "no collection action report for this period"}
            tone="muted"
          />
        </section>
        <p className="mt-2 text-[11px] text-muted">
          These are kept as separate counts on purpose, not one health score. Michelle&apos;s spec: a combined grade needs
          an agreed trend window and tolerance first.
        </p>

        {/* ---------------- YTD snapshot ---------------- */}
        <div className="mt-6">
          <Panel
            id="results.snapshot"
            title="Dashboard snapshot"
            subtitle={`${monthLabel(from)} – ${monthLabel(to)}`}
            right={<ExportButtons headers={exportHeaders} rows={exportRows} title={`Client results ${from} to ${to}`} />}
          >
            {columns.length === 0 || withData.length === 0 ? (
              <Missing needs="No figures for these clients in this period. Pick another period, or import their monthly packs." />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium text-muted">Metric</th>
                      {columns.map((c) => (
                        <th key={c.key} className={`px-3 py-2 text-right align-bottom ${c.key === "all" ? "bg-accentSoft" : ""}`}>
                          {c.key === "all" ? (
                            <span className="font-semibold">{c.label}</span>
                          ) : (
                            <Link href={`/clinics/${c.key}${to ? `?month=${to}` : ""}`} className="font-medium text-accent hover:underline">
                              {c.label}
                            </Link>
                          )}
                          <div className="text-[11px] font-normal text-muted">{c.sub ?? "no CAM"}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {METRICS.map((m) => (
                      <tr key={m.label} className="border-b border-hairline/60">
                        <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-left" title={m.note}>
                          {m.label}
                          {m.note && <span className="ml-1 cursor-help text-muted">ⓘ</span>}
                        </td>
                        {columns.map((c) => {
                          const v = m.raw(c.snap);
                          const red = (m.neg && v !== null && v > 0) || (m.flag && m.flag(c.snap));
                          return (
                            <td key={c.key} className={`tnum whitespace-nowrap px-3 py-2 text-right ${c.key === "all" ? "bg-accentSoft font-semibold" : ""} ${red ? "text-bad" : ""}`}>
                              {m.get(c.snap)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr>
                      <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-xs text-muted">Balances as of</td>
                      {columns.map((c) => (
                        <td key={c.key} className={`px-3 py-2 text-right text-xs text-muted ${c.key === "all" ? "bg-accentSoft" : ""}`}>
                          {monthLabel(c.snap.asOf)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <SourceLine
              text={`${packSource} Visits, payments and change in A/R are summed over the period; A/R balances are the last month's; every ratio is recomputed from its parts, never averaged across clients. A rise in A/R shows red. Days in A/R and payment per visit use provisional formulas until Monty and David confirm Momentum's own.`}
            />
          </Panel>
        </div>

        {/* ---------------- Denials + CRL ---------------- */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel id="results.denials" title="Top denial reasons" subtitle={`${denials.length} denials`}>
            {topDenials.length === 0 ? (
              <Missing needs="No denials recorded for these clients in this period. They arrive from the AdvancedMD Denial Module or payment reason report (Settings → Import any report → Denials), or are entered on the Denials page." />
            ) : (
              <div className="space-y-2">
                {topDenials.map(([k, g]) => {
                  const share = (g.count / denials.length) * 100;
                  return (
                    <div key={k}>
                      <div className="flex justify-between text-sm">
                        <span>
                          {k}
                          {g.preventable && <span className="ml-2 rounded-full bg-warn/10 px-1.5 text-[10px] text-warn">preventable</span>}
                        </span>
                        <span className="tnum text-muted">{g.count} · {share.toFixed(0)}% · {money(g.amount)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded bg-canvas">
                        <div className="h-1.5 rounded bg-accent" style={{ width: `${share}%` }} />
                      </div>
                    </div>
                  );
                })}
                <Link href="/denials" className="inline-block pt-1 text-xs text-accent hover:underline">Open the denials report →</Link>
              </div>
            )}
            <SourceLine text="Grouped by the category set on each denial code (Denials → codes). Counted per denial row. Still to agree with Michelle: count by claim, visit or line, and which adjustment types are not true denials." />
          </Panel>

          <Panel id="results.crl" title="Client request log (CRL)" subtitle="client responsiveness">
            {crlError ? (
              <Missing needs="The CRL table is missing the dates this card needs. Run migration 030." />
            ) : crl.length === 0 ? (
              <Missing needs="No CRL entries for these clients yet. Entries are added on the CRL page or imported (Settings → Import any report → CRL)." />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Requests in period", plain(crlNew.length)],
                  ["Open at period end", plain(crlOpen.length)],
                  ["Oldest open item", oldestOpen ? `${daysBetween(oldestOpen.entry_date!, ageEnd)} days` : "—"],
                  ["Avg response", avgResponse === null ? "—" : `${avgResponse.toFixed(1)} days`],
                ].map(([l, v]) => (
                  <div key={l} className="rounded border border-hairline p-3">
                    <div className="text-[11px] text-muted">{l}</div>
                    <div className="tnum mt-1 text-xl font-semibold">{v}</div>
                  </div>
                ))}
              </div>
            )}
            {oldestOpen && (
              <p className="mt-2 text-xs text-muted">
                Oldest open request dated {shortDate(oldestOpen.entry_date)} at{" "}
                {clinics.find((c) => c.id === oldestOpen.clinic_id)?.name ?? "—"}.{" "}
                <Link href="/crl" className="text-accent hover:underline">Open the CRL →</Link>
              </p>
            )}
            <SourceLine text="Response time = the date the client answered minus the request date, for requests made in the period. No pass/fail compliance grade until a response target is agreed." />
          </Panel>
        </div>

        {/* ---------------- Over-25 visits + add-on codes ---------------- */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel id="results.over25" title="Patients over 25 visits" subtitle="year to date">
            <Missing needs="Needs a year-to-date visit report counted by unique patient, which MBOne does not receive yet. The plan: the AdvancedMD query returns just two numbers per client — patients with more than 25 completed visits, and all patients seen — so no patient detail leaves AdvancedMD." />
            <SourceLine text="To confirm with Michelle: what counts as a completed visit, and how merged or transferred patient records are handled." />
          </Panel>

          <Panel id="results.addons" title="Add-on code utilization" subtitle={`${monthLabel(from)} – ${monthLabel(to)}`}>
            {addonTableMissing ? (
              <Missing needs="The add-on code list does not exist yet. Run migration 030." />
            ) : addons.length === 0 ? (
              <Missing needs="No add-on codes chosen yet. Momentum decides which CPT codes count; add them below and this card fills from the Service Details already imported." />
            ) : addonRows.length === 0 ? (
              <Missing needs="None of the chosen add-on codes were billed by these clients in this period." />
            ) : (
              <>
                <div className="mb-3 flex gap-6">
                  <div><div className="text-[11px] text-muted">Units</div><div className="tnum text-xl font-semibold">{plain(addonUnits)}</div></div>
                  <div><div className="text-[11px] text-muted">Charges</div><div className="tnum text-xl font-semibold">{money(addonCharges)}</div></div>
                </div>
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-hairline text-xs text-muted">
                    <th className="py-1 text-left font-medium">CPT</th><th className="py-1 text-left font-medium">Description</th>
                    <th className="py-1 text-right font-medium">Units</th><th className="py-1 text-right font-medium">Charges</th>
                  </tr></thead>
                  <tbody>
                    {addonRows.map(([code, u]) => (
                      <tr key={code} className="border-b border-hairline/60">
                        <td className="tnum py-1">{code}</td>
                        <td className="py-1 text-muted">{u.desc ?? "—"}</td>
                        <td className="tnum py-1 text-right">{plain(u.units)}</td>
                        <td className="tnum py-1 text-right">{money(u.charges)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {isManager && !addonTableMissing && <AddonEditor codes={addons} />}
            <SourceLine text="Source: Service Details in the monthly pack — units and BILLED CHARGES by CPT. Payments by code and a provider breakdown are not in the pack; they need a transaction-level report." />
          </Panel>
        </div>

        {/* ---------------- CAM + collector work ---------------- */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel id="results.camtasks" title="CAM tasks" subtitle="received · resolved · pending">
            {camRows.length === 0 ? (
              <Missing needs="No tasks assigned to a CAM and no 'Sent to CAM' actions for these clients in this period. Tasks count once CAMs have logins and work is assigned to them on the Tasks page; EMR messages need an export." />
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-hairline text-xs text-muted">
                  <th className="py-1 text-left font-medium">CAM</th>
                  <th className="py-1 text-right font-medium">Received</th>
                  <th className="py-1 text-right font-medium">Resolved</th>
                  <th className="py-1 text-right font-medium">Pending</th>
                  <th className="py-1 text-right font-medium">Avg age</th>
                  <th className="py-1 text-right font-medium" title="Collection actions recorded as 'Sent to CAM' for this CAM's clients">Sent to CAM</th>
                </tr></thead>
                <tbody>
                  {camRows.map(([n, r]) => (
                    <tr key={n} className="border-b border-hairline/60">
                      <td className="py-1">{n}</td>
                      <td className="tnum py-1 text-right">{r.received}</td>
                      <td className="tnum py-1 text-right">{r.resolved}</td>
                      <td className={`tnum py-1 text-right ${r.pending ? "text-warn" : ""}`}>{r.pending}</td>
                      <td className="tnum py-1 text-right">{r.pending ? `${(r.pendingAge / r.pending).toFixed(1)} d` : "—"}</td>
                      <td className="tnum py-1 text-right">{r.sentToCam || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <SourceLine text="Received = created in the period; resolved = completed in the period; pending = still open at period end, older carry-over included. Source: MBOne tasks assigned to a CAM, and 'Sent to CAM' from the collection action report. EMR messaging is not connected yet." />
          </Panel>

          <Panel id="results.collectors" title="Collector work" subtitle={`${monthLabel(from)} – ${monthLabel(to)}`}>
            {collectorRows.length === 0 ? (
              <Missing needs="No collection action report imported for these clients in this period (Settings → Import actions)." />
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-hairline text-xs text-muted">
                  <th className="py-1 text-left font-medium">Collector</th>
                  <th className="py-1 text-right font-medium">Actions</th>
                  <th className="py-1 text-right font-medium">Clients</th>
                  <th className="py-1 text-left pl-4 font-medium">Most frequent action</th>
                </tr></thead>
                <tbody>
                  {collectorRows.slice(0, 12).map(([n, g]) => {
                    const top = Array.from(g.top.entries()).sort((a, b) => b[1] - a[1])[0];
                    return (
                      <tr key={n} className="border-b border-hairline/60">
                        <td className="py-1">{n}</td>
                        <td className="tnum py-1 text-right">{plain(g.actions)}</td>
                        <td className="tnum py-1 text-right">{g.clinics.size}</td>
                        <td className="py-1 pl-4 text-muted">{top ? `${top[0]} (${top[1]})` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <SourceLine text={`Source: collection action report, last imported ${shortDate(actionBatch?.finished_at ?? actionBatch?.started_at)}. Counts of actions worked — the report has no received/resolved/pending state per task, and no latest note or next step. Those need the AdvancedMD collections module export (and Prompt's notes for Prompt clients), expected weekly via ODBC.`} />
            {collectorRows.length > 0 && <Link href="/actions" className="mt-1 inline-block text-xs text-accent hover:underline">Open collector actions →</Link>}
          </Panel>
        </div>

        {/* ---------------- Client portfolio ---------------- */}
        <div className="mt-6">
          <Panel
            id="results.portfolio"
            title="Client portfolio"
            subtitle={`${rows.length} clients`}
            right={<ExportButtons headers={portfolioHeaders} rows={portfolioRows} title={`Client portfolio ${to}`} />}
          >
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-muted">
                    <th className="px-2 py-2 text-left font-medium">Client</th>
                    <th className="px-2 py-2 text-left font-medium">CAM</th>
                    <th className="px-2 py-2 text-right font-medium">Days in A/R</th>
                    <th className="px-2 py-2 text-left font-medium">Trend</th>
                    <th className="px-2 py-2 text-right font-medium">% 120+ ins.</th>
                    <th className="px-2 py-2 text-right font-medium">Insurance net A/R</th>
                    <th className="px-2 py-2 text-right font-medium">Open CRL</th>
                    <th className="px-2 py-2 text-left font-medium">Signals</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-hairline/60 align-middle">
                      <td className="px-2 py-2">
                        <Link href={`/results?${new URLSearchParams({ from: from ?? "", to: to ?? "", client: String(r.id) })}`} className="font-medium text-accent hover:underline">
                          {r.name}
                        </Link>
                        {r.system === "prompt" && (
                          <span className="ml-2 rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brandMid" title="Bills in Prompt, not AdvancedMD">
                            Prompt
                          </span>
                        )}
                        {r.snap.asOf && to && r.snap.asOf < to && (
                          <div className="text-[11px] text-warn">figures only to {monthLabel(r.snap.asOf)}</div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <span className={r.cam ? "" : "text-muted"}>{r.cam ?? "not set"}</span>
                        {isManager && (
                          <span className="ml-2">
                            <CamPicker clinicId={r.id} current={r.cam} currentAssignmentId={r.camAssignmentId} parties={camParties} />
                          </span>
                        )}
                      </td>
                      <td className="tnum px-2 py-2 text-right">{plain(r.snap.daysInAr)}</td>
                      <td className="px-2 py-2"><Spark values={r.trend.map((t) => t.days)} limit={DAYS_IN_AR_TARGET} /></td>
                      <td className={`tnum px-2 py-2 text-right ${r.sig.aging === "watch" ? "text-bad" : ""}`}>{pct1(r.snap.over120Share)}</td>
                      <td className="tnum px-2 py-2 text-right">{money(r.snap.insNetAr)}</td>
                      <td className="tnum px-2 py-2 text-right">{crlOpenBy.get(r.id) ?? 0}</td>
                      <td className="space-x-1 whitespace-nowrap px-2 py-2">
                        {r.snap.monthsWithData === 0 ? (
                          <span className="text-xs text-muted">
                            {r.system === "prompt"
                              ? "Prompt client — needs a Prompt export, not in the AdvancedMD packs"
                              : "nothing imported"}
                          </span>
                        ) : (
                          <>
                            <Chip s={r.sig.days} title={`Days in A/R against ${DAYS_IN_AR_TARGET}`}>
                              {r.sig.days === "unknown" ? "days ?" : r.sig.days === "ok" ? `≤${DAYS_IN_AR_TARGET} days` : `>${DAYS_IN_AR_TARGET} days`}
                            </Chip>
                            <Chip s={r.sig.aging} title={`Insurance 120+ against ${OVER_120_LIMIT}%`}>
                              {r.sig.aging === "unknown" ? "120+ ?" : r.sig.aging === "ok" ? `120+ <${OVER_120_LIMIT}%` : `120+ ≥${OVER_120_LIMIT}%`}
                            </Chip>
                            <Chip
                              s={r.sig.direction}
                              title={`Latest days in A/R against the client's own previous three months; rising more than ${TREND_TOLERANCE}% is flagged`}
                            >
                              {r.sig.direction === "unknown"
                                ? "trend ?"
                                : r.sig.direction === "ok"
                                  ? "steady"
                                  : `rising ${Math.round(r.sig.change ?? 0)}%`}
                            </Chip>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SourceLine
              text={`Each signal is judged on its own: days in A/R against ${DAYS_IN_AR_TARGET}; insurance 120+ strictly under ${OVER_120_LIMIT}%; and the trend, the latest days in A/R against the client's own previous three months (more than ${TREND_TOLERANCE}% higher is flagged). These are starting points from Michelle's spec, to be confirmed. CAM changes keep their history: the old assignment is closed, not overwritten.`}
            />
          </Panel>
        </div>
      </main>
    </>
  );
}
