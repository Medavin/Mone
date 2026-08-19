"use client";

import { useState } from "react";
import { exportExcel, exportCsv, printPage } from "@/lib/exportTable";

/**
 * Export buttons for a table rendered by a SERVER component.
 *
 * `TableControls` takes column definitions — functions — which cannot cross
 * the server/client boundary. This takes plain headers and rows instead, so a
 * server page can hand it data with no client wrapper around the table itself.
 *
 * Rows carry RAW VALUES, not the formatted strings on screen: a spreadsheet
 * full of "$1,234.56" as text cannot be summed, which defeats the point.
 */
export default function ExportButtons({
  headers,
  rows,
  title,
  label,
}: {
  headers: string[];
  rows: (string | number | null)[][];
  title: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  const columns = headers.map((h, i) => ({
    header: h,
    value: (r: (string | number | null)[]) => r[i],
  }));

  const btn =
    "rounded border border-hairline bg-surface px-2 py-1 text-[11px] text-muted transition " +
    "hover:border-ink hover:text-ink disabled:opacity-40";

  if (rows.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1.5 print:hidden">
      {label && <span className="text-[11px] text-muted">{label}</span>}
      <button
        className={btn}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await exportExcel(rows, columns, title);
          } finally {
            setBusy(false);
          }
        }}
      >
        ⬇ Excel
      </button>
      <button className={btn} onClick={() => exportCsv(rows, columns, title)}>
        ⬇ CSV
      </button>
      <button className={btn} onClick={printPage} title="Use your browser's Save as PDF">
        ⎙ PDF
      </button>
    </span>
  );
}
