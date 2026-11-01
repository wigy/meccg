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
import { defById, getCardEffects, discardCardsInPlayWhere, hasCardEffect } from './reducer-utils.js';

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
      hasCardEffect(defById(next, cip.definitionId), 'discard-on-card-leaves-play')));
  if (!anyTrigger) return next;

  // Per player: did a card matching *some* active trigger's filter just leave
  // their play area? Recorded as the set of trigger-carrier instance IDs whose
  // filter was satisfied by a leaving card, so only those carriers are discarded.
  const carriersToDiscard = new Set<string>();
  for (let pi = 0; pi < next.players.length; pi++) {
    const player = next.players[pi];
    const beforeIds = inPlayCardIds(prev.players[pi]);
    const afterIds = inPlayCardIds(player);

    // Resolve the cards (with definitions) that were in play before and are gone now.
    const left = [...beforeIds]
      .filter(id => !afterIds.has(id))
      .map(id => prev.players[pi].cardsInPlay.find(c => (c.instanceId as string) === id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
      .map(c => ({ cip: c, def: defById(prev, c.definitionId) }))
      .filter((e): e is { cip: typeof e.cip; def: NonNullable<typeof e.def> } => e.def !== undefined);
    if (left.length === 0) continue;

    for (const cip of player.cardsInPlay) {
      const def = defById(next, cip.definitionId);
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'discard-on-card-leaves-play') continue;
        // `containedOnly` (Sentinels of Númenor dm-158): only a card that was
        // placed under this very carrier counts.
        const triggered = left.some(l =>
          (!effect.containedOnly || l.cip.containedBy === cip.instanceId)
          && matchesContext(effect.filter, { card: l.def }));
        if (triggered) {
          logDetail(`discard-on-card-leaves-play: "${def?.name ?? (cip.definitionId as string)}" — a matching card left ${player.name}'s play area`);
          carriersToDiscard.add(cip.instanceId as string);
        }
      }
    }
  }

  if (carriersToDiscard.size === 0) return next;
  return discardCardsInPlayWhere(next, card => carriersToDiscard.has(card.instanceId as string)).state;
}

/**
 * Clears stale {@link CardInPlay.containedBy} stamps: once a
 * `contain-influenced-factions` carrier (Sentinels of Númenor dm-158) has left
 * its controller's play area, the factions that were under it stay in play
 * ("all other contained factions remain") but are no longer contained, so they
 * lose the carrier's MP bonus and are not re-linked should the same instance
 * ever return to play. Single-state sweep run from `postReduce`.
 */
export function clearOrphanedContainedBy(state: GameState): GameState {
  let changed = false;
  const players = state.players.map(p => {
    if (!p.cardsInPlay.some(c => c.containedBy !== undefined)) return p;
    const present = new Set(p.cardsInPlay.filter(c => c.setAsideHost === undefined).map(c => c.instanceId as string));
    const cardsInPlay = p.cardsInPlay.map(c => {
      if (c.containedBy === undefined || present.has(c.containedBy as string)) return c;
      changed = true;
      logDetail(`contain-influenced-factions: carrier ${c.containedBy as string} left play — ${c.instanceId as string} is no longer contained`);
      const { containedBy: _drop, ...rest } = c;
      return rest;
    });
    return { ...p, cardsInPlay };
  });
  if (!changed) return state;
  return { ...state, players: players as unknown as GameState['players'] };
}
