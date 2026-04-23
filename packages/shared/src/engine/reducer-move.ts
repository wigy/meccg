/**
 * @module reducer-move
 *
 * Generic card-movement primitive. A `move` effect picks card
 * instance(s) by selector, removes them from a source zone, and
 * appends them to a destination zone.
 *
 * This module implements {@link applyMove} — the single entry point
 * the apply dispatcher uses to execute a {@link MoveEffect}. The
 * two helper functions ({@link resolveMoveSource} and
 * {@link pushToZone}) are exposed for later phases of the card-move
 * primitive plan that need to compose moves with other operations.
 *
 * Phase 1 (initial landing) supports the locators and destinations
 * that Phases 2–6 need for their migrations. The contextual locators
 * for combat (`items-on-wounded`) and event destinations
 * (`in-play-on-character`, `in-play-general`) are introduced by the
 * phases that first use them.
 *
 * Invariant preserved by `applyMove`: every instance removed from its
 * source zone is pushed to a destination zone. `resolveMoveSource`
 * fails closed — if an instance can't be located, no state change
 * happens. See `feedback_no_card_disappears` memory.
 *
 * See `specs/2026-04-23-card-move-primitive-plan.md` for the full
 * migration plan.
 */

import type { GameState, CardInstance, CardInstanceId, PlayerState } from '../index.js';
import type { MoveEffect, MoveZone, Condition } from '../types/effects.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { shuffle } from '../rng.js';
import { logDetail } from './legal-actions/log.js';

/**
 * Runtime context passed to {@link applyMove}. Carries references
 * needed by source locators and destination routing.
 *
 * - `sourceCardId` — the card carrying the effect; used by
 *   `select: 'self'` and `from: 'self-location'`.
 * - `sourcePlayerIndex` — the default owner for destination writes
 *   (overridden by `toOwner: 'opponent'` / `'defender'`).
 * - `targetCardId` — the user-selected target from the triggering
 *   action; used by `select: 'target'` and `from: 'items-on-target'`.
 * - `targetCharacterId` — scoping character for items-on-target;
 *   usually equals `targetCardId` for item moves.
 * - `targetCompanyId` — the company whose attachments are in scope
 *   for `from: 'attached-to-target-company'` (Phase 6).
 * - `woundedCharacterId` / `defenderPlayerIndex` — combat context
 *   for `from: 'items-on-wounded'` (Phase 5).
 */
export interface MoveContext {
  readonly sourceCardId: CardInstanceId;
  readonly sourcePlayerIndex: number;
  readonly targetCardId?: CardInstanceId;
  readonly targetCharacterId?: CardInstanceId;
  readonly targetCompanyId?: CardInstanceId;
  readonly woundedCharacterId?: CardInstanceId;
  readonly defenderPlayerIndex?: number;
}

/** A located source instance + the zone it came from. */
interface LocatedInstance {
  readonly instance: CardInstance;
  readonly ownerIndex: number;
  readonly zone: MoveZone;
  /**
   * Removes this instance from its current location. Composed by
   * `applyMove` into a single state transform alongside all other
   * located instances for the same move.
   */
  readonly remove: (state: GameState) => GameState;
}

type MoveResult = { readonly state: GameState } | { readonly error: string };

/**
 * Execute a move: locate source instance(s), remove them from their
 * current zone(s), push them to the destination zone. On any error,
 * return without modifying state.
 */
export function applyMove(
  state: GameState,
  move: MoveEffect,
  ctx: MoveContext,
): MoveResult {
  const located = resolveMoveSource(state, move, ctx);
  if ('error' in located) return located;
  if (located.instances.length === 0) {
    logDetail(`move: no matching instances in ${stringifyFrom(move.from)} — fizzle`);
    return { state };
  }

  let next = state;
  for (const item of located.instances) {
    next = item.remove(next);
  }
  const pushed = pushToZone(next, move, ctx, located.instances.map(i => i.instance), located.instances);
  if ('error' in pushed) return pushed;
  return { state: pushed.state };
}

/**
 * Find candidate source instances for a move. Returns either a list
 * of located instances (each bundled with a removal callback) or an
 * error if a required context field is missing.
 */
