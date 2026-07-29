/**
 * @module engine/card-play-prohibition
 *
 * The `prohibit-card-play` play-lock: while a card carrying that effect is in
 * play, the cards it names (or matches with a definition `filter`) may not be
 * played by **either** player.
 *
 * Two shapes share the lock:
 *
 * - *The Under-roads* (as-106) — "Discards and prohibits the subsequent play of
 *   The Way is Shut", a `cardNames` lock (the one-time discard of copies
 *   already in play happens separately, in `chain-reducer.ts`).
 * - *Balance Between Powers* (dm-118) — "No environment cards can be played", a
 *   class-wide `filter` lock that leaves environments already on the table
 *   alone.
 *
 * Enforcement is central rather than per-phase: `computeLegalActions` runs
 * every candidate action through {@link applyCardPlayProhibitions}, so the lock
 * covers the organization/long-event/site phases, hazard play during the
 * movement-hazard phase, and the chain and combat response windows alike — all
 * the places a short, long, permanent or hazard event can be played from hand.
 */

import type { CardDefinition, CardInstanceId, EvaluatedAction, GameState, PlayerId } from '../index.js';
import type { ProhibitCardPlayEffect } from '../types/effects.js';
import { resolveInstanceId } from '../types/state.js';
import { defById, getCardEffects, matchesDefinition } from './reducer-utils.js';
import { notPlayable } from './legal-actions/action-builders.js';
import { logDetail } from './legal-actions/log.js';
import { hasPendingPlay } from './pending.js';

/** Action types that put a card from hand into play as an event. */
const PLAY_FROM_HAND_ACTIONS = new Set([
  'play-short-event',
  'play-long-event',
  'play-permanent-event',
  'play-hazard',
]);

/** Every `prohibit-card-play` effect currently active on either side of the table. */
function activeProhibitions(state: GameState): readonly ProhibitCardPlayEffect[] {
  const found: ProhibitCardPlayEffect[] = [];
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      for (const eff of getCardEffects(defById(state, card.definitionId))) {
        if (eff.type === 'prohibit-card-play') found.push(eff);
      }
    }
  }
  return found;
}

/**
 * True when the given card definition may not be played right now because some
 * in-play card prohibits it — by name (`cardNames`) or by class (`filter`).
 */
export function isCardPlayProhibited(state: GameState, def: CardDefinition | undefined | null): boolean {
  if (!def) return false;
  return activeProhibitions(state).some(
    eff => (eff.cardNames?.includes(def.name) ?? false)
      || (eff.filter !== undefined && matchesDefinition(def, eff.filter)),
  );
}

/**
 * Replace every *viable* card-play action for a prohibited card with a single
 * `not-playable` entry, so the UI can still dim the card and explain why.
 *
 * Entries a phase module already marked non-viable are left untouched: those
 * carry the module's own, more specific reason (the movement-hazard generator
 * checks the same lock itself, so The Under-roads keeps explaining exactly why
 * The Way is Shut cannot be played).
 *
 * A card can attract several play actions at once (one `play-hazard` per
 * targetable company, say); only the first is turned into the explanation and
 * the rest are dropped, to keep the same reason from being listed repeatedly.
 */
export function applyCardPlayProhibitions(
  state: GameState,
  playerId: PlayerId,
  evaluated: readonly EvaluatedAction[],
): EvaluatedAction[] {
  const prohibitions = activeProhibitions(state);
  if (prohibitions.length === 0) return [...evaluated];

  const explained = new Set<string>();
  const result: EvaluatedAction[] = [];
  for (const ea of evaluated) {
    const a = ea.action as unknown as Record<string, unknown>;
    const type = a['type'];
    if (!ea.viable || typeof type !== 'string' || !PLAY_FROM_HAND_ACTIONS.has(type)) {
      result.push(ea);
      continue;
    }
    const instId = a['cardInstanceId'];
    if (typeof instId !== 'string') {
      result.push(ea);
      continue;
    }
    const defId = resolveInstanceId(state, instId as CardInstanceId);
    const def = defId ? defById(state, defId) : undefined;
    if (!isCardPlayProhibited(state, def)) {
      result.push(ea);
      continue;
    }
    if (explained.has(instId)) continue;
    explained.add(instId);
    const name = def?.name ?? (defId as string);
    logDetail(`prohibit-card-play: ${name} may not be played while a card prohibiting it is in play`);
    result.push(notPlayable(playerId, instId as CardInstanceId, `${name}: cannot be played while it is prohibited by a card in play`));
  }
  return result;
}

/**
 * Drop a card from the offered actions while its own play is already pending.
 *
 * Some plays are not applied when declared. A resource played into a company
 * holding on-guard cards is captured as a pending `on-guard-window` resolution
 * so the hazard player may reveal first, and the card waits in hand until that
 * window closes. The emitters read `player.hand` directly, so without this
 * filter the same card is offered again while its play is still in flight.
 *
 * Declaring it again simply queues a second window holding its own copy of the
 * deferred action. When the windows resolve, the first play removes the card
 * from hand and the second fails in `handlePlayResourceShortEvent` with 'Card
 * not found in hand' — which is how seed 599 (heuristic vs h2, decks
 * challenge-deck-a / challenge-deck-b) ended in an engine error, after one card
 * had been declared five times running. Both agents did it and neither knew;
 * nothing in the state said the card was spoken for.
 *
 * CoE 5.1 discards a short event after it resolves, and the engine models
 * "declared but not resolved" by leaving the card in hand behind the window.
 * That is a reasonable implementation, but a card whose play is already pending
 * is not a card that can be played again.
 */
export function applyPendingPlayFilter(
  state: GameState,
  playerId: PlayerId,
  evaluated: readonly EvaluatedAction[],
): EvaluatedAction[] {
  if (state.pendingResolutions.length === 0) return [...evaluated];

  const explained = new Set<string>();
  const result: EvaluatedAction[] = [];
  for (const ea of evaluated) {
    const a = ea.action as unknown as Record<string, unknown>;
    const type = a['type'];
    const instId = a['cardInstanceId'];
    if (!ea.viable
      || typeof type !== 'string'
      || !PLAY_FROM_HAND_ACTIONS.has(type)
      || typeof instId !== 'string'
      || !hasPendingPlay(state, instId as CardInstanceId)) {
      result.push(ea);
      continue;
    }
    if (explained.has(instId)) continue;
    explained.add(instId);
    const defId = resolveInstanceId(state, instId as CardInstanceId);
    const def = defId ? defById(state, defId) : undefined;
    const name = def?.name ?? (defId as string);
    logDetail(`pending-play: ${name} is already declared and awaiting resolution — not playable again`);
    result.push(notPlayable(playerId, instId as CardInstanceId, `${name}: already declared and awaiting resolution`));
  }
  return result;
}
