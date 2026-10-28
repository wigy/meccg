/**
 * @module return-controller-on-leave
 *
 * Post-action housekeeping for the `return-controller-to-hand-on-leave` ally
 * effect: when such an ally leaves active play by **any** route (discarded by
 * a hazard, killed in combat, purged by Fell Rider, …) while the character
 * controlling it stays in play, that character is returned to its owner's hand.
 *
 * An ally can leave play through many independent code paths with no single
 * call site to instrument, so the trigger is evaluated as a prev/next diff
 * after every reducer step — the same reactive pattern as
 * {@link module:engine/discard-on-card-leaves}.
 *
 * Used by Black Horse (as-72): "Return its controller to your hand if Black
 * Horse leaves active play."
 */

import type { CardDefinitionId, GameState } from '../index.js';
import { Phase } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { defById, hasCardEffect } from './reducer-utils.js';
import { returnCharacterToHand } from './pending-reducers.js';

/** True when the ally definition carries `return-controller-to-hand-on-leave`. */
function returnsControllerOnLeave(state: GameState, definitionId: CardDefinitionId): boolean {
  return hasCardEffect(defById(state, definitionId), 'return-controller-to-hand-on-leave');
}

/**
 * Returns to hand every character that, in `prev`, controlled an ally carrying
 * `return-controller-to-hand-on-leave` which is no longer attached to any
 * character in `next`, provided the controller itself is still in play.
 * Skipped during setup.
 */
export function applyReturnControllerOnLeave(prev: GameState, next: GameState): GameState {
  if (next.phaseState.phase === Phase.Setup) return next;

  const inPlayAllies = new Set<string>();
  for (const p of next.players) {
    for (const ch of Object.values(p.characters)) {
      for (const a of ch.allies) inPlayAllies.add(a.instanceId as string);
    }
  }

  let result = next;
  for (let pi = 0; pi < prev.players.length; pi++) {
    for (const prevChar of Object.values(prev.players[pi].characters)) {
      const left = prevChar.allies.find(a =>
        !inPlayAllies.has(a.instanceId as string) && returnsControllerOnLeave(prev, a.definitionId));
      if (!left) continue;
      const charId = prevChar.instanceId;
      const current = result.players[pi].characters[charId];
      if (!current) continue;
      logDetail(`return-controller-to-hand-on-leave: ${defById(prev, left.definitionId)?.name ?? left.definitionId as string} left play — returning its controller ${defById(prev, prevChar.definitionId)?.name ?? charId as string} to hand`);
      result = returnCharacterToHand(result, pi, charId, current);
    }
  }
  return result;
}
