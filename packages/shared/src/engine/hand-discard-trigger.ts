/**
 * @module hand-discard-trigger
 *
 * Fires `on-event: 'card-discarded-from-hand'` effects on cards attached to a
 * player's characters whenever that player discards a card from their own
 * hand during their own turn. There is no single call site for "a card left
 * the hand" — end-of-turn hand-size reduction, named-card play costs, and
 * hazard-limit discards each remove cards from `player.hand` independently —
 * so the trigger is evaluated as a prev/next diff after every reducer step,
 * the same reactive pattern used by {@link module:engine/discard-on-card-leaves}
 * and {@link module:engine/post-attack-play}: a card counts as "discarded from
 * hand" when its instance left `hand` and landed in `discardPile` within the
 * same step, which distinguishes a discard from a card merely being played
 * (which leaves the hand for `cardsInPlay`/a character/etc., not the discard
 * pile).
 *
 * Used by Pale Dream-maker (dm-78): "Target character... makes a corruption
 * check each time his player discards a card from his hand during his turn."
 */

import type { GameState, PlayerState, CardInstanceId } from '../index.js';
import { Phase } from '../types/state-phases.js';
import { defById, getOnEventEffects } from './reducer-utils.js';
import { enqueueCorruptionCheck } from './pending.js';
import { logDetail } from './legal-actions/log.js';

/**
 * Instance ids of the cards `before` → `after` discarded from hand this
 * step: in `before.hand`, gone from `after.hand`, and now in
 * `after.discardPile`. Landing in the discard pile is what tells a discard
 * apart from a card leaving the hand to be played. Shared with
 * {@link module:hand-discard-recycle-trigger}.
 */
export function cardsDiscardedFromHand(before: PlayerState, after: PlayerState): CardInstanceId[] {
  const stillInHand = new Set(after.hand.map(c => c.instanceId));
  const inDiscard = new Set(after.discardPile.map(c => c.instanceId));
  return before.hand.map(c => c.instanceId).filter(id => !stillInHand.has(id) && inDiscard.has(id));
}

/**
 * `prev`/`next` are the pre- and post-action states. Only the active
 * player's own hand is checked — the card text triggers "during his turn",
 * i.e. the bearer's controller's own turn — and only cards attached to that
 * same player's characters can carry the trigger (a hazard-event borne by a
 * character always belongs to that character's controller's play area).
 */
export function applyHandDiscardCorruptionChecks(prev: GameState, next: GameState): GameState {
  if (next.phaseState.phase === Phase.Setup || !next.activePlayer) return next;

  let state = next;
  for (let pi = 0; pi < next.players.length; pi++) {
    const player = next.players[pi];
    if (player.id !== next.activePlayer) continue;

    const discardedFromHand = cardsDiscardedFromHand(prev.players[pi], player);
    if (discardedFromHand.length === 0) continue;

    for (const [charId, char] of Object.entries(player.characters)) {
      const attached = [...char.hazards, ...char.items, ...char.allies];
      for (const card of attached) {
        const def = defById(state, card.definitionId);
        const triggers = getOnEventEffects(def, 'card-discarded-from-hand');
        for (const oe of triggers) {
          if (oe.apply.type !== 'force-check' || oe.apply.check !== 'corruption') continue;
          const modifier = oe.apply.modifier ?? 0;
          for (const discardedId of discardedFromHand) {
            logDetail(`card-discarded-from-hand: ${def?.name ?? '?'} on ${charId} — enqueuing corruption check (discarded ${discardedId}, modifier ${modifier})`);
            state = enqueueCorruptionCheck(state, {
              source: card.instanceId,
              actor: player.id,
              scope: { kind: 'phase', phase: state.phaseState.phase },
              characterId: char.instanceId,
              modifier,
              reason: def?.name ?? 'Hand discard',
              allowSupport: true,
            });
          }
        }
      }
    }
  }
  return state;
}
