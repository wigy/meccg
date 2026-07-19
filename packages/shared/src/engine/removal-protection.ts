/**
 * @module engine/removal-protection
 *
 * Tookish Blood (tw-104), resource mode — "Alternatively, this card can be
 * played as a resource card. For the rest of the turn, the target Hobbit cannot
 * be discarded or returned to its owner's hand for any reason."
 *
 * The protection is modelled as a turn-scoped `character-removal-protected`
 * {@link ActiveConstraint} targeting the protected character. It is installed
 * by the resource-mode play (`handlePlayShortEvent` in `reducer-events.ts`) and
 * consulted by the two central character-removal helpers in
 * `pending-reducers.ts`:
 *
 * - `returnCharacterToHand` — the dice-check `return-character-to-hand` branch
 *   used by Call of Home / Tookish Blood's own hazard mode, and any other
 *   return-to-hand resolution — fizzles when the character is protected.
 * - `discardCharacter` (only the `'discard'` destination, not an elimination to
 *   out-of-play) — fizzles when the character is protected.
 *
 * Because the constraint carries `scope: { kind: 'turn' }`, the turn-end sweep
 * in `pending.ts` clears it automatically, so the protection lasts exactly
 * "the rest of the turn".
 */

import type { GameState, CardInstanceId, CardDefinitionId } from '../index.js';
import { addConstraint } from './pending.js';

/**
 * True if the given character currently carries an active
 * `character-removal-protected` constraint (Tookish Blood's resource mode).
 * While true, the character cannot be discarded or returned to hand.
 */
export function isCharacterRemovalProtected(
  state: GameState,
  characterId: CardInstanceId,
): boolean {
  return state.activeConstraints.some(
    c =>
      c.kind.type === 'character-removal-protected'
      && c.target.kind === 'character'
      && c.target.characterId === characterId,
  );
}

/**
 * Install the turn-scoped removal protection on a character. The `source`
 * instance is the Tookish Blood card that granted it (for logs / UI); the
 * constraint auto-clears at turn end.
 */
export function addRemovalProtection(
  state: GameState,
  characterId: CardInstanceId,
  source: CardInstanceId,
  sourceDefinitionId: CardDefinitionId,
): GameState {
  return addConstraint(state, {
    source,
    sourceDefinitionId,
    scope: { kind: 'turn' },
    target: { kind: 'character', characterId },
    kind: { type: 'character-removal-protected' },
  });
}
