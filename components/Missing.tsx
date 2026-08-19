/**
 * Shown where a panel is specified but its data does not exist yet.
 *
 * Deliberately not zeros: a zero says "nothing happened", which is a claim.
 * This says what is needed and why it is not here, so the gap reads as a
 * requirement rather than a bug.
 */
export default function Missing({ needs }: { needs: string }) {
  return (
    <p className="rounded border border-dashed border-hairline px-4 py-6 text-center text-sm text-muted">
      {needs}
    </p>
  );
}
