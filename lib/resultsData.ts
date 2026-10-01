/**
 * Everything the Client & CAM Results pages show, loaded and computed in
 * one place. Every section of /results reads from this, so the dashboard
 * card and the full table behind it can never disagree.
 *
 * Filters (the bar at the top of every section):
 *   start / end   dates. Monthly figures use every month the range touches;
 *                 dated records (CRL, denials, tasks) use the exact dates.
 *   cam           one CAM's clients, or "__none" for clients with no CAM
 *   client        one client
 *   collector     clients that collector worked in the period
 *   system        billing system (advancedmd / prompt / other)
 *   view          "client" or "cam" — the snapshot's columns
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/fetchAll";
import {
  clientSnapshot, combinedSnapshot, daysTrend, signals, monthEnd, daysBetween,
  type MonthFacts, type Snapshot,
} from "@/lib/results";

export type Params = {
  start?: string; end?: string; cam?: string; client?: string;
  collector?: string; system?: string; view?: string; section?: string;
};

export type Health = "on_track" | "watch" | "attention" | "unknown";

export type ClientRow = {
  id: number; name: string; code: string | null; cam: string | null; system: string;
  camAssignmentId: number | null;
  collector: string | null;            // the collector with the most actions in the period
  snap: Snapshot;
  closingAr: number | null;
  trend: { month: string; days: number | null }[];
  sig: ReturnType<typeof signals>;
  health: Health;
  crlOpen: number;
  crlRate: number | null;              // % of the period's requests answered or closed
  actions: number;
};

export type CrlStats = {
  requests: number; pending: number; oldestDays: number | null; avgResponse: number | null;
  rate: number | null; oldestClinic: string | null; oldestDate: string | null;
};

const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const validDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/**
 * One overall status per client, as the mockup shows. The rule is simple
 * and printed on screen, because a status nobody can explain is one
 * nobody trusts: every known signal fine → On track; one flagged → Watch
 * closely; two or more → Needs attention. Provisional until Michelle and
 * Monty agree the real rule (her spec asks for that agreement).
 */
export const HEALTH_RULE =
  "On track = days in A/R, 120+ share and trend all within target. Watch closely = one of the three outside. Needs attention = two or more.";

function healthOf(sig: ReturnType<typeof signals>): Health {
  const s = [sig.days, sig.aging, sig.direction];
  const known = s.filter((x) => x !== "unknown");
  if (!known.length) return "unknown";
  const bad = known.filter((x) => x === "watch").length;
  return bad === 0 ? "on_track" : bad === 1 ? "watch" : "attention";
}

export const HEALTH_LABEL: Record<Health, string> = {
  on_track: "On track", watch: "Watch closely", attention: "Needs attention", unknown: "No figures",
};
export const HEALTH_TONE: Record<Health, "good" | "warn" | "bad" | "muted"> = {
  on_track: "good", watch: "warn", attention: "bad", unknown: "muted",
};

