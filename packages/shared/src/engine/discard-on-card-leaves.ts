/**
 * @module discard-on-card-leaves
 *
 * Post-action housekeeping for the `discard-on-card-leaves-play` card effect: an
 * in-play card that discards **itself** the moment another card matching its
 * `filter` leaves its controller's play area. The trigger is the *event* of a
 * matching card disappearing from the controller's `cardsInPlay`, so it is
 * evaluated as a prev/next diff after every reducer step — the same reactive
 * diff pattern used by A More Evil Hour ({@link module:engine/evil-hour}).
 *
 * Used by Alliance of Free Peoples (as-45): "Discard when any hero Dwarf
 * faction, hero Elf faction, or hero Man faction is discarded from play." The
 * carrier goes away even when the race-diversity gate on its MP bonus would
 * still hold afterwards (e.g. losing one of two Man factions), matching the
 * printed "any … faction … discarded" wording rather than a "gate no longer
 * holds" condition.
 *
 * Distinct from `discard-self-when` (a single-state player-state condition) —
 * this needs the pre-action state to see which card *left*.
 */

import type { GameState, PlayerState } from '../index.js';
import { Phase } from '../types/state-phases.js';
import { matchesContext } from '../effects/index.js';
import { logDetail } from './legal-actions/log.js';
import { defById, getCardEffects, discardCardsInPlayWhere } from './reducer-utils.js';

/**
 * The set of instance IDs currently occupying a player's bare `cardsInPlay`
 * (factions, permanent-events, stage cards). A card that leaves play disappears
 * from this set. Set-aside cards (MEAS §1) are excluded — they are physically
 * kept in a host's `cardsInPlay` but are not "in play" for their owner.
 */
function inPlayCardIds(player: PlayerState): Set<string> {
  const ids = new Set<string>();
  for (const cip of player.cardsInPlay) {
    if (cip.setAsideHost !== undefined) continue;
    ids.add(cip.instanceId as string);
  }
  return ids;
}

/**
 * Discards any in-play card carrying a `discard-on-card-leaves-play` effect whose
 * controller just lost (from `cardsInPlay`) a card matching the effect's filter.
 * `prev` is the pre-action state, `next` the post-action state. Skipped during
 * setup (starting cards must not be swept before the game proper begins).
 */
export function applyDiscardOnCardLeaves(prev: GameState, next: GameState): GameState {
  if (next.phaseState.phase === Phase.Setup) return next;

  // Fast path: nothing to do unless some card with the trigger is in play.
  const anyTrigger = next.players.some(p =>
    p.cardsInPlay.some(cip =>
      getCardEffects(defById(next, cip.definitionId)).some(e => e.type === 'discard-on-card-leaves-play')));
  if (!anyTrigger) return next;

  // Per player: did a card matching *some* active trigger's filter just leave
  // their play area? Recorded as the set of trigger-carrier instance IDs whose
  // filter was satisfied by a leaving card, so only those carriers are discarded.
  const carriersToDiscard = new Set<string>();
  for (let pi = 0; pi < next.players.length; pi++) {
    const player = next.players[pi];
    const beforeIds = inPlayCardIds(prev.players[pi]);
    const afterIds = inPlayCardIds(player);

    // Resolve the definitions of cards that were in play before and are gone now.
    const leftDefs = [...beforeIds]
      .filter(id => !afterIds.has(id))
      .map(id => prev.players[pi].cardsInPlay.find(c => (c.instanceId as string) === id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
      .map(c => defById(prev, c.definitionId))
      .filter((d): d is NonNullable<typeof d> => d !== undefined);
    if (leftDefs.length === 0) continue;

    for (const cip of player.cardsInPlay) {
      const def = defById(next, cip.definitionId);
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'discard-on-card-leaves-play') continue;
        const triggered = leftDefs.some(leftDef => matchesContext(effect.filter, { card: leftDef }));
        if (triggered) {
          logDetail(`discard-on-card-leaves-play: "${(def as { name?: string } | undefined)?.name ?? (cip.definitionId as string)}" — a matching card left ${player.name}'s play area`);
          carriersToDiscard.add(cip.instanceId as string);
        }
      }
    }
  }

  if (carriersToDiscard.size === 0) return next;
  return discardCardsInPlayWhere(next, card => carriersToDiscard.has(card.instanceId as string)).state;
}
