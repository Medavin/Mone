"use client";

import { useEffect, useState } from "react";

/**
 * Clocks for wherever the team sits.
 *
 * Rendered client-side and only after mount. The server has no idea what time
 * it is where the viewer is, so rendering a clock on the server guarantees a
 * hydration mismatch and a wrong first frame.
 *
 * Working hours are marked so a glance answers the real question, which is
 * not "what time is it in Dehradun" but "can I call them right now".
 */
export type Region = { label: string; tz: string; startHour?: number; endHour?: number };

export default function RegionClocks({
  regions,
  compact = false,
}: {
  regions: Region[];
  compact?: boolean;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  if (!now) {
    return <div className="h-6" aria-hidden />;
  }

  const read = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
      day: "numeric",
      month: "short",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return {
      time: `${get("hour")}:${get("minute")}`,
      date: `${get("weekday")} ${get("day")} ${get("month")}`,
      hour: Number(get("hour")),
      weekday: get("weekday"),
    };
  };

  return (
    <div className={compact ? "flex flex-wrap gap-4" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4"}>
      {regions.map((r) => {
        const t = read(r.tz);
        const start = r.startHour ?? 9;
        const end = r.endHour ?? 18;
        // A shift that crosses midnight wraps, so the test has to wrap too.
        const working =
          start <= end ? t.hour >= start && t.hour < end : t.hour >= start || t.hour < end;
        const weekend = ["Sat", "Sun"].includes(t.weekday);
        const live = working && !weekend;

        if (compact) {
          return (
            <span key={r.label} className="flex items-baseline gap-1.5 text-xs">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-good" : "bg-hairline"}`} />
              <span className="text-muted">{r.label}</span>
              <span className="tnum font-medium">{t.time}</span>
            </span>
          );
        }

        return (
          <div key={r.label} className="rounded-card border border-hairline bg-surface shadow-card p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
                {r.label}
              </span>
              <span
                className={`inline-block h-2 w-2 rounded-full ${live ? "bg-good" : "bg-hairline"}`}
                title={live ? "Working hours" : weekend ? "Weekend" : "Outside working hours"}
              />
            </div>
            <div className="tnum mt-1 text-2xl font-medium">{t.time}</div>
            <div className="text-xs text-muted">{t.date}</div>
          </div>
        );
      })}
    </div>
  );
}
