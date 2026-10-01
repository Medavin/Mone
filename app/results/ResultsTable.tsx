"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { exportExcel, exportCsv } from "@/lib/exportTable";

/**
 * The one table every card on the Results pages uses, so every table has
 * the same controls (Pravin, 2 Oct 2026):
 *
 *   - filter by element: pick a column, type part of a value
 *   - filter by amount: pick a number column, give a minimum and/or maximum
 *   - total line count ("12 of 38 lines")
 *   - a grand total row, as SUM, COUNT or AVERAGE (switchable)
 *   - Excel / CSV export of exactly what is on screen
 *
 * Clinic and period are page-level filters (the bar at the top) because
 * they decide what is fetched; these act on what is already loaded.
 *
 * ⚠ Percentages and other ratios are NEVER summed. In the total row they
 * show the server-computed figure when one is supplied (`totals`) and the
 * table is unfiltered — because the right company figure is recomputed
 * from numerators and denominators, not averaged across clients — and a
 * dash otherwise.
 */

export type ColType = "text" | "number" | "money" | "percent" | "days" | "chip";

export type Col = {
  key: string;
  label: string;
  type?: ColType;
  /** For ratio columns: never add up. */
  ratio?: boolean;
  hint?: string;
};

/** A cell: a plain value, or a value with a link / a coloured chip. */
export type Cell =
  | string
  | number
  | null
  | { v: string | number | null; href?: string; tone?: "good" | "warn" | "bad" | "muted"; sub?: string };

export type Row = Record<string, Cell>;

const val = (c: Cell): string | number | null =>
  c !== null && typeof c === "object" ? c.v : c;

const fmt = (v: string | number | null, type: ColType = "text") => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  switch (type) {
    case "money":
      return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    case "percent":
      return `${v.toFixed(1)}%`;
    case "days":
      return `${Math.round(v)}`;
    case "number":
      return Math.round(v * 100) / 100 === Math.round(v)
        ? Math.round(v).toLocaleString("en-US")
        : v.toLocaleString("en-US", { maximumFractionDigits: 1 });
    default:
      return String(v);
  }
};

const TONE: Record<string, string> = {
  good: "bg-good/10 text-good",
  warn: "bg-warn/10 text-warn",
  bad: "bg-bad/10 text-bad",
  muted: "bg-canvas text-muted",
};

const TEXT_TONE: Record<string, string> = {
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  muted: "text-muted",
};

const isNum = (t?: ColType) => t === "number" || t === "money" || t === "percent" || t === "days";

