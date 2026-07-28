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
