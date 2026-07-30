/**
 * @module combat-detainment-suffix
 *
 * Pure logic for flagging a detainment attack in the combat situation banner.
 * Extracted from `combat-view.ts` so it can be unit-tested without a DOM
 * environment (same pattern as `combat-button-label.ts`).
 */

/**
 * Appends a "(Detainment)" marker to the situation-banner text when the
 * current combat is a detainment attack (CoE 3.II) — a successful strike
 * taps the target instead of wounding it, and the attack has no body checks
 * or kill-MP (3.II.1, 3.II.3). Without this marker, the banner reads exactly
 * like a normal attack and a player can misjudge the risk of a strike.
 */
export function withDetainmentSuffix(phaseText: string, detainment: boolean): string {
  return detainment ? `${phaseText} (Detainment)` : phaseText;
}
