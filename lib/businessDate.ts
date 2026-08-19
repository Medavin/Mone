/**
 * Which working day a moment belongs to.
 *
 * Carried over from the previous project, where this was a real bug rather
 * than a theoretical one. The team works nights in India; the clients are in
 * the US. UTC rolls over at 05:30 IST, which is near the END of a night shift,
 * so a single shift was being split across two "days" in every report. Using
 * the browser's local date was equally wrong in the other direction: at 02:00
 * Thursday in India it is still Wednesday afternoon in California.
 *
 * So the business DATE is anchored to one timezone, named by IANA identifier
 * so daylight saving is handled without a table of dates.
 *
 * Clock TIMES are deliberately NOT anchored — everyone sees times in their own
 * zone, which is what they expect. Only the date is fixed.
 */

export const BUSINESS_TZ = "America/Los_Angeles";
export const BUSINESS_TZ_LABEL = "US Pacific";

/** The business date for a given instant, as YYYY-MM-DD. */
export function businessDateOf(instant: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  // en-CA formats as YYYY-MM-DD, which is what we want.
  return parts;
}

export function businessToday(): string {
  return businessDateOf(new Date());
}

/** 1 = Monday … 7 = Sunday, for the business date rather than the viewer's. */
export function businessWeekday(iso: string = businessToday()): number {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

/** Monday of the week a business date falls in. */
export function weekStartOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const back = businessWeekday(iso) - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Human time in the viewer's own zone — never used for grouping. */
export function localTime(instant: string | Date): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Duration between two instants, as "6h 42m". */
export function duration(fromIso: string, toIso?: string | null): string {
  const start = new Date(fromIso).getTime();
  const end = toIso ? new Date(toIso).getTime() : Date.now();
  const mins = Math.max(0, Math.round((end - start) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function minutesBetween(fromIso: string, toIso?: string | null): number {
  const start = new Date(fromIso).getTime();
  const end = toIso ? new Date(toIso).getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / 60000));
}
