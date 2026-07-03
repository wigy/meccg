/**
 * @module legal-actions/manifestation-swap
 *
 * Emits `manifestation-swap` actions for in-play characters carrying a
 * `manifestation-swap` effect (e.g. Strider ba-1: "You may bring Aragorn II
 * into play with Strider's company, removing Strider from the game and
 * automatically transferring all cards on Strider to Aragorn II").
 *
 * Per CRF 22 (Strider), the replacement "can be done at any time that a
 * normal resource could be played", so the emitter is wired into the
 * controller's organization, movement/hazard, and site phase aggregators —
 * the same resource-play windows used by `recruit-via-event`. The swap is
 * not a character play: it never consumes the one-character-per-turn slot
 * and needs no site or influence eligibility beyond the bearer being in a
 * company (the new manifestation inherits the old one's control situation).
 */

import type { GameState, PlayerId, EvaluatedAction } from '../../index.js';
import type { ManifestationSwapEffect } from '../../types/effects.js';
import { isCharacterCard } from '../../types/cards.js';
import { logDetail } from './log.js';
import { characterEntries, defById, findCharacterCompany, getCardEffects, playerById } from '../reducer-utils.js';

/**
 * One action per (in-play swap-carrying character, matching hand card)
 * pair. Only the acting player's own characters and hand are consulted,
 * and only on their own turn (resources are played by the active player).
 */
export function manifestationSwapActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  if (state.activePlayer !== playerId) return [];
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  for (const [charId, char] of characterEntries(player)) {
    const def = defById(state, char.definitionId);
    if (!def || !isCharacterCard(def)) continue;
    const swap = getCardEffects(def).find((e): e is ManifestationSwapEffect => e.type === 'manifestation-swap');
    if (!swap) continue;
    // "into play with <bearer>'s company" — the bearer must be in a company.
    const company = findCharacterCompany(player.companies, charId);
    if (!company) {
      logDetail(`manifestation-swap on ${def.name}: bearer has no company`);
      continue;
    }
    for (const handCard of player.hand) {
      const handDef = defById(state, handCard.definitionId);
      if (!handDef || !isCharacterCard(handDef)) continue;
      if (handDef.name !== swap.cardName) continue;
      logDetail(`manifestation-swap available: ${handDef.name} may replace ${def.name} (removed from the game, cards transferred)`);
      actions.push({
        action: {
          type: 'manifestation-swap',
          player: playerId,
          characterId: charId,
          cardInstanceId: handCard.instanceId,
        },
        viable: true,
      });
    }
  }
  return actions;
}
