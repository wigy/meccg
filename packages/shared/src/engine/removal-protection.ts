/**
 * @module engine/removal-protection
 *
 * Two independent sources of "this character cannot be discarded or
 * returned to its owner's hand for any reason" protection, both consulted by
 * {@link isCharacterRemovalProtected}:
 *
 * - **Tookish Blood** (tw-104), resource mode — "For the rest of the turn,
 *   the target Hobbit cannot be discarded or returned to its owner's hand for
 *   any reason." Modelled as a turn-scoped `character-removal-protected`
 *   {@link ActiveConstraint} targeting the protected character, installed by
 *   the resource-mode play (`handlePlayShortEvent` in `reducer-events.ts`).
 * - **Elf-song** (tw-223) — "While Elf-song is in play, no character at a
 *   Haven [{H}] may be discarded or returned to its owner's hand for any
 *   reason." A continuous, location-gated protection: any character — either
 *   player's — currently standing at a site matching a `removal-protection`
 *   effect's `siteTypes`, for as long as the carrying long-event sits in the
 *   effect owner's `cardsInPlay`. See {@link isSiteRemovalProtected}.
 *
 * Both are consulted by the two central character-removal helpers in
 * `pending-reducers.ts`:
 *
 * - `returnCharacterToHand` — the dice-check `return-character-to-hand` branch
 *   used by Call of Home / Tookish Blood's own hazard mode, the CoE 3.47
 *   influence-overflow return, and any other return-to-hand resolution —
 *   fizzles when the character is protected.
 * - `discardCharacter` (only the `'discard'` destination, not an elimination to
 *   out-of-play) — fizzles when the character is protected.
 *
 * The Tookish Blood constraint carries `scope: { kind: 'turn' }`, so the
 * turn-end sweep in `pending.ts` clears it automatically — the protection
 * lasts exactly "the rest of the turn". The Elf-song protection has no
 * separate expiry to sweep: it is re-evaluated live against the character's
 * current site every time removal is attempted, for as long as Elf-song
 * remains in play.
 */

import type { GameState, CardInstanceId, CardDefinitionId } from '../index.js';
import { addConstraint } from './pending.js';
import { defById, findPlayerAndCompany, getCardEffects } from './reducer-utils.js';
import { isSiteCard } from '../types/cards.js';
import { getEffectiveSiteType } from './effective.js';

/**
 * True if the given character currently carries an active
 * `character-removal-protected` constraint (Tookish Blood's resource mode).
 * While true, the character cannot be discarded or returned to hand.
 */
function isCharacterRemovalProtectedByConstraint(
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
 * True if `characterId` currently stands at a site matching some in-play
 * card's `removal-protection` effect (Elf-song tw-223). Resolves the
 * character's company and its `currentSite`'s effective {@link SiteType} via
 * {@link getEffectiveSiteType}, then checks every card in either player's
 * `cardsInPlay` for a matching `siteTypes` entry. A character belonging to no
 * company, or whose company has no current site, is never protected this way.
 */
export function isSiteRemovalProtected(
  state: GameState,
  characterId: CardInstanceId,
): boolean {
  const found = findPlayerAndCompany(state, characterId);
  if (!found?.company.currentSite) return false;
  const siteDef = defById(state, found.company.currentSite.definitionId);
  if (!isSiteCard(siteDef)) return false;
  const effectiveType = getEffectiveSiteType(
    state, found.company.currentSite.definitionId, siteDef.siteType, found.company.currentSite.instanceId,
  );
  for (const p of state.players) {
    for (const card of p.cardsInPlay) {
      for (const eff of getCardEffects(defById(state, card.definitionId))) {
        if (eff.type !== 'removal-protection') continue;
        if (eff.siteTypes.includes(effectiveType)) return true;
      }
    }
  }
  return false;
}

/**
 * True if the given character cannot currently be discarded or returned to
 * its owner's hand for any reason — either the turn-scoped Tookish Blood
 * constraint or the continuous, location-gated Elf-song protection.
 */
export function isCharacterRemovalProtected(
  state: GameState,
  characterId: CardInstanceId,
): boolean {
  return isCharacterRemovalProtectedByConstraint(state, characterId)
    || isSiteRemovalProtected(state, characterId);
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
