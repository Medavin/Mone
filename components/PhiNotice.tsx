/**
 * Shown on every screen that can hold a patient identifier.
 *
 * It is not decoration and it is not legal throat-clearing. These three
 * screens are the first in MBOne that can carry a patient name, and the
 * application is not yet on infrastructure covered by a business associate
 * agreement. Somebody will eventually paste a real export into one of them
 * without thinking about it, and the only thing standing between that and a
 * reportable breach is a sentence they cannot miss.
 */
export default function PhiNotice() {
  return (
    <p className="mt-4 rounded-card border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-warn">
      <strong>Test data only.</strong> This screen can hold a patient name, and MBOne is not yet on
      hosting covered by a business associate agreement. Real patient identifiers must not be loaded
      here until that move is done — every figure below works with the name left blank.
    </p>
  );
}
