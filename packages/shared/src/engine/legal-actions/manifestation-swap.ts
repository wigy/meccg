/**
 * @module legal-actions/manifestation-swap
 *
 * Manifestation replacement (Strider ba-1: "You may bring Aragorn II into
 * play with Strider's company, removing Strider from the game and
 * automatically transferring all cards on Strider to Aragorn II").
 *
 * An in-play character whose definition carries a `manifestation-swap`
 * effect enables playing the effect's `bring` character from hand into the
 * bearer's company, replacing the bearer — see
 * {@link ManifestationSwapEffect}. Per the CRF the swap "can be done at any
 * time that a normal resource could be played", so this helper is invoked
 * from the organization, movement/hazard, and site phase aggregators (the
 * same windows as recruit-via-event).
 *
 * The replacement takes over the bearer's control slot, so the swap is only
 * offered when the influence freed by the bearer leaving play covers the
 * replacement's mind: for a general-influence bearer, remaining GI + bearer
 * mind ≥ replacement mind; for a direct-influence follower, the
 * controller's unused DI + bearer mind ≥ replacement mind.
 *
 * Each viable swap produces a `play-character` action carrying
 * `swapForInstanceId` (the bearer) so the reducer runs the replacement path
 * instead of a normal play.
 */

import type {
  CardInstanceId,
  EvaluatedAction,
  GameState,
  PlayerId,
} from '../../index.js';
import { isCharacterCard } from '../../types/cards.js';
import type { CardEffect, ManifestationSwapEffect } from '../../types/effects.js';
import { logDetail } from './log.js';
import { resolveDef } from '../effects/index.js';
import {
  characterEntries,
  defById,
  effectiveGeneralInfluence,
  findCharacterCompany,
  isUniqueCharacterInPlay,
  playerById,
} from '../reducer-utils.js';
import { availableDI } from './organization.js';

/**
 * Generates `play-character` swap actions enabled by in-play characters
 * carrying a `manifestation-swap` effect. One action is emitted per
 * (bearer, replacement-in-hand) pair whose control slot can absorb the
 * replacement. Returns an empty list when no swap is currently possible.
 */
export function manifestationSwapActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  // Only the active player, on their own turn, may use the replacement.
  if (state.activePlayer !== playerId) return [];

  const player = playerById(state, playerId);
  if (!player) return [];

  const results: EvaluatedAction[] = [];

  for (const [bearerId, bearer] of characterEntries(player)) {
    const bearerDef = resolveDef(state, bearer.instanceId);
    if (!isCharacterCard(bearerDef)) continue;
    const effects = (bearerDef as { effects?: readonly CardEffect[] }).effects ?? [];
    const swap = effects.find((e): e is ManifestationSwapEffect => e.type === 'manifestation-swap');
    if (!swap) continue;

    // The replacement must be in the player's hand.
    const replacementCard = player.hand.find(c => (c.definitionId as string) === swap.bring);
    if (!replacementCard) {
      logDetail(`manifestation-swap on ${bearerDef.name}: ${swap.bring} not in hand`);
      continue;
    }
    const replacementDef = defById(state, replacementCard.definitionId);
    if (!isCharacterCard(replacementDef) || replacementDef.mind === null) continue;

    // Belt-and-braces: a same-named copy of the replacement in play (e.g.
    // the opponent's) still blocks the swap; the bearer itself is the
    // manifestation being replaced and does not.
    if (replacementDef.unique && isUniqueCharacterInPlay(state, replacementDef.name)) {
      logDetail(`manifestation-swap on ${bearerDef.name}: ${replacementDef.name} already in play`);
      continue;
    }

    const company = findCharacterCompany(player.companies, bearerId);
    if (!company || !company.currentSite) {
      logDetail(`manifestation-swap on ${bearerDef.name}: bearer has no company at a site`);
      continue;
    }

    // Influence gate: the bearer's mind is freed as the replacement enters,
    // so it counts toward covering the replacement's mind.
    const bearerMind = bearerDef.mind ?? 0;
    if (bearer.controlledBy === 'general') {
      const remainingGI = effectiveGeneralInfluence(state, playerId) - player.generalInfluenceUsed;
      if (remainingGI + bearerMind < replacementDef.mind) {
        logDetail(`manifestation-swap on ${bearerDef.name}: mind ${replacementDef.mind} exceeds remaining GI ${remainingGI} + freed ${bearerMind}`);
        continue;
      }
    } else {
      const controllerId = bearer.controlledBy as CardInstanceId;
      const avail = availableDI(state, controllerId, player, replacementDef);
      if (avail + bearerMind < replacementDef.mind) {
        logDetail(`manifestation-swap on ${bearerDef.name}: mind ${replacementDef.mind} exceeds controller's unused DI ${avail} + freed ${bearerMind}`);
        continue;
      }
    }

    logDetail(`manifestation-swap: ${replacementDef.name} may replace ${bearerDef.name} in company ${company.id as string}`);
    results.push({
      action: {
        type: 'play-character',
        player: playerId,
        characterInstanceId: replacementCard.instanceId,
        atSite: company.currentSite.instanceId,
        controlledBy: bearer.controlledBy,
        swapForInstanceId: bearerId,
      },
      viable: true,
    });
  }

  return results;
}