export function resolveMoveSource(
  state: GameState,
  move: MoveEffect,
  ctx: MoveContext,
): { instances: LocatedInstance[] } | { error: string } {
  const fromZones: readonly MoveZone[] = Array.isArray(move.from) ? move.from : [move.from as MoveZone];

  if (move.select === 'self') {
    const located = locateSelf(state, ctx);
    if (!located) {
      return { error: `move: cannot locate source card ${ctx.sourceCardId as string}` };
    }
    if (!fromZones.includes(located.zone) && !fromZones.includes('self-location')) {
      return { error: `move: source card is in ${located.zone}, not in declared from [${fromZones.join(', ')}]` };
    }
    return { instances: [located] };
  }

  if (move.select === 'target') {
    if (!ctx.targetCardId) {
      return { error: `move: select=target requires ctx.targetCardId` };
    }
    for (const zone of fromZones) {
      const located = locateInZone(state, zone, ctx, ctx.targetCardId);
      if (located) {
        if (move.filter && !matchesFilter(state, located.instance, move.filter)) {
          return { error: `move: target ${ctx.targetCardId as string} does not match filter` };
        }
        return { instances: [located] };
      }
    }
    return { error: `move: target ${ctx.targetCardId as string} not in any of [${fromZones.join(', ')}]` };
  }

  if (move.select === 'filter-all') {
    const all: LocatedInstance[] = [];
    for (const zone of fromZones) {
      all.push(...collectFromZone(state, zone, ctx, move.filter));
    }
    if (move.count !== undefined) {
      return { instances: all.slice(0, move.count) };
    }
    return { instances: all };
  }

  if (move.select === 'named') {
    if (!move.cardName) {
      return { error: `move: select=named requires cardName on the effect` };
    }
    for (const zone of fromZones) {
      const candidates = collectFromZone(state, zone, ctx, undefined);
      for (const c of candidates) {
        const def = state.cardPool[c.instance.definitionId as string];
        const name = def && 'name' in def ? (def as { name: string }).name : undefined;
        if (name === move.cardName) return { instances: [c] };
      }
    }
    return { error: `move: no "${move.cardName}" found in [${fromZones.join(', ')}]` };
  }

  return { error: `move: unknown select "${String((move as { select?: string }).select)}"` };
}

/**
 * Push the given cards to the move's destination zone. The owner is
 * determined by `move.toOwner` resolved against `ctx`. Optionally
 * shuffles the destination pile after pushing.
 */
export function pushToZone(
  state: GameState,
  move: MoveEffect,
  ctx: MoveContext,
  cards: readonly CardInstance[],
  sources: readonly LocatedInstance[],
): MoveResult {
  if (cards.length === 0) return { state };

  // Each card can route to a different owner depending on its source
  // (source-owner default routes each card to where it came from).
  let next = state;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const src = sources[i];
    const ownerIndex = resolveDestinationOwner(move, ctx, src);
    const pushed = pushOne(next, move.to, ownerIndex, card);
    if ('error' in pushed) return pushed;
    next = pushed.state;
  }

  if (move.shuffleAfter) {
    const ownerIndex = resolveDestinationOwner(move, ctx, sources[0]);
    const player = next.players[ownerIndex];
    const zonePile = readZone(player, move.to);
    if (zonePile) {
      const [shuffled, rng] = shuffle([...zonePile], next.rng);
      const newPlayers: [PlayerState, PlayerState] = [next.players[0], next.players[1]];
      newPlayers[ownerIndex] = writeZone(player, move.to, shuffled);
      next = { ...next, rng, players: newPlayers };
    }
  }

  return { state: next };
}

/* ------------------------------------------------------------------ */
/* Locators                                                            */
/* ------------------------------------------------------------------ */

function locateSelf(state: GameState, ctx: MoveContext): LocatedInstance | null {
  const sourceId = ctx.sourceCardId;
  for (let pi = 0; pi < state.players.length; pi++) {
    const player = state.players[pi];
    // hand
    const handIdx = player.hand.findIndex(c => c.instanceId === sourceId);
    if (handIdx >= 0) {
      const inst = player.hand[handIdx];
      return {
        instance: inst,
        ownerIndex: pi,
        zone: 'hand',
        remove: s => removeFromHand(s, pi, sourceId),
      };
    }
    // discard
    const discardIdx = player.discardPile.findIndex(c => c.instanceId === sourceId);
    if (discardIdx >= 0) {
      const inst = player.discardPile[discardIdx];
      return {
        instance: inst,
        ownerIndex: pi,
        zone: 'discard',
        remove: s => removeFromDiscard(s, pi, sourceId),
      };
    }
    // cardsInPlay
    const cipIdx = player.cardsInPlay.findIndex(c => c.instanceId === sourceId);
    if (cipIdx >= 0) {
      const inst = player.cardsInPlay[cipIdx];
      return {
        instance: { instanceId: inst.instanceId, definitionId: inst.definitionId },
        ownerIndex: pi,
        zone: 'in-play',
        remove: s => removeFromCardsInPlay(s, pi, sourceId),
      };
    }
    // attached to any character (items or hazards)
    for (const charId of Object.keys(player.characters)) {
      const char = player.characters[charId];
      const itemIdx = char.items.findIndex(i => i.instanceId === sourceId);
      if (itemIdx >= 0) {
        const inst = char.items[itemIdx];
        return {
          instance: { instanceId: inst.instanceId, definitionId: inst.definitionId },
          ownerIndex: pi,
          zone: 'self-location',
          remove: s => removeFromCharacterItems(s, pi, charId as CardInstanceId, sourceId),
        };
      }
      const hazIdx = char.hazards.findIndex(h => h.instanceId === sourceId);
      if (hazIdx >= 0) {
        const inst = char.hazards[hazIdx];
        return {
          instance: { instanceId: inst.instanceId, definitionId: inst.definitionId },
          ownerIndex: pi,
          zone: 'self-location',
          remove: s => removeFromCharacterHazards(s, pi, charId as CardInstanceId, sourceId),
        };
      }
    }
  }
  return null;
}

