import type { Field, Target } from "./importTargets";

/**
 * The generic import engine.
 *
 * Reads any flat file with a header row, works out which of our tables it is
 * for, maps its columns onto ours, and turns the strings into the right types.
 *
 * ⚠ THIS IS NOT THE MONTHLY PACK PARSER, and it should not become one. The
 * AdvancedMD workbook is nine sheets read by label and position, with its own
 * totals to check against; `lib/parseAmd.ts` handles that and stays separate.
 * This is for everything else — a denial export, a payer list, a CRL — where
 * the file is a rectangle and the only question is which column is which.
 */

export type Sheet = { name: string; headers: string[]; rows: string[][] };

export type Mapping = Record<string, string>; // our column -> their header

/** Loosened for comparison: case, spaces, punctuation and plurals all vary. */
export function norm(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Read every sheet of a workbook, or the single table in a CSV. */
export async function readTables(file: File): Promise<Sheet[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const book = XLSX.read(buf, { type: "array", cellDates: true, raw: false });

  return book.SheetNames.map((name) => {
    const grid = XLSX.utils.sheet_to_json<string[]>(book.Sheets[name], {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    }) as unknown as string[][];

    // The header row is not always the first: exports often carry a title
    // and a date above it. Take the first row that looks like headers —
    // several non-empty cells, mostly text, and no duplicates.
    let headerAt = 0;
    for (let i = 0; i < Math.min(grid.length, 12); i++) {
      const row = (grid[i] ?? []).map((c) => String(c ?? "").trim());
      const filled = row.filter(Boolean);
      const unique = new Set(filled.map(norm));
      if (filled.length >= 2 && unique.size === filled.length) {
        headerAt = i;
        break;
      }
    }

    const headers = (grid[headerAt] ?? []).map((c) => String(c ?? "").trim());
    const rows = grid
      .slice(headerAt + 1)
      .map((r) => headers.map((_, i) => String(r?.[i] ?? "").trim()))
      .filter((r) => r.some((c) => c !== ""));

    return { name, headers, rows };
  }).filter((s) => s.headers.filter(Boolean).length > 0);
}

/**
 * How well a saved profile matches this file.
 *
 * Headers are worth far more than the filename, because a file gets renamed
 * on the way through an inbox but its columns do not. The filename is a
 * tiebreak, not a decision.
 */
export function scoreProfile(
  profile: { filename_hint: string | null; header_signature: string[] | null },
  fileName: string,
  headers: string[]
) {
  const mine = new Set(headers.map(norm).filter(Boolean));
  const theirs = (profile.header_signature ?? []).map(norm).filter(Boolean);
  if (theirs.length === 0) return 0;

  const hits = theirs.filter((h) => mine.has(h)).length;
  let score = hits / theirs.length; // 0..1

  if (profile.filename_hint && norm(fileName).includes(norm(profile.filename_hint))) {
    score += 0.15;
  }
  return Math.min(1, score);
}

/**
 * A first guess at the mapping, from the aliases in the target registry.
 *
 * ⚠ An exact match wins outright; a partial one only counts when nothing
 * exact exists. Guessing "Payment Date" for `denial_date` because both
 * contain "date" is how an import quietly loads the wrong column.
 */
export function guessMapping(target: Target, headers: string[]): Mapping {
  const out: Mapping = {};
  const used = new Set<string>();
  const normed = headers.map((h) => ({ raw: h, n: norm(h) })).filter((h) => h.raw);

  for (const pass of ["exact", "partial"] as const) {
    for (const field of target.fields) {
      if (out[field.column]) continue;
      const names = [field.label, field.column, ...(field.aliases ?? [])].map(norm);

      const found = normed.find((h) => {
        if (used.has(h.raw)) return false;
        return pass === "exact"
          ? names.includes(h.n)
          : names.some((n) => n.length > 3 && (h.n.includes(n) || n.includes(h.n)));
      });

      if (found) {
        out[field.column] = found.raw;
        used.add(found.raw);
      }
    }
  }
  return out;
}

const TRUEISH = new Set(["y", "yes", "true", "1", "in", "par", "in network", "participating", "contracted"]);
const FALSEISH = new Set(["n", "no", "false", "0", "out", "non par", "out of network", "nonpar"]);

/** Turn one cell into the type its column wants. Null when it cannot. */
export function coerce(kind: Field["kind"], raw: string): string | number | boolean | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;

  switch (kind) {
    case "number":
    case "money": {
      // Strip currency, thousands separators, and the accountant's
      // parentheses for negatives — (1,234.56) means −1234.56.
      const neg = /^\(.*\)$/.test(v);
      const n = Number(v.replace(/[()$,\s]/g, "").replace(/[^0-9.\-]/g, ""));
      if (!Number.isFinite(n)) return null;
      return neg ? -n : n;
    }
    case "date": {
      // ISO first, then US, then whatever Date can manage. Deliberately no
      // day-first guessing: this is a US system, and a silent 03/04 flip is
      // far worse than a rejected row.
      const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
      const us = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
      if (us) {
        const yr = us[3].length === 2 ? `20${us[3]}` : us[3];
        return `${yr}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
      }
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    case "boolean": {
      const n = norm(v);
      if (TRUEISH.has(n)) return true;
      if (FALSEISH.has(n)) return false;
      return null; // unknown stays unknown — see clinic_payers.in_network
    }
    default:
      return v;
  }
}

export type BuiltRow = {
  values: Record<string, string | number | boolean | null>;
  clinicName?: string;
  problems: string[];
};

/**
 * Apply a mapping to every row, coercing as it goes.
 *
 * Rows with problems are KEPT and marked rather than dropped, so the preview
 * can show what will not load and why. Silently discarding rows is how an
 * import appears to succeed while losing a quarter of the file.
 */
export function buildRows(
  target: Target,
  sheet: Sheet,
  mapping: Mapping,
  defaults: Record<string, string | number | boolean | null> = {}
): BuiltRow[] {
  const index = new Map(sheet.headers.map((h, i) => [h, i]));

  return sheet.rows.map((row) => {
    const values: Record<string, string | number | boolean | null> = { ...defaults };
    const problems: string[] = [];
    let clinicName: string | undefined;

    for (const field of target.fields) {
      const header = mapping[field.column];
      if (!header) continue;
      const at = index.get(header);
      if (at === undefined) continue;

      const raw = row[at];

      if (field.kind === "clinic") {
        if (raw) clinicName = raw;
        continue; // resolved later, against the clinic list and its aliases
      }

      const value = coerce(field.kind, raw);
      if (value !== null) values[field.column] = value;
      else if (raw) problems.push(`${field.label}: could not read "${raw}"`);
    }

    for (const field of target.fields) {
      if (!field.required) continue;
      if (field.kind === "clinic") {
        if (!clinicName && !defaults.clinic_id) problems.push(`${field.label} is missing`);
      } else if (values[field.column] === undefined || values[field.column] === null) {
        problems.push(`${field.label} is missing`);
      }
    }

    return { values, clinicName, problems };
  });
}
