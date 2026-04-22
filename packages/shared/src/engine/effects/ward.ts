/**
 * @module engine/effects/ward
 *
 * Helpers for the `ward-bearer` DSL effect — an item or card attached to
 * a character that cancels a filtered class of hazards targeting the
 * bearer. Two call sites need this logic:
 *
 * - **Entry discard**: when the warding card itself attaches to a
 *   character, every hazard currently on that character whose definition
 *   matches the ward filter is discarded (Adamant Helmet sweeping
 *   existing dark enchantments off its wearer).
 * - **Prevent attachment**: when a hazard permanent-event would attach to
 *   a character that already carries a matching ward, the hazard is
 *   diverted to its owner's discard pile instead of ending up in
 *   `character.hazards`.
 *
 * The ward filter is a standard DSL condition evaluated against the
 * hazard card's definition (dot-path keys against the JSON shape).
 */

import type { GameState, CardInstanceId, CardDefinition, CardInPlay } from '../../index.js';
import { matchesCondition } from '../../effects/index.js';
import { ownerOf } from '../../types/state.js';
import { updatePlayer, updateCharacter } from '../reducer-utils.js';
import { logDetail } from '../legal-actions/log.js';

/**
 * Return every `ward-bearer` filter declared by any item attached to the
 * given character. The caller evaluates the filters against a candidate
 * hazard definition with {@link matchesCondition}.
 */
export function collectBearerWardFilters(
  state: GameState,
  playerIndex: number,
  charInstanceId: CardInstanceId,
): readonly import('../../types/effects.js').Condition[] {
  const char = state.players[playerIndex].characters[charInstanceId as string];
  if (!char) return [];
  const filters: import('../../types/effects.js').Condition[] = [];
  for (const item of char.items) {
    const def = state.cardPool[item.definitionId as string];
    if (!def || !('effects' in def) || !def.effects) continue;
    for (const eff of def.effects) {
      if (eff.type === 'ward-bearer') filters.push(eff.filter);
    }
  }
  return filters;
}

/** True if any ward on `charInstanceId` cancels `hazardDef`. */
export function isWardedAgainst(
  state: GameState,
  playerIndex: number,
  charInstanceId: CardInstanceId,
  hazardDef: CardDefinition,
): boolean {
  const filters = collectBearerWardFilters(state, playerIndex, charInstanceId);
  if (filters.length === 0) return false;
  const hazardCtx = hazardDef as unknown as Record<string, unknown>;
  return filters.some(f => matchesCondition(f, hazardCtx));
}

/**
 * After a ward-bearing card attaches to a character, discard every hazard
 * currently on that character whose definition matches any `ward-bearer`
 * filter declared on the attached card. Hazards are routed to their
 * owner's discard pile (deck-ownership is derived from the instance ID).
 *
 * The `newItemInstanceId` is excluded from the scan — only pre-existing
 * attached hazards may be swept; the warding card itself is never its
 * own target even if it matched the filter for some reason.
 */
export function applyWardToBearer(
  state: GameState,
  charOwnerIndex: number,
  charInstanceId: CardInstanceId,
  wardCardDef: CardDefinition,
  newItemInstanceId: CardInstanceId,
): GameState {
  if (!('effects' in wardCardDef) || !wardCardDef.effects) return state;
  const filters = wardCardDef.effects
    .filter((e): e is import('../../types/effects.js').WardBearerEffect => e.type === 'ward-bearer')
    .map(e => e.filter);
  if (filters.length === 0) return state;

  const char = state.players[charOwnerIndex].characters[charInstanceId as string];
  if (!char || char.hazards.length === 0) return state;

  const keptHazards: CardInPlay[] = [];
  const discarded: CardInPlay[] = [];
  for (const haz of char.hazards) {
    if (haz.instanceId === newItemInstanceId) { keptHazards.push(haz); continue; }
    const hazDef = state.cardPool[haz.definitionId as string];
    const hazCtx = hazDef as unknown as Record<string, unknown>;
    if (hazDef && filters.some(f => matchesCondition(f, hazCtx))) {
      logDetail(`Ward "${wardCardDef.name}" cancels "${hazDef.name}" on bearer ${charInstanceId as string}`);
      discarded.push(haz);
    } else {
      keptHazards.push(haz);
    }
  }
  if (discarded.length === 0) return state;

  let next = updatePlayer(state, charOwnerIndex, p =>
    updateCharacter(p, charInstanceId as string, c => ({ ...c, hazards: keptHazards })),
  );
  for (const haz of discarded) {
    // Route to the deck-owner's discard pile if the instance id prefix
    // matches a real player (production path). In synthetic test states
    // the prefix may not match a player id — fall back to the opposite
    // of the character-holder, since hazards attached to a character
    // always come from the opposing player's deck.
    const hazOwner = ownerOf(haz.instanceId);
    let ownerIdx = next.players.findIndex(p => p.id === hazOwner);
    if (ownerIdx === -1) ownerIdx = charOwnerIndex === 0 ? 1 : 0;
    next = updatePlayer(next, ownerIdx, p => ({
      ...p,
      discardPile: [...p.discardPile, { instanceId: haz.instanceId, definitionId: haz.definitionId }],
    }));
  }
  return next;
}
