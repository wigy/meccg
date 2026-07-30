/**
 * @module protected-long-event
 *
 * The `play-target: "long-event"` binding (`CardInPlay.attachedToLongEvent`):
 * a resource permanent event played "on" one of its controller's own in-play
 * resource long-events. Two housekeeping halves live here, mirroring the
 * `attachedToItem` orphan sweep plus a `retain-hazard-long-events`-style
 * mutual-discard cascade:
 *
 * - {@link isLongEventProtected} — consulted by the rule 4.01
 *   beginning-of-long-event-phase sweep (`reducer-organization.ts`) to skip
 *   discarding a resource long-event that is the target of an in-play
 *   protector.
 * - {@link discardOrphanedLongEventAttachedEvents} — single-state postReduce
 *   sweep: discards a protector whose target long-event has left play by some
 *   other means (mirrors `discardOrphanedItemAttachedEvents`).
 * - {@link sweepProtectedLongEventCascade} — `prev`/`next` diff postReduce
 *   sweep: when a protector leaves play (its own `discard-self-when` or
 *   `play-deck-exhausted` self-discard fired this step), its target
 *   long-event is discarded with it.
 *
 * Used by Echo of All Joy (td-110): "Play on a resource long-event... The
 * long-event is not discarded as normal during a long-event phase. Discard
 * Echo of All Joy and target long-event when any play deck is exhausted or
 * when Doors of Night comes into play."
 */
import type { CardInPlay, CardInstanceId, GameState } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { discardCardsInPlayWhere, toCardInstance, updatePlayer } from './reducer-utils.js';

/**
 * True iff some in-play card in `cardsInPlay` is attached to `candidateId` via
 * `attachedToLongEvent` — exempting it from the rule 4.01
 * beginning-of-long-event-phase discard sweep.
 */
export function isLongEventProtected(cardsInPlay: readonly CardInPlay[], candidateId: CardInstanceId): boolean {
  return cardsInPlay.some(c => c.attachedToLongEvent === candidateId);
}

/**
 * Discards any card whose `attachedToLongEvent` target is no longer present
 * in that same player's `cardsInPlay` — the target left play by some other
 * means (e.g. a voluntary discard), so the protector follows it.
 */
export function discardOrphanedLongEventAttachedEvents(state: GameState): GameState {
  const { state: next } = discardCardsInPlayWhere(
    state,
    (card, player) => card.attachedToLongEvent !== undefined
      && !player.cardsInPlay.some(c => c.instanceId === card.attachedToLongEvent),
    card => {
      const def = state.cardPool[card.definitionId] as { name?: string } | undefined;
      logDetail(`long-event-attached event: discarding "${def?.name ?? (card.definitionId as string)}" — target long-event ${card.attachedToLongEvent as string} left play`);
    },
  );
  return next;
}

/**
 * Mutual discard: if a protector left `cardsInPlay` between `prev` and `next`
 * (its own `discard-self-when` / `play-deck-exhausted` self-discard fired
 * this step), its target long-event — if still present in `next` — is
 * discarded too.
 */
export function sweepProtectedLongEventCascade(prev: GameState, next: GameState): GameState {
  let result = next;
  for (let pi = 0; pi < 2; pi++) {
    const before = prev.players[pi].cardsInPlay;
    const afterIds = new Set(result.players[pi].cardsInPlay.map(c => c.instanceId));
    for (const card of before) {
      if (afterIds.has(card.instanceId)) continue; // still in play
      if (card.attachedToLongEvent === undefined) continue;
      const targetId = card.attachedToLongEvent;
      const targetIdx = result.players[pi].cardsInPlay.findIndex(c => c.instanceId === targetId);
      if (targetIdx < 0) continue; // target already gone (or never there)
      const targetCard = result.players[pi].cardsInPlay[targetIdx];
      const def = result.cardPool[targetCard.definitionId] as { name?: string } | undefined;
      logDetail(`long-event protection: discarding "${def?.name ?? (targetId as string)}" — protector ${card.instanceId as string} left play`);
      result = updatePlayer(result, pi, p => ({
        ...p,
        cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== targetId),
        discardPile: [...p.discardPile, toCardInstance(targetCard)],
      }));
    }
  }
  return result;
}
