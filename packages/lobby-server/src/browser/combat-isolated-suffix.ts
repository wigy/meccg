/**
 * @module combat-isolated-suffix
 *
 * Pure logic for flagging an isolated attack (reduced from a multi-attack
 * creature to a single uncancelable attack by *Forewarned Is Forearmed*) in
 * the combat situation banner. Extracted from `combat-view.ts` so it can be
 * unit-tested without a DOM environment (same pattern as
 * `combat-detainment-suffix.ts`).
 */

/**
 * Appends an "(Isolated by <name> — cannot be canceled)" marker to the
 * situation-banner text when the current attack is `combat.isolated` — a
 * multi-attack creature (e.g. Assassin's three attacks) reduced to one
 * uncancelable attack by *Forewarned Is Forearmed*. Without this marker, the
 * banner reads exactly like a normal single-strike attack, giving no
 * indication that a permanent event is suppressing the creature's other
 * attacks and blocking cancellation (bug cbf2c68230315b0d: a player facing
 * such an attack had no way to see why only one strike occurred, or which
 * card was responsible).
 *
 * Falls back to a generic "(Isolated — cannot be canceled)" marker when the
 * responsible card's name is unavailable (e.g. its definition is redacted
 * from this view).
 */
export function withIsolatedSuffix(phaseText: string, isolated: boolean, sourceName: string | undefined): string {
  if (!isolated) return phaseText;
  return sourceName
    ? `${phaseText} (Isolated by ${sourceName} — cannot be canceled)`
    : `${phaseText} (Isolated — cannot be canceled)`;
}
