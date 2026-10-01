import * as XLSX from "xlsx";
import { rangeFromFileName } from "@/lib/parsePromptAr";

/**
 * Prompt EMR — "Remit Allocation Report" (Reports → Revenue), CSV,
 * downloaded 2 Oct 2026. One line per claim per remittance.
 *
 * ⚠ It carries NO denial reason codes — only a status ("Denied",
 * "Processed as Primary", "Reversal of Previous Payment"…). So it gives
 * the denial RATE, not the reasons.
 *
 * ⚠ PHI RULE: only Date of Service, Visit Facility, Remittance Claim
 * Status, Submitted Amount, Paid Amount and Prompt Claim Number are read.
 * The claim number is used only to count DISTINCT claims and is never
 * stored. Patient name and account number are never read.
 *
 * Months are by DATE OF SERVICE, so the latest months always look good —
 * most of their claims have not come back from the payer yet.
 */

export type RemitCell = { claims: Set<string>; denied: Set<string>; deniedAmount: number; reversals: number; paid: number };
export type PromptRemit = {
  rangeFrom: string | null; rangeTo: string | null;
  cells: Map<string, Map<string, RemitCell>>; // facility → month
  facilities: string[]; months: string[]; fullMonths: string[];
  totals: { lines: number; claims: number; denied: number; deniedAmount: number; reversals: number };
  issues: { level: "error" | "warn"; message: string }[];
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,]/g, "")) || 0);
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const iso = (v: unknown): string | null => {
  if (typeof v === "number" && v > 30000 && v < 80000)
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  const m = txt(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(txt(v)) ? txt(v).slice(0, 10) : null;
};

const firstSheetRows = (wb: XLSX.WorkBook) =>
  XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null }) as unknown[][];

export function isPromptRemit(wb: XLSX.WorkBook) {
  const head = (firstSheetRows(wb)[0] ?? []).map((h) => txt(h).toLowerCase());
  return head.includes("remittance claim status") && head.includes("remittance id");
}

export function parsePromptRemit(wb: XLSX.WorkBook, fileName = ""): PromptRemit {
  const issues: PromptRemit["issues"] = [];
  const rows = firstSheetRows(wb);
  const head = (rows[0] ?? []).map((h) => txt(h).toLowerCase());
  const C = {
    claim: head.indexOf("prompt claim number"), dos: head.indexOf("date of service"), fac: head.indexOf("visit facility"),
    status: head.indexOf("remittance claim status"), submitted: head.indexOf("submitted amount"), paid: head.indexOf("paid amount"),
  };
  for (const [k, i] of Object.entries(C)) if (i < 0) issues.push({ level: "error", message: `No ${k} column — Prompt may have changed the report.` });

  const cells: PromptRemit["cells"] = new Map();
  const allClaims = new Set<string>(), allDenied = new Set<string>();
  let lines = 0, deniedAmount = 0, reversals = 0, noDate = 0;
  if (!issues.length) {
    for (const r of rows.slice(1)) {
      const dos = iso(r[C.dos]);
      const claim = txt(r[C.claim]);
      if (!dos && !claim) continue;
      if (!dos) { noDate++; continue; }
      const f = txt(r[C.fac]) || "(no facility)";
      const m = dos.slice(0, 7);
      const st = txt(r[C.status]).toLowerCase();
      const byM = cells.get(f) ?? new Map<string, RemitCell>();
      const c = byM.get(m) ?? { claims: new Set(), denied: new Set(), deniedAmount: 0, reversals: 0, paid: 0 };
      c.claims.add(claim); allClaims.add(claim);
      if (st === "denied") {
        if (!c.denied.has(claim)) c.deniedAmount += num(r[C.submitted]);
        c.denied.add(claim); allDenied.add(claim);
      }
      if (st.startsWith("reversal")) { c.reversals++; reversals++; }
      c.paid += num(r[C.paid]);
      byM.set(m, c); cells.set(f, byM);
      lines++;
    }
    deniedAmount = Array.from(cells.values()).flatMap((m) => Array.from(m.values())).reduce((t, c) => t + c.deniedAmount, 0);
  }
  if (noDate) issues.push({ level: "warn", message: `${noDate} lines had no date of service and were left out.` });

  const range = rangeFromFileName(fileName);
  const facilities = Array.from(cells.keys()).sort();
  const months = Array.from(new Set(facilities.flatMap((f) => Array.from(cells.get(f)!.keys())))).sort();
  const fullMonths = months.filter((m) => {
    if (!range.from || !range.to) return false;
    const [y, mo] = m.split("-").map(Number);
    return range.from <= `${m}-01` && range.to >= new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  });
  return {
    rangeFrom: range.from, rangeTo: range.to, cells, facilities, months, fullMonths,
    totals: { lines, claims: allClaims.size, denied: allDenied.size, deniedAmount, reversals }, issues,
  };
}

/** A set of facilities' figures for one month, claims de-duplicated across them. */
export function remitFor(p: PromptRemit, facilities: string[], month: string) {
  const claims = new Set<string>(), denied = new Set<string>();
  let deniedAmount = 0, reversals = 0, paid = 0;
  for (const f of facilities) {
    const c = p.cells.get(f)?.get(month);
    if (!c) continue;
    c.claims.forEach((x) => claims.add(x)); c.denied.forEach((x) => denied.add(x));
    deniedAmount += c.deniedAmount; reversals += c.reversals; paid += c.paid;
  }
  return { claims: claims.size, denied: denied.size, deniedAmount, reversals, paid };
}
