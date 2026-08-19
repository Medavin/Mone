import type { Region } from "@/components/RegionClocks";

/**
 * Where the business operates.
 *
 * Employees carry a free-text `region` label; this maps the ones we know to a
 * real IANA zone. Anything unrecognised is simply not shown as a clock rather
 * than guessed at — a wrong clock is worse than a missing one.
 *
 * Working hours are the local ones for each site. India runs the night shift
 * that covers the US day, which is why its window wraps past midnight.
 */
export const KNOWN_REGIONS: Record<string, Region> = {
  india:     { label: "India",      tz: "Asia/Kolkata",       startHour: 18, endHour: 4 },
  dehradun:  { label: "Dehradun",   tz: "Asia/Kolkata",       startHour: 18, endHour: 4 },
  "us pacific": { label: "US Pacific", tz: "America/Los_Angeles", startHour: 8, endHour: 18 },
  california: { label: "California", tz: "America/Los_Angeles", startHour: 8, endHour: 18 },
  "us eastern": { label: "US Eastern", tz: "America/New_York",   startHour: 8, endHour: 18 },
  "us central": { label: "US Central", tz: "America/Chicago",    startHour: 8, endHour: 18 },
  nevada:    { label: "Nevada",     tz: "America/Los_Angeles", startHour: 8, endHour: 18 },
  michigan:  { label: "Michigan",   tz: "America/Detroit",     startHour: 8, endHour: 18 },
  uk:        { label: "UK",         tz: "Europe/London",       startHour: 9, endHour: 17 },
};

/** The default set, used before anybody has a region recorded. */
export const DEFAULT_REGIONS: Region[] = [
  KNOWN_REGIONS["us pacific"],
  KNOWN_REGIONS["us eastern"],
  KNOWN_REGIONS.india,
];

export function regionsFromLabels(labels: (string | null)[]): Region[] {
  const found = new Map<string, Region>();
  for (const raw of labels) {
    const key = (raw ?? "").trim().toLowerCase();
    const hit = KNOWN_REGIONS[key];
    if (hit) found.set(hit.label, hit);
  }
  return found.size > 0 ? Array.from(found.values()) : DEFAULT_REGIONS;
}