export async function loadResults(supabase: SupabaseClient, p: Params) {
  const today = isoDay(new Date());

  // ---- reference lists --------------------------------------------------
  const [clinicRes, assignRes, partyRes, peopleRes, monthRes, arMonthRes, collRes, typeRes] = await Promise.all([
    supabase.from("clinics").select("*").order("name"),
    supabase.from("cam_assignments").select("id, clinic_id, cam_id, party_id, effective_from, effective_to"),
    supabase.from("work_parties").select("id, name, kind, profile_id, is_active").order("name"),
    supabase.from("profiles").select("id, full_name, role"),
    supabase.from("activity_month_list").select("period_month").order("period_month"),
    // A/R months too: a Prompt client can have A/R before any visits figures arrive.
    supabase.from("ar_month_list").select("period_month").order("period_month"),
    supabase.from("collectors").select("id, code, display_name"),
    supabase.from("action_types").select("id, name, category"),
  ]);

  const clinics = (clinicRes.data ?? []) as { id: number; name: string; code: string | null; status: string; billing_system?: string | null }[];
  const parties = (partyRes.data ?? []) as { id: number; name: string; kind: string; profile_id: string | null; is_active: boolean }[];
  const people = (peopleRes.data ?? []) as { id: string; full_name: string | null; role: string }[];
  const assignments = (assignRes.data ?? []) as {
    id: number; clinic_id: number; cam_id: string | null; party_id: number | null;
    effective_from: string; effective_to: string | null;
  }[];
  const months = Array.from(new Set(
    [...(monthRes.data ?? []), ...(arMonthRes.data ?? [])].map((r) => (r.period_month as string).slice(0, 7))
  )).sort();
  const collName = new Map(((collRes.data ?? []) as { id: number; code: string; display_name: string | null }[])
    .map((c) => [c.id, c.display_name || c.code]));
  const actType = new Map(((typeRes.data ?? []) as { id: number; name: string; category: string | null }[]).map((a) => [a.id, a]));

  // ---- the period -------------------------------------------------------
  // Default: the calendar year of the latest month that has figures, up to
  // the end of that month — "year to date" in the data's own terms.
  const latest = months[months.length - 1] ?? today.slice(0, 7);
  const defEnd = monthEnd(latest);
  const defStart = `${latest.slice(0, 4)}-01-01`;
  let start = validDay(p.start) ? p.start! : defStart;
  let end = validDay(p.end) ? p.end! : defEnd;
  if (start > end) [start, end] = [end, start];
  const from = start.slice(0, 7);
  const to = end.slice(0, 7);
  const periodMonths = months.filter((m) => m >= from && m <= to);

  // The same length of time immediately before, for "vs last period".
  const spanDays = daysBetween(start, end) + 1;
  const prevEnd = isoDay(new Date(Date.parse(start) - 86_400_000));
  const prevStart = isoDay(new Date(Date.parse(start) - spanDays * 86_400_000));

  // ---- CAM on a given day -----------------------------------------------
  const nameOfParty = new Map(parties.map((x) => [x.id, x.name]));
  const nameOfPerson = new Map(people.map((x) => [x.id, x.full_name ?? "—"]));
  const camOn = (clinicId: number, day: string) => {
    const a = assignments.find(
      (x) => x.clinic_id === clinicId && x.effective_from <= day && (x.effective_to === null || x.effective_to >= day)
    );
    if (!a) return null;
    return {
      name: a.party_id ? nameOfParty.get(a.party_id) ?? null : a.cam_id ? nameOfPerson.get(a.cam_id) ?? null : null,
      id: a.id, current: a.effective_to === null,
    };
  };

  const active = clinics.filter((c) => c.status === "active");
  const clientList = active.map((c) => ({
    id: c.id, name: c.name, code: c.code ?? null,
    cam: camOn(c.id, end)?.name ?? null,
    system: c.billing_system ?? "advancedmd",
  }));
  const camNames = Array.from(new Set(clientList.map((c) => c.cam).filter((x): x is string => !!x))).sort();
  const systems = Array.from(new Set(clientList.map((c) => c.system))).sort();

  // ---- collection actions in the period (needed for the collector filter)
  type Act = { clinic_id: number; collector_id: number; action_type_id: number; action_count: number; period_month: string };
  const allActions = (await fetchAllRows<Act>((lo, hi) =>
    supabase.from("collection_actions_monthly")
      .select("clinic_id, collector_id, action_type_id, action_count, period_month")
      .gte("period_month", `${from}-01`).lte("period_month", `${to}-01`)
      .order("id").range(lo, hi))).rows;
  const collectorNames = Array.from(new Set(allActions.map((a) => collName.get(a.collector_id) ?? `#${a.collector_id}`))).sort();

  // ---- scope ------------------------------------------------------------
  const cam = p.cam ?? "";
  const clientId = p.client ? Number(p.client) : null;
  const collector = p.collector ?? "";
  const system = p.system ?? "";
  let scope = clientList;
  if (cam === "__none") scope = scope.filter((c) => !c.cam);
  else if (cam) scope = scope.filter((c) => c.cam === cam);
  if (system) scope = scope.filter((c) => c.system === system);
  if (collector) {
    const worked = new Set(allActions.filter((a) => (collName.get(a.collector_id) ?? `#${a.collector_id}`) === collector).map((a) => a.clinic_id));
    scope = scope.filter((c) => worked.has(c.id));
  }
  if (clientId) scope = clientList.filter((c) => c.id === clientId);
  const scopeIds = scope.map((c) => c.id);
  const inScope = new Set(scopeIds);

  const parts: string[] = [];
  if (clientId) parts.push(scope[0]?.name ?? "—");
  else {
    if (cam === "__none") parts.push("clients with no CAM");
    else if (cam) parts.push(`${cam}'s clients`);
    else parts.push("all active clients");
    if (collector) parts.push(`worked by ${collector}`);
    if (system) parts.push(`on ${system === "prompt" ? "Prompt" : system === "advancedmd" ? "AdvancedMD" : "another system"}`);
  }
  const scopeLabel = `${parts.join(" ")} (${scope.length})`;

  // ---- monthly facts: the period plus six months before -----------------
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
  if (scopeIds.length) {
    const factFrom = `${shiftMonth(from, -6)}-01`;
    const factTo = `${to}-01`;
    const ranged = <T,>(table: string, cols: string, extra?: (q: any) => any) => // eslint-disable-line @typescript-eslint/no-explicit-any
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
        "ar_split_monthly", "clinic_id, period_month, total_ar, bucket_120_plus, net_ar", (q) => q.eq("payer_type", "insurance")),
    ]);
    const n = (x: number | null) => (x === null ? null : Number(x));
    for (const r of act.rows) {
      const f = cell(r.clinic_id, r.period_month.slice(0, 7));
      f.charges = n(r.charges); f.payments = n(r.payments); f.visits = n(r.visits);
    }
    for (const r of ar.rows) cell(r.clinic_id, r.period_month.slice(0, 7)).closingAr = n(r.closing_ar);
    for (const r of cm.rows) cell(r.clinic_id, r.period_month.slice(0, 7)).arChange = n(r.ar_change);
    for (const r of ins.rows) {
      const f = cell(r.clinic_id, r.period_month.slice(0, 7));
      f.insTotal = n(r.total_ar); f.ins120 = n(r.bucket_120_plus); f.insNet = n(r.net_ar);
    }
  }
  const historyOf = (id: number) => Array.from(facts.get(id)?.values() ?? []);

  // ---- CRL ----------------------------------------------------------------
  type Crl = {
    id: number; clinic_id: number | null; entry_date: string | null; responded_on: string | null;
    resolved_on: string | null; status: string; sent_to: string | null; issue: string | null;
    insurance: string | null; amount: number | null;
  };
  let crl: Crl[] = [];
  let crlError = false;
  if (scopeIds.length) {
    const res = await fetchAllRows<Crl>((lo, hi) =>
      supabase.from("crl_entries")
        .select("id, clinic_id, entry_date, responded_on, resolved_on, status, sent_to, issue, insurance, amount")
        .in("clinic_id", scopeIds).lte("entry_date", end).order("id").range(lo, hi));
    crl = res.rows;
    crlError = !!res.error;
  }
  const closedBy = (c: Crl, day: string) =>
    (c.resolved_on !== null && c.resolved_on <= day) ||
    (c.resolved_on === null && ["resolved", "closed", "written_off"].includes(c.status) && (c.entry_date ?? "") <= day);
  const clinicName = new Map(clinics.map((c) => [c.id, c.name]));
  const crlStats = (s: string, e: string, rows: Crl[]): CrlStats => {
    const made = rows.filter((c) => c.entry_date && c.entry_date >= s && c.entry_date <= e);
    const open = rows.filter((c) => c.entry_date && c.entry_date <= e && !closedBy(c, e));
    const ageTo = e < today ? e : today;
    const oldest = [...open].sort((a, b) => (a.entry_date! < b.entry_date! ? -1 : 1))[0];
    const answered = made.filter((c) => c.responded_on);
    const done = made.filter((c) => c.responded_on || closedBy(c, e));
    return {
      requests: made.length,
      pending: open.length,
      oldestDays: oldest ? daysBetween(oldest.entry_date!, ageTo) : null,
      oldestClinic: oldest?.clinic_id ? clinicName.get(oldest.clinic_id) ?? null : null,
      oldestDate: oldest?.entry_date ?? null,
      avgResponse: answered.length
        ? answered.reduce((t, c) => t + daysBetween(c.entry_date!, c.responded_on!), 0) / answered.length
        : null,
      rate: made.length ? (done.length / made.length) * 100 : null,
    };
  };
  const crlNow = crlStats(start, end, crl);
  const crlPrev = crlStats(prevStart, prevEnd, crl);

  // ---- denials ------------------------------------------------------------
  type Den = {
    clinic_id: number | null; denial_date: string; denial_code: string | null; denial_type: string | null;
    amount: number | null; carrier: string | null; claim_no: string | null; status: string | null;
  };
  let denials: Den[] = [];
  let codeInfo = new Map<string, { label: string; category: string | null; preventable: boolean | null }>();
  if (scopeIds.length) {
    const [d, codes] = await Promise.all([
      fetchAllRows<Den>((lo, hi) =>
        supabase.from("denials").select("clinic_id, denial_date, denial_code, denial_type, amount, carrier, claim_no, status")
          .in("clinic_id", scopeIds).gte("denial_date", start).lte("denial_date", end).order("id").range(lo, hi)),
      supabase.from("denial_codes").select("code, label, category, preventable"),
    ]);
    denials = d.rows;
    codeInfo = new Map(((codes.data ?? []) as { code: string; label: string; category: string | null; preventable: boolean | null }[]).map((c) => [c.code, c]));
  }
  const categoryOf = (d: Den) => {
    const info = d.denial_code ? codeInfo.get(d.denial_code) : undefined;
    return info?.category || d.denial_type || info?.label || d.denial_code || "Uncategorised";
  };
  const denialGroups = new Map<string, { count: number; amount: number; preventable: boolean | null }>();
  for (const d of denials) {
    const k = categoryOf(d);
    const info = d.denial_code ? codeInfo.get(d.denial_code) : undefined;
    const g = denialGroups.get(k) ?? { count: 0, amount: 0, preventable: info?.preventable ?? null };
    g.count += 1; g.amount += Number(d.amount ?? 0);
    denialGroups.set(k, g);
  }
  const denialList = denials.map((d) => ({
    ...d, clinic: d.clinic_id ? clinicName.get(d.clinic_id) ?? "—" : "—", category: categoryOf(d),
    preventable: d.denial_code ? codeInfo.get(d.denial_code)?.preventable ?? null : null,
  }));

  // ---- add-on codes -------------------------------------------------------
  const addonRes = await supabase.from("addon_codes").select("code, label").eq("is_active", true).order("code");
  const addonTableMissing = !!addonRes.error;
  const addons = (addonRes.data ?? []) as { code: string; label: string | null }[];
  // paid is null until a source reports it (Prompt's CPT report does;
  // AdvancedMD's Service Details does not) — never shown as $0.
  const addonUse = new Map<string, { units: number; charges: number; paid: number | null; desc: string | null; clients: Set<number> }>();
  const addonByClient = new Map<number, { units: number; charges: number; paid: number | null }>();
  if (addons.length && scopeIds.length) {
    const { data: procs } = await supabase.from("procedures").select("id, code, description").in("code", addons.map((a) => a.code));
    const procById = new Map(((procs ?? []) as { id: number; code: string; description: string | null }[]).map((x) => [x.id, x]));
    if (procById.size) {
      // "*" so this still works before migration 034 adds `paid`.
      const svc = await fetchAllRows<{ clinic_id: number; procedure_id: number; units: number | null; charges: number | null; paid?: number | null }>((lo, hi) =>
        supabase.from("service_monthly").select("*")
          .in("clinic_id", scopeIds).in("procedure_id", Array.from(procById.keys()))
          .gte("period_month", `${from}-01`).lte("period_month", `${to}-01`).order("id").range(lo, hi));
      for (const r of svc.rows) {
        const pr = procById.get(r.procedure_id);
        if (!pr) continue;
        const u = addonUse.get(pr.code) ?? { units: 0, charges: 0, paid: null, desc: pr.description, clients: new Set<number>() };
        u.units += Number(r.units ?? 0); u.charges += Number(r.charges ?? 0); u.clients.add(r.clinic_id);
        if (r.paid !== null && r.paid !== undefined) u.paid = (u.paid ?? 0) + Number(r.paid);
        addonUse.set(pr.code, u);
        const c = addonByClient.get(r.clinic_id) ?? { units: 0, charges: 0, paid: null };
        c.units += Number(r.units ?? 0); c.charges += Number(r.charges ?? 0);
        if (r.paid !== null && r.paid !== undefined) c.paid = (c.paid ?? 0) + Number(r.paid);
        addonByClient.set(r.clinic_id, c);
      }
    }
  }

  // ---- collector work -----------------------------------------------------
  const scopedActions = allActions.filter((a) => inScope.has(a.clinic_id) &&
    (!collector || (collName.get(a.collector_id) ?? `#${a.collector_id}`) === collector));
  const sentToCamIds = new Set(Array.from(actType.values()).filter((a) => /sent to cam/i.test(a.name)).map((a) => a.id));
  const byCollector = new Map<string, { actions: number; clients: Set<number>; top: Map<string, number>; sentToCam: number }>();
  const actionsByClient = new Map<number, Map<string, number>>();
  for (const a of scopedActions) {
    const nm = collName.get(a.collector_id) ?? `#${a.collector_id}`;
    const g = byCollector.get(nm) ?? { actions: 0, clients: new Set<number>(), top: new Map<string, number>(), sentToCam: 0 };
    g.actions += a.action_count; g.clients.add(a.clinic_id);
    const t = actType.get(a.action_type_id)?.name ?? "—";
    g.top.set(t, (g.top.get(t) ?? 0) + a.action_count);
    if (sentToCamIds.has(a.action_type_id)) g.sentToCam += a.action_count;
    byCollector.set(nm, g);
    const m = actionsByClient.get(a.clinic_id) ?? new Map<string, number>();
    m.set(nm, (m.get(nm) ?? 0) + a.action_count);
    actionsByClient.set(a.clinic_id, m);
  }
  const actionDetail = new Map<string, { collector: string; action: string; category: string; clinic: string; count: number }>();
  for (const a of scopedActions) {
    const coll = collName.get(a.collector_id) ?? `#${a.collector_id}`;
    const at = actType.get(a.action_type_id);
    const key = `${coll}|${a.action_type_id}|${a.clinic_id}`;
    const e = actionDetail.get(key) ?? { collector: coll, action: at?.name ?? "—", category: at?.category ?? "—", clinic: clinicName.get(a.clinic_id) ?? "—", count: 0 };
    e.count += a.action_count;
    actionDetail.set(key, e);
  }

  // ---- CAM tasks -----------------------------------------------------------
  const camProfileName = new Map<string, string>();
  for (const x of people) if (x.role === "cam") camProfileName.set(x.id, x.full_name ?? "—");
  for (const x of parties) if (x.profile_id && camNames.includes(x.name)) camProfileName.set(x.profile_id, x.name);
  for (const a of assignments) if (a.cam_id) camProfileName.set(a.cam_id, nameOfPerson.get(a.cam_id) ?? "—");
  type CamWork = { received: number; resolved: number; pending: number; pendingAge: number; sentToCam: number; clients: number };
  const camWork = new Map<string, CamWork>();
  const camRow = (nm: string) => {
    let r = camWork.get(nm);
    if (!r) camWork.set(nm, (r = { received: 0, resolved: 0, pending: 0, pendingAge: 0, sentToCam: 0, clients: 0 }));
    return r;
  };
  for (const c of scope) if (c.cam) camRow(c.cam).clients += 1;
  const ageTo = end < today ? end : today;
  type TaskRow = { title: string; assigned_to: string | null; created_at: string; completed_at: string | null; status: string; clinic_id: number | null; due_on: string | null };
  const camTaskList: (TaskRow & { cam: string; clinic: string; age: number | null })[] = [];
  if (camProfileName.size) {
    const tasks = await fetchAllRows<TaskRow>((lo, hi) =>
      supabase.from("tasks").select("title, assigned_to, created_at, completed_at, status, clinic_id, due_on")
        .in("assigned_to", Array.from(camProfileName.keys()))
        .lte("created_at", `${end}T23:59:59`).order("id").range(lo, hi));
    for (const t of tasks.rows) {
      const nm = t.assigned_to ? camProfileName.get(t.assigned_to) : undefined;
      if (!nm || t.status === "cancelled") continue;
      if (cam && cam !== "__none" && nm !== cam) continue;
      if (clientId && t.clinic_id !== clientId) continue;
      if (t.clinic_id && !inScope.has(t.clinic_id) && !clientId) continue;
      const r = camRow(nm);
      const created = t.created_at.slice(0, 10);
      const done = t.completed_at?.slice(0, 10) ?? null;
      if (created >= start) r.received += 1;
      if (done && done >= start && done <= end) r.resolved += 1;
      const pending = !done || done > end;
      if (pending) { r.pending += 1; r.pendingAge += daysBetween(created, ageTo); }
      if (created >= start || pending) {
        camTaskList.push({ ...t, cam: nm, clinic: t.clinic_id ? clinicName.get(t.clinic_id) ?? "—" : "—", age: pending ? daysBetween(created, ageTo) : null });
      }
    }
  }
  const clientCam = new Map(scope.map((c) => [c.id, c.cam]));
  for (const a of scopedActions) {
    if (!sentToCamIds.has(a.action_type_id)) continue;
    const c = clientCam.get(a.clinic_id);
    if (c) camRow(c).sentToCam += a.action_count;
  }

  // ---- per-client rows -----------------------------------------------------
  const crlByClient = new Map<number, Crl[]>();
  for (const c of crl) if (c.clinic_id) crlByClient.set(c.clinic_id, [...(crlByClient.get(c.clinic_id) ?? []), c]);

  const rows: ClientRow[] = scope.map((c) => {
    const h = historyOf(c.id);
    const snap = clientSnapshot(h, from, to);
    const trend = daysTrend(h, shiftMonth(from, -3), to);
    const sig = signals(snap, trend);
    const own = camOn(c.id, today);
    const coll = actionsByClient.get(c.id);
    const topColl = coll ? Array.from(coll.entries()).sort((a, b) => b[1] - a[1])[0] : undefined;
    const cs = crlStats(start, end, crlByClient.get(c.id) ?? []);
    const lastAr = [...h].filter((m) => m.month <= to && m.closingAr !== null).sort((a, b) => b.month.localeCompare(a.month))[0];
    return {
      id: c.id, name: c.name, code: c.code, cam: c.cam, system: c.system,
      camAssignmentId: own?.current ? own.id : null,
      collector: topColl?.[0] ?? null,
      snap, closingAr: lastAr && lastAr.month >= from ? lastAr.closingAr : null,
      trend, sig, health: healthOf(sig),
      crlOpen: cs.pending, crlRate: cs.rate,
      actions: coll ? Array.from(coll.values()).reduce((a, b) => a + b, 0) : 0,
    };
  });
  const withData = rows.filter((r) => r.snap.monthsWithData > 0);
  const combined = combinedSnapshot(withData.map((r) => historyOf(r.id)), from, to);

  // Company (or CAM, or client) figures month by month, for the trend table.
  const monthly = periodMonths.map((m) => ({ month: m, snap: combinedSnapshot(withData.map((r) => historyOf(r.id)), m, m) }));

  // Per-CAM snapshots for the "CAM level" view — recomputed, not averaged.
  const camSnapshots = Array.from(new Set(rows.map((r) => r.cam ?? "No CAM"))).sort().map((nm) => {
    const mine = withData.filter((r) => (r.cam ?? "No CAM") === nm);
    return { cam: nm, clients: rows.filter((r) => (r.cam ?? "No CAM") === nm).length, snap: combinedSnapshot(mine.map((r) => historyOf(r.id)), from, to) };
  });

  // ---- claim outcomes: denial RATE per client per month (no reasons) ----
  // Missing table (migration 035 not run) reads as "no data".
  type Outcome = { clinic_id: number; period_month: string; claims: number; denied_claims: number; denied_amount: number | null; reversals: number | null };
  let outcomes: Outcome[] = [];
  if (scopeIds.length) {
    const { data: oc } = await supabase.from("claim_outcomes_monthly")
      .select("clinic_id, period_month, claims, denied_claims, denied_amount, reversals")
      .in("clinic_id", scopeIds).gte("period_month", `${from}-01`).lte("period_month", `${to}-01`);
    outcomes = (oc ?? []) as Outcome[];
  }
  const denialRate = (() => {
    if (!outcomes.length) return null;
    const byClient = new Map<number, { claims: number; denied: number; amount: number; reversals: number }>();
    for (const o of outcomes) {
      const c = byClient.get(o.clinic_id) ?? { claims: 0, denied: 0, amount: 0, reversals: 0 };
      c.claims += o.claims; c.denied += o.denied_claims; c.amount += Number(o.denied_amount ?? 0); c.reversals += o.reversals ?? 0;
      byClient.set(o.clinic_id, c);
    }
    const claims = outcomes.reduce((t, o) => t + o.claims, 0);
    const denied = outcomes.reduce((t, o) => t + o.denied_claims, 0);
    const byMonth = new Map<string, { claims: number; denied: number }>();
    for (const o of outcomes) {
      const m = o.period_month.slice(0, 7);
      const x = byMonth.get(m) ?? { claims: 0, denied: 0 };
      x.claims += o.claims; x.denied += o.denied_claims;
      byMonth.set(m, x);
    }
    return {
      claims, denied, rate: claims ? (denied / claims) * 100 : null,
      amount: outcomes.reduce((t, o) => t + Number(o.denied_amount ?? 0), 0),
      byClient: Array.from(byClient.entries()).map(([id, c]) => ({ id, name: clinicName.get(id) ?? "—", ...c, rate: c.claims ? (c.denied / c.claims) * 100 : null })),
      byMonth: Array.from(byMonth.entries()).sort().map(([m, x]) => ({ month: m, ...x, rate: x.claims ? (x.denied / x.claims) * 100 : null })),
    };
  })();

  // ---- patients over 25 visits: two counts per client per year ----------
  // Clients are distinct, so their counts add up. Missing table (migration
  // 033 not run) reads as "no data", never as an error on the page.
  let over25: { patients: number; over: number; clients: number; asOf: string | null; year: number } | null = null;
  if (scopeIds.length) {
    const year = Number(end.slice(0, 4));
    const { data: pvc } = await supabase.from("patient_visit_counts")
      .select("clinic_id, patients, over_threshold, as_of").in("clinic_id", scopeIds).eq("year", year);
    const list = (pvc ?? []) as { clinic_id: number; patients: number; over_threshold: number; as_of: string }[];
    if (list.length) {
      over25 = {
        patients: list.reduce((t, r) => t + r.patients, 0),
        over: list.reduce((t, r) => t + r.over_threshold, 0),
        clients: list.length,
        asOf: list.map((r) => r.as_of).sort()[0] ?? null,
        year,
      };
    }
  }

  // ---- import freshness ----------------------------------------------------
  const [packB, actB] = await Promise.all([
    supabase.from("import_batches").select("finished_at, started_at").eq("report_kind", "amd_monthly_pack")
      .in("status", ["success", "partial"]).order("started_at", { ascending: false }).limit(1),
    supabase.from("import_batches").select("finished_at, started_at").eq("report_kind", "collection_actions")
      .in("status", ["success", "partial"]).order("started_at", { ascending: false }).limit(1),
  ]);
  const lastOf = (r: { data: unknown }) => {
    const b = ((r.data ?? []) as { finished_at: string | null; started_at: string }[])[0];
    return b ? b.finished_at ?? b.started_at : null;
  };

  return {
    today, start, end, from, to, prevStart, prevEnd, periodMonths, months,
    clientList, camNames, collectorNames, systems,
    filters: { cam, clientId, collector, system, view: p.view === "cam" ? "cam" : "client" },
    scope, scopeLabel, rows, withData, combined, camSnapshots, monthly,
    crl, crlError, crlNow, crlPrev, clinicName,
    crlList: crl.filter((c) => c.entry_date && (c.entry_date >= start || !closedBy(c, end))).map((c) => ({
      ...c, clinic: c.clinic_id ? clinicName.get(c.clinic_id) ?? "—" : "—",
      open: !closedBy(c, end),
      waited: c.entry_date ? daysBetween(c.entry_date, c.responded_on ?? (closedBy(c, end) ? c.resolved_on ?? end : ageTo)) : null,
    })),
    denials: denialList, denialGroups: Array.from(denialGroups.entries()).sort((a, b) => b[1].count - a[1].count),
    addons, addonTableMissing, addonUse: Array.from(addonUse.entries()).sort((a, b) => b[1].charges - a[1].charges), addonByClient,
    collectors: Array.from(byCollector.entries()).sort((a, b) => b[1].actions - a[1].actions),
    actionDetail: Array.from(actionDetail.values()),
    camWork: Array.from(camWork.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    camTaskList,
    parties: parties.filter((x) => x.is_active && x.kind === "person").map((x) => ({ id: x.id, name: x.name })),
    lastPack: lastOf(packB), lastActions: lastOf(actB), over25, denialRate,
  };
}

export type ResultsData = Awaited<ReturnType<typeof loadResults>>;
