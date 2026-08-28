/**
 * @module hand-discard-recycle-trigger
 *
 * Offers the `hand-discard-recycle-option` choice (Enduring Tales, dm-125:
 * "When any player discards a card from his hand, he may discard it to the
 * top of his play deck (and always face down) instead of to his discard
 * pile") whenever a card leaves either player's hand and lands in that same
 * player's discard pile.
 *
 * There is no single call site for "a card left the hand and reached the
 * discard pile" — end-of-turn hand-size reduction, the voluntary end-of-turn
 * discard, forced discards, and cost payments each remove cards from
 * `player.hand` independently — so, like {@link module:hand-discard-trigger}
 * (Pale Dream-maker's corruption check), the trigger is evaluated as a
 * prev/next diff after every reducer step: a card counts as "discarded from
 * hand" when its instance left `hand` and landed in `discardPile` within the
 * same step, which distinguishes a discard from a card merely being played
 * (which leaves the hand for `cardsInPlay`/a character/etc., not the discard
 * pile).
 *
 * Unlike Pale Dream-maker's trigger, this one is **not** restricted to the
 * active player: Enduring Tales reads "any player", and the card granting the
 * option need not belong to the player who discards. Both players' hands are
 * scanned every step.
 */

import type { GameState, PlayerState, CardInstanceId } from '../index.js';
import { Phase } from '../types/state-phases.js';
import { handDiscardRecycleOptionInPlay } from './reducer-utils.js';
import { enqueueResolution } from './pending.js';
import { logDetail } from './legal-actions/log.js';

function handInstanceIds(player: PlayerState): Set<string> {
  return new Set(player.hand.map(c => c.instanceId as string));
}

function discardInstanceIds(player: PlayerState): Set<string> {
  return new Set(player.discardPile.map(c => c.instanceId as string));
}

/**
 * `prev`/`next` are the pre- and post-action states. Enqueues one
 * `hand-discard-recycle-offer` resolution per card newly found in a player's
 * discard pile that was in their hand a step ago.
 */
export function applyHandDiscardRecycleOffers(prev: GameState, next: GameState): GameState {
  if (next.phaseState.phase === Phase.Setup) return next;

  const marker = handDiscardRecycleOptionInPlay(next);
  if (!marker) return next;

  let state = next;
  for (let pi = 0; pi < next.players.length; pi++) {
    const player = next.players[pi];
    const before = handInstanceIds(prev.players[pi]);
    const after = handInstanceIds(player);
    const nowInDiscard = discardInstanceIds(player);
    const discardedFromHand = [...before].filter(id => !after.has(id) && nowInDiscard.has(id));
    if (discardedFromHand.length === 0) continue;

    for (const instanceId of discardedFromHand) {
      logDetail(`${marker.sourceName}: ${player.name} discarded a card from hand — offering to recycle it to the top of the play deck instead`);
      state = enqueueResolution(state, {
        source: null,
        actor: player.id,
        scope: { kind: 'phase', phase: state.phaseState.phase },
        kind: {
          type: 'hand-discard-recycle-offer',
          instanceId: instanceId as CardInstanceId,
          sourceName: marker.sourceName,
        },
      });
    }
  }
  return state;
}