function locateInZone(
  state: GameState,
  zone: MoveZone,
  ctx: MoveContext,
  instanceId: CardInstanceId,
): LocatedInstance | null {
  // Named pile zones: search the source player's pile first, then the other.
  const playerOrder = [ctx.sourcePlayerIndex, 1 - ctx.sourcePlayerIndex];
  switch (zone) {
    case 'hand':
    case 'deck':
    case 'discard':
    case 'sideboard':
    case 'out-of-play':
    case 'kill-pile': {
      for (const pi of playerOrder) {
        const pile = readZone(state.players[pi], zone);
        if (!pile) continue;
        const idx = pile.findIndex(c => c.instanceId === instanceId);
        if (idx >= 0) {
          const inst = pile[idx];
          return {
            instance: inst,
            ownerIndex: pi,
            zone,
            remove: s => removeFromNamedPile(s, pi, zone, instanceId),
          };
        }
      }
      return null;
    }
    case 'self-location': {
      return locateSelf(state, { ...ctx, sourceCardId: instanceId });
    }
    case 'in-play': {
      for (let pi = 0; pi < state.players.length; pi++) {
        const player = state.players[pi];
        const cipIdx = player.cardsInPlay.findIndex(c => c.instanceId === instanceId);
        if (cipIdx >= 0) {
          const inst = player.cardsInPlay[cipIdx];
          return {
            instance: { instanceId: inst.instanceId, definitionId: inst.definitionId },
            ownerIndex: pi,
            zone: 'in-play',
            remove: s => removeFromCardsInPlay(s, pi, instanceId),
          };
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function collectFromZone(
  state: GameState,
  zone: MoveZone,
  ctx: MoveContext,
  filter: Condition | undefined,
): LocatedInstance[] {
  const out: LocatedInstance[] = [];
  const matches = (inst: CardInstance): boolean =>
    !filter || matchesFilter(state, inst, filter);

  switch (zone) {
    case 'hand':
    case 'deck':
    case 'discard':
    case 'sideboard':
    case 'out-of-play':
    case 'kill-pile': {
      for (let pi = 0; pi < state.players.length; pi++) {
        const pile = readZone(state.players[pi], zone);
        if (!pile) continue;
        for (const inst of pile) {
          if (!matches(inst)) continue;
          const id = inst.instanceId;
          out.push({
            instance: inst,
            ownerIndex: pi,
            zone,
            remove: s => removeFromNamedPile(s, pi, zone, id),
          });
        }
      }
      return out;
    }
    case 'in-play': {
      for (let pi = 0; pi < state.players.length; pi++) {
        const player = state.players[pi];
        for (const cip of player.cardsInPlay) {
          const inst: CardInstance = { instanceId: cip.instanceId, definitionId: cip.definitionId };
          if (!matches(inst)) continue;
          const id = cip.instanceId;
          out.push({
            instance: inst,
            ownerIndex: pi,
            zone: 'in-play',
            remove: s => removeFromCardsInPlay(s, pi, id),
          });
        }
      }
      return out;
    }
    default:
      // Contextual locators (items-on-target, items-on-wounded,
      // attached-to-target-company) are added by the phases that need
      // them. Unsupported zones return no candidates.
      return out;
  }
}

/* ------------------------------------------------------------------ */
/* Destination routing                                                 */
/* ------------------------------------------------------------------ */

function resolveDestinationOwner(
  move: MoveEffect,
  ctx: MoveContext,
  source: LocatedInstance | undefined,
): number {
  switch (move.toOwner) {
    case 'opponent': {
      const srcOwner = source?.ownerIndex ?? ctx.sourcePlayerIndex;
      return 1 - srcOwner;
    }
    case 'defender':
      return ctx.defenderPlayerIndex ?? ctx.sourcePlayerIndex;
    case 'source-owner':
    default:
      return source?.ownerIndex ?? ctx.sourcePlayerIndex;
  }
}

function pushOne(
  state: GameState,
  zone: MoveZone,
  ownerIndex: number,
  card: CardInstance,
): MoveResult {
  const player = state.players[ownerIndex];
  const pile = readZone(player, zone);
  if (!pile) {
    return { error: `move: unsupported destination zone "${zone}"` };
  }
  const updated = writeZone(player, zone, [...pile, card]);
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[ownerIndex] = updated;
  return { state: { ...state, players: newPlayers } };
}

/* ------------------------------------------------------------------ */
/* Zone read/write helpers                                             */
/* ------------------------------------------------------------------ */

function readZone(player: PlayerState, zone: MoveZone): readonly CardInstance[] | null {
  switch (zone) {
    case 'hand': return player.hand;
    case 'deck': return player.playDeck;
    case 'discard': return player.discardPile;
    case 'sideboard': return player.sideboard;
    case 'out-of-play': return player.outOfPlayPile;
    case 'kill-pile': return player.killPile;
    default: return null;
  }
}

function writeZone(player: PlayerState, zone: MoveZone, pile: readonly CardInstance[]): PlayerState {
  switch (zone) {
    case 'hand': return { ...player, hand: pile };
    case 'deck': return { ...player, playDeck: pile };
    case 'discard': return { ...player, discardPile: pile };
    case 'sideboard': return { ...player, sideboard: pile };
    case 'out-of-play': return { ...player, outOfPlayPile: pile };
    case 'kill-pile': return { ...player, killPile: pile };
    default: return player;
  }
}

function removeFromNamedPile(
  state: GameState,
  playerIndex: number,
  zone: MoveZone,
  instanceId: CardInstanceId,
): GameState {
  const player = state.players[playerIndex];
  const pile = readZone(player, zone);
  if (!pile) return state;
  const filtered = pile.filter(c => c.instanceId !== instanceId);
  if (filtered.length === pile.length) return state;
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIndex] = writeZone(player, zone, filtered);
  return { ...state, players: newPlayers };
}

function removeFromHand(state: GameState, pi: number, id: CardInstanceId): GameState {
  return removeFromNamedPile(state, pi, 'hand', id);
}

function removeFromDiscard(state: GameState, pi: number, id: CardInstanceId): GameState {
  return removeFromNamedPile(state, pi, 'discard', id);
}

function removeFromCardsInPlay(state: GameState, pi: number, id: CardInstanceId): GameState {
  const player = state.players[pi];
  const filtered = player.cardsInPlay.filter(c => c.instanceId !== id);
  if (filtered.length === player.cardsInPlay.length) return state;
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[pi] = { ...player, cardsInPlay: filtered };
  return { ...state, players: newPlayers };
}

function removeFromCharacterItems(
  state: GameState,
  pi: number,
  charId: CardInstanceId,
  itemId: CardInstanceId,
): GameState {
  const player = state.players[pi];
  const char = player.characters[charId as string];
  if (!char) return state;
  const filtered = char.items.filter(i => i.instanceId !== itemId);
  if (filtered.length === char.items.length) return state;
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[pi] = {
    ...player,
    characters: {
      ...player.characters,
      [charId as string]: { ...char, items: filtered },
    },
  };
  return { ...state, players: newPlayers };
}

function removeFromCharacterHazards(
  state: GameState,
  pi: number,
  charId: CardInstanceId,
  hazId: CardInstanceId,
): GameState {
  const player = state.players[pi];
  const char = player.characters[charId as string];
  if (!char) return state;
  const filtered = char.hazards.filter(h => h.instanceId !== hazId);
  if (filtered.length === char.hazards.length) return state;
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[pi] = {
    ...player,
    characters: {
      ...player.characters,
      [charId as string]: { ...char, hazards: filtered },
    },
  };
  return { ...state, players: newPlayers };
}

/* ------------------------------------------------------------------ */
/* Filter evaluation                                                   */
/* ------------------------------------------------------------------ */

function matchesFilter(state: GameState, inst: CardInstance, filter: Condition): boolean {
  const def = state.cardPool[inst.definitionId as string];
  if (!def) return false;
  return matchesCondition(filter, def as unknown as Record<string, unknown>);
}

function stringifyFrom(from: MoveZone | readonly MoveZone[]): string {
  return Array.isArray(from) ? `[${from.join(', ')}]` : (from as MoveZone);
}

export type { LocatedInstance };
