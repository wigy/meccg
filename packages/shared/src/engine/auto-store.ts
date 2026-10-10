/**
 * @module auto-store
 *
 * Automatic storage of the cards a character bears, outside the normal
 * organization-phase `store-item` flow. Used by Fealty Under Trial (as-28):
 * "Make a roll adding the marshalling points (as though they were stored) and
 * corruption points of all items and events played with target minion. All
 * items and storable events played with target minion are then automatically
 * stored (no corruption checks are made)."
 *
 * "Played with" the character means the resources it bears — its `items`
 * list, which holds both items and resource permanent-events played on it.
 * Allies and hazards are not counted.
 */

import type { GameState, CardInstanceId, CardInstance } from '../index.js';
import type { CharacterInPlay } from '../types/state-cards.js';
import type { StorableAtEffect } from '../types/effects.js';
import { isItemCard } from '../types/cards.js';
import { hasPlayFlag } from '../effects/index.js';
import { defById, findCharacterCompany, getCardEffects, updatePlayer } from './reducer-utils.js';
import { removeConstraint } from './pending.js';
import { logDetail } from './legal-actions/log.js';

/**
 * Sum of the marshalling points (as though stored — a `storable-at`
 * `marshallingPoints` override replaces the printed value) and corruption
 * points of every item and resource event the character bears.
 */
export function characterCardsStoredValue(state: GameState, char: CharacterInPlay): number {
  let total = 0;
  for (const card of char.items) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    const storable = getCardEffects(def).find((e): e is StorableAtEffect => e.type === 'storable-at');
    const printedMp = 'marshallingPoints' in def && typeof def.marshallingPoints === 'number' ? def.marshallingPoints : 0;
    const mp = storable?.marshallingPoints ?? printedMp;
    const cp = 'corruptionPoints' in def && typeof def.corruptionPoints === 'number' ? def.corruptionPoints : 0;
    total += mp + cp;
  }
  return total;
}

/**
 * True when a borne card may be automatically stored: every item (except one
 * whose own text forbids storage — the `no-store` play-flag), and every event
 * carrying a `storable-at` effect.
 */
function isAutoStorable(state: GameState, definitionId: CardInstance['definitionId']): boolean {
  const def = defById(state, definitionId);
  if (!def) return false;
  if (isItemCard(def)) return !hasPlayFlag(def, 'no-store');
  return getCardEffects(def).some(e => e.type === 'storable-at');
}

/**
 * Move every auto-storable card borne by `charId` into its owner's
 * marshalling-point pile, stamped with the company's site as `storedAtSite`.
 * No corruption checks are enqueued. Clears any `bearer-cannot-untap`
 * constraint tied to a stored card, as a regular store does.
 */
export function autoStoreCharacterCards(state: GameState, charId: CardInstanceId): GameState {
  const ownerIndex = state.players.findIndex(p => !!p.characters[charId]);
  if (ownerIndex === -1) {
    logDetail(`auto-store: character ${charId as string} no longer in play — no-op`);
    return state;
  }
  const owner = state.players[ownerIndex];
  const char = owner.characters[charId];
  const company = findCharacterCompany(owner.companies, charId);
  const site = company?.destinationSite ?? company?.currentSite;
  const toStore = char.items.filter(i => isAutoStorable(state, i.definitionId));
  if (toStore.length === 0) {
    logDetail(`auto-store: ${charId as string} bears nothing storable`);
    return state;
  }
  const storedIds = new Set(toStore.map(i => i.instanceId));
  const stored: CardInstance[] = toStore.map(i => ({
    instanceId: i.instanceId,
    definitionId: i.definitionId,
    ...(site ? { storedAtSite: site.definitionId } : {}),
  }));
  for (const i of toStore) {
    logDetail(`auto-store: ${defById(state, i.definitionId)?.name ?? '?'} stored (no corruption check)`);
  }
  let next = updatePlayer(state, ownerIndex, p => ({
    ...p,
    characters: {
      ...p.characters,
      [charId]: { ...char, items: char.items.filter(i => !storedIds.has(i.instanceId)) },
    },
    killPile: [...p.killPile, ...stored],
  }));
  for (const c of next.activeConstraints) {
    if (c.kind.type === 'bearer-cannot-untap' && storedIds.has(c.kind.cardInstanceId)) {
      next = removeConstraint(next, c.id);
    }
  }
  return next;
}
