/**
 * @module engine/eliminate-instead-of-discard
 *
 * Pallando the Soul-keeper (as-17) — "As a permanent-event, the next
 * non-Ringwraith minion discarded from play is instead eliminated. Discard when
 * a minion is so eliminated."
 *
 * A card carrying the `eliminate-instead-of-discard` effect is a *replacement*
 * for character discards. While it is in play, a character that would be
 * discarded from play (combat body check, failed corruption check, a dice-check
 * `discard-character` branch, …) and matches the effect's card-definition
 * filter is **eliminated** instead: the character card lands in its owner's
 * out-of-play pile rather than the discard pile, so it can never be recycled.
 * Everything else about the removal — possessions to the discard piles,
 * followers back to general influence, companies pruned — is unchanged; only
 * the destination of the character card itself differs (CoE 7.1: discard and
 * eliminate share the whole shape and differ only in the destination pile).
 *
 * The elimination is *not* a body-check kill, so no kill marshalling points
 * change hands: the effect only redirects a removal that was already happening.
 *
 * With `discardSelf` the host card is discarded the instant the replacement
 * fires, which is what makes as-17 a one-shot — "the **next** … minion".
 *
 * Ordering against Press-gang (ba-22), the other discard interceptor: the
 * Press-gang capture is checked first and wins. A captured character is held
 * off to the side and never discarded at all, so there is nothing left for this
 * effect to replace.
 */

import type { CardDefinition, CardInstanceId, GameState } from '../index.js';
import { matchesDefinition, defById, getCardEffects, toCardInstance, cardName, updatePlayer } from './reducer-utils.js';
import { logDetail } from './legal-actions/log.js';

/**
 * A card in play that will replace the next matching character discard with an
 * elimination.
 */
export interface EliminateInsteadOfDiscardHost {
  /** The in-play card instance carrying the effect. */
  readonly instanceId: CardInstanceId;
  /** Index of the player who controls the host card. */
  readonly playerIndex: number;
  /** Whether the host discards itself once the replacement fires. */
  readonly discardSelf: boolean;
}

/**
 * Find an in-play `eliminate-instead-of-discard` host whose filter matches the
 * character definition about to be discarded, or `null` when none applies.
 *
 * Both players' `cardsInPlay` are scanned (the effect is worded about "the next
 * … minion", not "your opponent's"), skipping set-aside copies exactly as
 * Press-gang does — a card held off to the side with a host is not in play in
 * its own right.
 */
export function findEliminateInsteadOfDiscardHost(
  state: GameState,
  charDef: CardDefinition | undefined,
): EliminateInsteadOfDiscardHost | null {
  if (!charDef) return null;
  for (let playerIndex = 0; playerIndex < state.players.length; playerIndex++) {
    for (const card of state.players[playerIndex].cardsInPlay) {
      if (card.setAsideHost !== undefined) continue;
      const def = defById(state, card.definitionId);
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'eliminate-instead-of-discard') continue;
        if (effect.filter && !matchesDefinition(charDef, effect.filter)) {
          logDetail(`eliminate-instead-of-discard: "${cardName(state, card.definitionId, '?')}" does not apply to ${charDef.name} — filter does not match`);
          continue;
        }
        logDetail(`eliminate-instead-of-discard: "${cardName(state, card.definitionId, '?')}" replaces the discard of ${charDef.name} with an elimination`);
        return { instanceId: card.instanceId, playerIndex, discardSelf: effect.discardSelf === true };
      }
    }
  }
  return null;
}

/**
 * Discard the host card once its replacement has fired ("Discard when a minion
 * is so eliminated"). A no-op when the host does not discard itself, or when it
 * has already left play.
 */
export function consumeEliminateInsteadOfDiscardHost(
  state: GameState,
  host: EliminateInsteadOfDiscardHost,
): GameState {
  if (!host.discardSelf) return state;
  const card = state.players[host.playerIndex]?.cardsInPlay.find(c => c.instanceId === host.instanceId);
  if (!card) return state;
  logDetail(`eliminate-instead-of-discard: discarding "${cardName(state, card.definitionId, '?')}" — a matching character was so eliminated`);
  return updatePlayer(state, host.playerIndex, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== host.instanceId),
    discardPile: [...p.discardPile, toCardInstance(card)],
  }));
}
