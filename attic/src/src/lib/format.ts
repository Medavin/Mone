/**
 * Display formatting, centralised so dates and money read the same everywhere.
 * Change LOCALE/CURRENCY here rather than at each call site.
 */
const LOCALE = "en-US";
const CURRENCY = "USD";

const currency = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat(LOCALE);

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return currency.format(value);
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return number.format(value);
}

/** Full date, e.g. "3 Mar 2025". */
export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = parse(value);
  if (!date) return value;
  return date.toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Month only, e.g. "Mar 2025" — for the `period_month` columns. */
export function formatMonth(value: string | null | undefined) {
  if (!value) return "—";
  const date = parse(value);
  if (!date) return value;
  return date.toLocaleDateString(LOCALE, {
    month: "short",
    year: "numeric",
  });
}

/**
 * `clinics.status` is free text ("Enable", "New/onboarding", …), so turn it
 * into a safe CSS class suffix. Unknown values fall back to the base pill.
 */
export function statusSlug(status: string) {
  return status
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Date-only columns arrive as "YYYY-MM-DD". Parsing that directly treats it as
 * UTC midnight, which renders as the previous day west of Greenwich — so pin
 * the parts explicitly and build a local date.
 */
function parse(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
