"use client";

import { useState } from "react";

/**
 * Scope control for the dashboard: which clinics, and over what period.
 *
 * Clinics are checkboxes rather than a multi-select box because with 38 of
 * them a native multi-select is unusable — you cannot see what is ticked
 * without scrolling, and one stray click clears the lot.
 */
export default function DashboardFilters({
  clinics,
  selected,
  months,
  from,
  to,
}: {
  clinics: { id: number; name: string; status: string }[];
  selected: number[];
  months: string[];
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>(selected);

  const active = clinics.filter((c) => c.status === "active");
  const allActive = picked.length === 0;

  const toggle = (id: number) =>
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  const label = allActive
    ? `All ${active.length} active clinics`
    : picked.length === 1
      ? clinics.find((c) => c.id === picked[0])?.name ?? "1 clinic"
      : `${picked.length} clinics`;

  const field = "rounded-card border border-hairline bg-surface shadow-card px-3 py-1.5 text-sm";

  return (
    <form className="flex flex-wrap items-end gap-2">
      {picked.map((id) => (
        <input key={id} type="hidden" name="clinic" value={id} />
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`${field} min-w-[13rem] text-left`}
        >
          {label} <span className="float-right text-muted">{open ? "▴" : "▾"}</span>
        </button>

        {open && (
          <div className="absolute z-10 mt-1 max-h-72 w-72 overflow-auto rounded-card border border-hairline bg-surface shadow-card p-2 shadow-lg">
            <button
              type="button"
              onClick={() => setPicked([])}
              className="mb-2 w-full rounded bg-canvas px-2 py-1 text-left text-xs text-muted hover:text-ink"
            >
              All active clinics
            </button>
            {clinics.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-canvas"
              >
                <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                <span className={c.status !== "active" ? "text-muted" : ""}>
                  {c.name}
                  {c.status !== "active" && <span className="ml-1 text-xs">({c.status})</span>}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <label className="flex items-center gap-1.5 text-sm">
        <span className="text-xs text-muted">From</span>
        <select name="from" defaultValue={from} className={field}>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-sm">
        <span className="text-xs text-muted">To</span>
        <select name="to" defaultValue={to} className={field}>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className={`${field} hover:bg-canvas`}>
        Apply
      </button>
    </form>
  );
}
