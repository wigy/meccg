/**
 * @module strike-result-display
 *
 * Pure logic for collapsing the full strike-assignment `result` union down to
 * the 3 display categories the combat view styles/icons understand. Extracted
 * from `combat-view.ts` so it can be unit-tested without a DOM environment
 * (same pattern as `combat-button-label.ts`).
 */

/** The 3 outcomes the combat view has styling/icons for. */
export type StrikeResultDisplay = 'success' | 'wounded' | 'eliminated';

/**
 * Maps a `StrikeAssignment.result` value to the display category the combat
 * view renders. `'success'`, `'wounded'`, and `'eliminated'` map directly, but
 * the engine also records three outcomes where the character/ally took no
 * harm: `'tie'` (CoE 3.iv.7 — ineffectual, character taps unwounded),
 * `'survived'` (the character defeated the strike but the creature/agent's
 * body check passed — still a good outcome for the character), `'canceled'`
 * (a strike-cancel effect voided the strike outright), and `'absorbed'` (an
 * absorb-wound item prevented the wound). All four must render as `'success'`
 * — without this mapping they fell through to the "eliminated" heavy-X icon,
 * making a defended, unwounded character look worse off than "wounded".
 * Returns `null` for an unresolved/missing result (nothing to render).
 */
export function strikeResultDisplay(result: string | undefined): StrikeResultDisplay | null {
  switch (result) {
    case 'success':
    case 'tie':
    case 'survived':
    case 'canceled':
    case 'absorbed':
      return 'success';
    case 'wounded':
      return 'wounded';
    case 'eliminated':
      return 'eliminated';
    default:
      return null;
  }
}

/**
 * Marker id + modifier class for a *resolved* strike's combat arrow. The
 * arrow line used to test the raw `result === 'success'` instead of going
 * through {@link strikeResultDisplay}, so the no-harm outcomes (`'tie'`,
 * `'survived'`, `'canceled'`, `'absorbed'`) got the red wound arrowhead
 * while the card border and overlay — which do use the mapper — showed
 * success. Routing the arrow through the same mapper keeps the three
 * renderings consistent by construction.
 */
export function strikeArrowStyle(result: string | undefined): { marker: string; className: string } {
  return strikeResultDisplay(result) === 'success'
    ? { marker: 'combat-arrowhead-success', className: 'combat-arrow--success' }
    : { marker: 'combat-arrowhead-wound', className: 'combat-arrow--wound' };
}
