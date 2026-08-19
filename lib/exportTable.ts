/**
 * One export path for every table in the app.
 *
 * Written once and shared so that two screens can never disagree about what
 * a column is called or how a figure is rounded — the moment each page rolls
 * its own export, the spreadsheets people email each other stop matching.
 *
 * PDF is deliberately the browser's own print-to-PDF rather than a generated
 * file. A PDF library would add a dependency, a second layout to maintain and
 * a second set of bugs, to produce something the browser already does well —
 * and the print stylesheet also gives a usable printed page for free.
 */

export type Column<T> = {
  /** Heading as it appears in the file. */
  header: string;
  /** Pull the raw value. Return a number for anything that should stay numeric in Excel. */
  value: (row: T) => string | number | null | undefined;
};

/** Excel refuses some characters in a sheet name, and truncates past 31. */
function safeSheetName(name: string) {
  return name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1";
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on the next tick — revoking immediately cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Excel. `xlsx` is already a dependency because the importer reads workbooks,
 * so this costs nothing extra, and it is imported dynamically so the library
 * is not in the bundle of every page that merely *offers* an export.
 */
export async function exportExcel<T>(rows: T[], columns: Column<T>[], title: string) {
  const XLSX = await import("xlsx");

  const body = rows.map((r) => {
    const o: Record<string, string | number | null> = {};
    for (const c of columns) {
      const v = c.value(r);
      o[c.header] = v === undefined ? null : v;
    }
    return o;
  });

  const sheet = XLSX.utils.json_to_sheet(body, {
    header: columns.map((c) => c.header),
  });

  // Column widths from the content, so nothing arrives as ####.
  sheet["!cols"] = columns.map((c) => ({
    wch: Math.min(
      40,
      Math.max(
        c.header.length + 2,
        ...rows.slice(0, 200).map((r) => String(c.value(r) ?? "").length + 2)
      )
    ),
  }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, safeSheetName(title));

  const out = XLSX.write(book, { bookType: "xlsx", type: "array" });
  download(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp()}.xlsx`
  );
}

/** CSV, for anything that has to be read by another system rather than a person. */
export function exportCsv<T>(rows: T[], columns: Column<T>[], title: string) {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // A leading =, + or - makes Excel treat the cell as a formula. Prefixing
    // an apostrophe is the standard defence and is invisible to the reader.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };

  const lines = [
    columns.map((c) => cell(c.header)).join(","),
    ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(",")),
  ];

  download(
    new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp()}.csv`
  );
}

/** Print, which is also how a PDF is produced — every browser can save to PDF. */
export function printPage() {
  window.print();
}
