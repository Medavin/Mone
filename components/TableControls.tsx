"use client";

import { useState } from "react";
import { exportExcel, exportCsv, printPage, type Column } from "@/lib/exportTable";

/**
 * The export toolbar. Drop it above any table.
 *
 * It takes the rows and the column definitions rather than scraping the DOM,
 * so the file carries real numbers and full precision instead of the rounded,
 * comma-formatted strings the screen shows. A spreadsheet of text that looks
 * like numbers cannot be summed, which defeats the point of exporting.
 *
 * Hidden when printing — nobody wants buttons in the PDF.
 */
export default function TableControls<T>({
  rows,
  columns,
  title,
  note,
}: {
  rows: T[];
  columns: Column<T>[];
  title: string;
  note?: string;
}) {
  const [busy, setBusy] = useState(false);

  const btn =
    "rounded border border-hairline bg-surface px-2.5 py-1 text-xs text-muted transition " +
    "hover:border-ink hover:text-ink disabled:opacity-40";

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <span className="tnum text-xs text-muted">
        {rows.length.toLocaleString()} row{rows.length === 1 ? "" : "s"}
        {note ? ` · ${note}` : ""}
      </span>
      <span className="flex-1" />
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
        ⎙ Print / PDF
      </button>
    </div>
  );
}
