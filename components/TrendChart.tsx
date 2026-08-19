type Series = {
  label: string;
  color: string;
  values: (number | null)[];
  /** Bars sit behind, lines in front. */
  kind?: "line" | "bar";
};

/**
 * A plain SVG chart, rendered on the server.
 *
 * No charting library. The clinic page needs a shape, not an interactive
 * exploration tool, and a static SVG renders instantly, prints correctly into
 * the client meeting, and adds nothing to the bundle. If tooltips are ever
 * genuinely wanted, that is the moment to reach for a library — not before.
 */
export default function TrendChart({
  months,
  series,
  height = 200,
  format = "money",
}: {
  months: string[];
  series: Series[];
  height?: number;
  format?: "money" | "plain";
}) {
  const W = 900;
  const H = height;
  const padL = 64;
  const padR = 12;
  const padT = 12;
  const padB = 26;

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const max = Math.max(1, ...all);

  // A round number above the data, so the axis reads sensibly.
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / magnitude) * magnitude;

  const n = months.length;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / top) * innerH;

  const short = (v: number) =>
    format === "plain"
      ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : v >= 1_000_000
        ? `$${(v / 1_000_000).toFixed(1)}M`
        : v >= 1_000
          ? `$${Math.round(v / 1_000)}k`
          : `$${Math.round(v)}`;

  // Label a year the first time it appears.
  const yearTicks: { i: number; year: string }[] = [];
  months.forEach((m, i) => {
    const year = m.slice(0, 4);
    if (!yearTicks.some((t) => t.year === year)) yearTicks.push({ i, year });
  });

  const barWidth = Math.max(1, (innerW / Math.max(n, 1)) * 0.6);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={series.map((s) => s.label).join(" and ") + " by month"}
    >
      {/* horizontal guides */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(top * f)}
            y2={y(top * f)}
            stroke="#E1E6E9"
            strokeWidth={1}
          />
          <text
            x={padL - 8}
            y={y(top * f) + 4}
            textAnchor="end"
            fontSize="11"
            fill="#5B6770"
            fontFamily="ui-monospace, monospace"
          >
            {short(top * f)}
          </text>
        </g>
      ))}

      {/* year markers */}
      {yearTicks.map((t) => (
        <text
          key={t.year}
          x={x(t.i)}
          y={H - 8}
          textAnchor="middle"
          fontSize="11"
          fill="#5B6770"
          fontFamily="ui-monospace, monospace"
        >
          {t.year}
        </text>
      ))}

      {series
        .filter((s) => s.kind === "bar")
        .map((s) => (
          <g key={s.label}>
            {s.values.map((v, i) =>
              v === null ? null : (
                <rect
                  key={i}
                  x={x(i) - barWidth / 2}
                  y={y(v)}
                  width={barWidth}
                  height={Math.max(0, padT + innerH - y(v))}
                  fill={s.color}
                  opacity={0.18}
                />
              )
            )}
          </g>
        ))}

      {series
        .filter((s) => s.kind !== "bar")
        .map((s) => {
          const pts = s.values
            .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
            .filter(Boolean)
            .join(" ");
          return (
            <polyline
              key={s.label}
              points={pts}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
    </svg>
  );
}
