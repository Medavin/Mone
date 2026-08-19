/**
 * Month-over-month change. Rising charges and payments are good news; this
 * component is only used for those metrics, so up is always shown as positive.
 * If it gets reused for AR or ageing buckets, add a `positiveIsGood` prop —
 * a rising 120+ bucket is the opposite of good.
 */
export function Delta({
  current,
  previous,
}: {
  current: number | null | undefined;
  previous: number | null | undefined;
}) {
  // Nothing to compare against, so there's no change to report.
  if (!previous || current === null || current === undefined) return null;

  const change = (current - previous) / Math.abs(previous);
  if (!Number.isFinite(change)) return null;

  const rounded = Math.round(change * 1000) / 10;
  if (rounded === 0) return <span className="delta delta--flat">±0%</span>;

  const up = rounded > 0;
  return (
    <span className={`delta ${up ? "delta--up" : "delta--down"}`}>
      {up ? "▲" : "▼"} {Math.abs(rounded)}%
    </span>
  );
}