export default function ResultsTable({
  title,
  cols,
  rows,
  totals,
  empty,
  pageSize = 0,
  compact = false,
}: {
  title: string;
  cols: Col[];
  rows: Row[];
  /** Correct company-level figures for the total row, keyed by column. */
  totals?: Record<string, number | null>;
  empty?: string;
  /** Show this many rows with a "show all" link; 0 = all. */
  pageSize?: number;
  compact?: boolean;
}) {
  const textCols = cols.filter((c) => !isNum(c.type));
  const numCols = cols.filter((c) => isNum(c.type));

  const [elCol, setElCol] = useState(textCols[0]?.key ?? "");
  const [elText, setElText] = useState("");
  const [amtCol, setAmtCol] = useState(numCols[0]?.key ?? "");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [agg, setAgg] = useState<"sum" | "count" | "avg">("sum");
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    let out = rows;
    if (elText.trim() && elCol) {
      const needle = elText.trim().toLowerCase();
      out = out.filter((r) => String(val(r[elCol]) ?? "").toLowerCase().includes(needle));
    }
    if (amtCol && (min !== "" || max !== "")) {
      const lo = min === "" ? -Infinity : Number(min);
      const hi = max === "" ? Infinity : Number(max);
      out = out.filter((r) => {
        const v = val(r[amtCol]);
        return typeof v === "number" && v >= lo && v <= hi;
      });
    }
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const x = val(a[sortKey]);
        const y = val(b[sortKey]);
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sortDir;
      });
    }
    return out;
  }, [rows, elCol, elText, amtCol, min, max, sortKey, sortDir]);

  const isFiltered = filtered.length !== rows.length;
  const shown = pageSize && !showAll ? filtered.slice(0, pageSize) : filtered;

  const totalFor = (c: Col): string => {
    if (!isNum(c.type)) return "";
    const nums = filtered.map((r) => val(r[c.key])).filter((v): v is number => typeof v === "number");
    if (agg === "count") return nums.length.toLocaleString("en-US");
    if (c.ratio || c.type === "percent" || c.type === "days") {
      if (!isFiltered && totals && totals[c.key] !== undefined) return fmt(totals[c.key], c.type);
      if (agg === "avg" && nums.length) return fmt(nums.reduce((a, b) => a + b, 0) / nums.length, c.type);
      return "—";
    }
    if (!nums.length) return "—";
    const sum = nums.reduce((a, b) => a + b, 0);
    return fmt(agg === "avg" ? sum / nums.length : sum, c.type);
  };

  const exportCols = cols.map((c) => ({ header: c.label, value: (r: Row) => val(r[c.key]) }));
  const field = "rounded border border-hairline bg-surface px-1.5 py-1 text-xs";
  const pad = compact ? "px-2 py-1.5" : "px-3 py-2";
  const anyFilter = elText || min || max;

  return (
    <div>
      {/* ---- toolbar ---- */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted print:hidden">
        <span className="tnum">
          <strong className="text-ink">{filtered.length}</strong>
          {isFiltered ? ` of ${rows.length}` : ""} line{filtered.length === 1 ? "" : "s"}
        </span>
        <button
          onClick={() => setOpen(!open)}
          className={`rounded border px-2 py-1 ${anyFilter ? "border-accent text-accent" : "border-hairline"} hover:border-ink hover:text-ink`}
        >
          ⚲ Filter{anyFilter ? " (on)" : ""}
        </button>
        <span className="inline-flex overflow-hidden rounded border border-hairline" title="What the total row shows">
          {(["sum", "count", "avg"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAgg(a)}
              className={`px-2 py-1 ${agg === a ? "bg-accent text-white" : "hover:text-ink"}`}
            >
              {a === "sum" ? "Sum" : a === "count" ? "Count" : "Avg"}
            </button>
          ))}
        </span>
        <span className="ml-auto inline-flex gap-1">
          <button className={`${field} hover:text-ink`} onClick={() => exportExcel(filtered, exportCols, title)} disabled={!filtered.length}>
            ⬇ Excel
          </button>
          <button className={`${field} hover:text-ink`} onClick={() => exportCsv(filtered, exportCols, title)} disabled={!filtered.length}>
            ⬇ CSV
          </button>
        </span>
      </div>

      {open && (
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-card border border-hairline bg-canvas/50 p-3 text-xs print:hidden">
          {textCols.length > 0 && (
            <label className="text-muted">
              Filter by element
              <span className="mt-1 flex gap-1">
                <select value={elCol} onChange={(e) => setElCol(e.target.value)} className={field}>
                  {textCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <input value={elText} onChange={(e) => setElText(e.target.value)} placeholder="contains…" className={`${field} w-36`} />
              </span>
            </label>
          )}
          {numCols.length > 0 && (
            <label className="text-muted">
              Filter by amount
              <span className="mt-1 flex gap-1">
                <select value={amtCol} onChange={(e) => setAmtCol(e.target.value)} className={field}>
                  {numCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <input value={min} onChange={(e) => setMin(e.target.value)} placeholder="min" inputMode="decimal" className={`${field} w-20`} />
                <input value={max} onChange={(e) => setMax(e.target.value)} placeholder="max" inputMode="decimal" className={`${field} w-20`} />
              </span>
            </label>
          )}
          {anyFilter && (
            <button onClick={() => { setElText(""); setMin(""); setMax(""); }} className="pb-1 text-accent hover:underline">
              Clear
            </button>
          )}
        </div>
      )}

      {/* ---- table ---- */}
      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-hairline px-4 py-6 text-center text-sm text-muted">{empty ?? "Nothing to show."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-hairline bg-canvas/60">
                {cols.map((c) => (
                  <th
                    key={c.key}
                    title={c.hint ?? "Click to sort"}
                    onClick={() => {
                      if (sortKey === c.key) setSortDir(sortDir === 1 ? -1 : 1);
                      else { setSortKey(c.key); setSortDir(isNum(c.type) ? -1 : 1); }
                    }}
                    className={`${pad} cursor-pointer select-none whitespace-nowrap text-xs font-semibold text-ink/80 hover:text-ink ${isNum(c.type) ? "text-right" : "text-left"}`}
                  >
                    {c.label}
                    {sortKey === c.key && <span className="ml-1 text-accent">{sortDir === 1 ? "▲" : "▼"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i} className="border-b border-hairline/60 hover:bg-accentSoft/40">
                  {cols.map((c) => {
                    const cell = r[c.key];
                    const v = val(cell);
                    const obj = cell !== null && typeof cell === "object" ? cell : null;
                    const text = fmt(v, c.type);
                    return (
                      <td key={c.key} className={`${pad} ${isNum(c.type) ? "tnum text-right" : ""} whitespace-nowrap`}>
                        {c.type === "chip" && obj?.tone ? (
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[obj.tone]}`}>{text}</span>
                        ) : obj?.href ? (
                          <Link href={obj.href} className="font-medium text-accent hover:underline">{text}</Link>
                        ) : (
                          <span className={obj?.tone ? TEXT_TONE[obj.tone] : ""}>{text}</span>
                        )}
                        {obj?.sub && <div className="text-[11px] text-muted">{obj.sub}</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink/20 bg-canvas/60 font-semibold">
                {cols.map((c, i) => (
                  <td key={c.key} className={`${pad} ${isNum(c.type) ? "tnum text-right" : ""} whitespace-nowrap`}>
                    {i === 0 ? (
                      <span>
                        Grand total{" "}
                        <span className="font-normal text-muted">
                          ({agg === "sum" ? "sum" : agg === "count" ? "count" : "average"}{isFiltered ? ", filtered" : ""})
                        </span>
                      </span>
                    ) : (
                      totalFor(c)
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
          {pageSize > 0 && filtered.length > pageSize && (
            <button onClick={() => setShowAll(!showAll)} className="mt-2 text-xs text-accent hover:underline">
              {showAll ? "Show fewer" : `Show all ${filtered.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
