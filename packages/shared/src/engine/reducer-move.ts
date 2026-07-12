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

import type { GameState, CardInstance, CardInstanceId, PlayerState, CardInPlay, ItemInPlay } from '../index.js';
import type { MoveEffect, MoveZone, Condition } from '../types/effects.js';
import { CardStatus } from '../types/common.js';
import { characterIds, defById, matchesDefinition, toCardInstance } from './reducer-utils.js';
import { shuffle } from '../rng.js';
import { logDetail } from './legal-actions/log.js';

/**
 * Slot a card entering play attached to a character occupies: resource
 * permanent events go into `items`, hazard permanent events into `hazards`.
 * Shared by the `in-play-on-character` destination so the rule lives in one
 * place (chain-reducer's resolvePermanentEvent uses the same logic until it
 * migrates onto the move primitive).
 */
export function inPlayOnCharacterSlot(cardType: string | undefined): 'items' | 'hazards' {
  return cardType === 'hero-resource-event' || cardType === 'minion-resource-event' ? 'items' : 'hazards';
}

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
  /**
   * The card instance currently resolving on the chain (held on the chain
   * entry, not in any pile). Source for `from: 'chain'` — used when an event
   * "enters play" from the chain: it was removed from hand/on-guard at
   * declaration, so it lives only on the chain entry. Its `remove` is a no-op.
   */
  readonly chainCard?: CardInstance;
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

  // Fail closed: resolve the bearer for in-play-on-character BEFORE removing
  // any source, so a missing bearer leaves state untouched (no card vanishes).
  if (move.to === 'in-play-on-character') {
    const bearerId = ctx.targetCharacterId ?? ctx.targetCardId;
    if (!bearerId || !state.players.some(p => p.characters[bearerId])) {
      return { error: `move: in-play-on-character bearer ${String(bearerId)} not found` };
    }
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
    // The resolving event card is held on the chain entry, not in any pile —
    // source it directly with a no-op removal (it was already removed from
    // hand/on-guard at declaration).
    if (fromZones.includes('chain')) {
      if (!ctx.chainCard) {
        return { error: `move: from=chain requires ctx.chainCard` };
      }
      return { instances: [{ instance: ctx.chainCard, ownerIndex: ctx.sourcePlayerIndex, zone: 'chain', remove: s => s }] };
    }
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
        const def = defById(state, c.instance.definitionId);
        const name = def?.name;
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
    const pushed = pushOne(next, move.to, ownerIndex, card, ctx);
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
    // sideboard — a card in the sideboard may relocate itself into the play
    // deck (Terror Heralds Doom ba-78 and the Balrog sideboard family:
    // "You may bring this card from your sideboard into your play deck").
    const sideboardIdx = player.sideboard.findIndex(c => c.instanceId === sourceId);
    if (sideboardIdx >= 0) {
      const inst = player.sideboard[sideboardIdx];
      return {
        instance: inst,
        ownerIndex: pi,
        zone: 'sideboard',
        remove: s => removeFromNamedPile(s, pi, 'sideboard', sourceId),
      };
    }
    // cardsInPlay
    const cipIdx = player.cardsInPlay.findIndex(c => c.instanceId === sourceId);
    if (cipIdx >= 0) {
      const inst = player.cardsInPlay[cipIdx];
      return {
        instance: toCardInstance(inst),
        ownerIndex: pi,
        zone: 'in-play',
        remove: s => removeFromCardsInPlay(s, pi, sourceId),
      };
    }
    // attached to any character (items or hazards)
    for (const charId of characterIds(player)) {
      const char = player.characters[charId];
      const itemIdx = char.items.findIndex(i => i.instanceId === sourceId);
      if (itemIdx >= 0) {
        const inst = char.items[itemIdx];
        return {
          instance: toCardInstance(inst),
          ownerIndex: pi,
          zone: 'self-location',
          remove: s => removeFromCharacterItems(s, pi, charId, sourceId),
        };
      }
      const hazIdx = char.hazards.findIndex(h => h.instanceId === sourceId);
      if (hazIdx >= 0) {
        const inst = char.hazards[hazIdx];
        // Hazards are owned by the opposing (hazard) player — discards
        // route to their discard pile, not the defending character's.
        return {
          instance: toCardInstance(inst),
          ownerIndex: 1 - pi,
          zone: 'self-location',
          remove: s => removeFromCharacterHazards(s, pi, charId, sourceId),
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
            instance: toCardInstance(inst),
            ownerIndex: pi,
            zone: 'in-play',
            remove: s => removeFromCardsInPlay(s, pi, instanceId),
          };
        }
        // Character-attached hazards and items are also "in play".
        // Hazards route to the opposing (hazard) player's discard; items
        // stay with the character's controller.
        for (const charId of characterIds(player)) {
          const char = player.characters[charId];
          const hazIdx = char.hazards.findIndex(h => h.instanceId === instanceId);
          if (hazIdx >= 0) {
            const inst = char.hazards[hazIdx];
            return {
              instance: toCardInstance(inst),
              ownerIndex: 1 - pi,
              zone: 'in-play',
              remove: s => removeFromCharacterHazards(s, pi, charId, instanceId),
            };
          }
          const itemIdx = char.items.findIndex(i => i.instanceId === instanceId);
          if (itemIdx >= 0) {
            const inst = char.items[itemIdx];
            return {
              instance: toCardInstance(inst),
              ownerIndex: pi,
              zone: 'in-play',
              remove: s => removeFromCharacterItems(s, pi, charId, instanceId),
            };
          }
        }
      }
      return null;
    }
    case 'attached-to-character': {
      // A single instance attached to any character's hazards or allies.
      // Owner is resolved from the instance-id prefix (`<playerId>-<counter>`),
      // falling back to the convention when the prefix doesn't match a player
      // (hazards → the holder's opponent, allies → the holder).
      const prefixOwner = state.players.findIndex(p => (p.id as string) === (instanceId as string).split('-')[0]);
      for (let pi = 0; pi < state.players.length; pi++) {
        const player = state.players[pi];
        for (const charId of characterIds(player)) {
          const char = player.characters[charId];
          const hazIdx = char.hazards.findIndex(h => h.instanceId === instanceId);
          if (hazIdx >= 0) {
            return {
              instance: toCardInstance(char.hazards[hazIdx]),
              ownerIndex: prefixOwner >= 0 ? prefixOwner : 1 - pi,
              zone: 'attached-to-character',
              remove: s => removeFromCharacterHazards(s, pi, charId, instanceId),
            };
          }
          const allyIdx = char.allies.findIndex(a => a.instanceId === instanceId);
          if (allyIdx >= 0) {
            return {
              instance: toCardInstance(char.allies[allyIdx]),
              ownerIndex: prefixOwner >= 0 ? prefixOwner : pi,
              zone: 'attached-to-character',
              remove: s => removeFromCharacterAllies(s, pi, charId, instanceId),
            };
          }
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
          const inst: CardInstance = toCardInstance(cip);
          if (!matches(inst)) continue;
          const id = cip.instanceId;
          out.push({
            instance: inst,
            ownerIndex: pi,
            zone: 'in-play',
            remove: s => removeFromCardsInPlay(s, pi, id),
          });
        }
        for (const charId of characterIds(player)) {
          const char = player.characters[charId];
          for (const haz of char.hazards) {
            const inst: CardInstance = toCardInstance(haz);
            if (!matches(inst)) continue;
            const hazId = haz.instanceId;
            out.push({
              instance: inst,
              ownerIndex: 1 - pi,
              zone: 'in-play',
              remove: s => removeFromCharacterHazards(s, pi, charId, hazId),
            });
          }
          for (const item of char.items) {
            const inst: CardInstance = toCardInstance(item);
            if (!matches(inst)) continue;
            const itemId = item.instanceId;
            out.push({
              instance: inst,
              ownerIndex: pi,
              zone: 'in-play',
              remove: s => removeFromCharacterItems(s, pi, charId, itemId),
            });
          }
        }
      }
      return out;
    }
    case 'items-on-target': {
      // Collect items attached to the target character, excluding the source
      // card itself (so a self-enters-play bounce does not remove the newly
      // played card from the character it was just attached to).
      const targetId = ctx.targetCharacterId;
      if (!targetId) return out;
      for (let pi = 0; pi < state.players.length; pi++) {
        const char = state.players[pi].characters[targetId];
        if (!char) continue;
        for (const item of char.items) {
          if (item.instanceId === ctx.sourceCardId) continue;
          const inst: CardInstance = toCardInstance(item);
          if (!matches(inst)) continue;
          const itemId = item.instanceId;
          out.push({
            instance: inst,
            ownerIndex: pi,
            zone: 'items-on-target',
            remove: s => removeFromCharacterItems(s, pi, targetId, itemId),
          });
        }
        break;
      }
      return out;
    }
    case 'allies-on-target': {
      // Collect allies borne by the target character. Used by "discard his
      // allies" on-play effects (e.g. Flame of Udûn ba-58).
      const targetId = ctx.targetCharacterId;
      if (!targetId) return out;
      for (let pi = 0; pi < state.players.length; pi++) {
        const char = state.players[pi].characters[targetId];
        if (!char) continue;
        for (const ally of char.allies) {
          const inst: CardInstance = toCardInstance(ally);
          if (!matches(inst)) continue;
          const allyId = ally.instanceId;
          out.push({
            instance: inst,
            ownerIndex: pi,
            zone: 'allies-on-target',
            remove: s => removeFromCharacterAllies(s, pi, targetId, allyId),
          });
        }
        break;
      }
      return out;
    }
    default:
      // Contextual locators (items-on-wounded, attached-to-target-company)
      // are added by the phases that need them. Unsupported zones return no
      // candidates.
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
  ctx: MoveContext,
): MoveResult {
  // In-play destinations: the card enters play (not a flat pile), re-wrapped
  // into a CardInPlay/ItemInPlay with default Untapped status.
  if (zone === 'in-play-general') {
    const player = state.players[ownerIndex];
    const inPlay: CardInPlay = { instanceId: card.instanceId, definitionId: card.definitionId, status: CardStatus.Untapped };
    const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
    newPlayers[ownerIndex] = { ...player, cardsInPlay: [...player.cardsInPlay, inPlay] };
    return { state: { ...state, players: newPlayers } };
  }
  if (zone === 'in-play-on-character') {
    // Attach to the bearer's controller (distinct from the move's owner
    // routing); slot chosen by card type. Bearer existence was pre-flighted.
    const bearerId = ctx.targetCharacterId ?? ctx.targetCardId;
    const slot = inPlayOnCharacterSlot(defById(state, card.definitionId)?.cardType);
    const attached: ItemInPlay = { instanceId: card.instanceId, definitionId: card.definitionId, status: CardStatus.Untapped };
    for (let pi = 0; pi < state.players.length; pi++) {
      const charInPlay = bearerId ? state.players[pi].characters[bearerId] : undefined;
      if (charInPlay && bearerId) {
        const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
        newPlayers[pi] = {
          ...newPlayers[pi],
          characters: {
            ...newPlayers[pi].characters,
            [bearerId as string]: { ...charInPlay, [slot]: [...charInPlay[slot], attached] },
          },
        };
        return { state: { ...state, players: newPlayers } };
      }
    }
    return { error: `move: in-play-on-character bearer ${String(bearerId)} not found` };
  }

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
  const char = player.characters[charId];
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
  const char = player.characters[charId];
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

function removeFromCharacterAllies(
  state: GameState,
  pi: number,
  charId: CardInstanceId,
  allyId: CardInstanceId,
): GameState {
  const player = state.players[pi];
  const char = player.characters[charId];
  if (!char) return state;
  const filtered = char.allies.filter(a => a.instanceId !== allyId);
  if (filtered.length === char.allies.length) return state;
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[pi] = {
    ...player,
    characters: {
      ...player.characters,
      [charId as string]: { ...char, allies: filtered },
    },
  };
  return { ...state, players: newPlayers };
}

/* ------------------------------------------------------------------ */
/* Filter evaluation                                                   */
/* ------------------------------------------------------------------ */

function matchesFilter(state: GameState, inst: CardInstance, filter: Condition): boolean {
  const def = defById(state, inst.definitionId);
  if (!def) return false;
  return matchesDefinition(def, filter);
}

function stringifyFrom(from: MoveZone | readonly MoveZone[]): string {
  return Array.isArray(from) ? `[${from.join(', ')}]` : (from as MoveZone);
}

export type { LocatedInstance };

/**
 * Return a card's `move` effect matching the given shape, or null.
 * Helper for legal-action emitters and reducers that used to detect
 * specific per-move effect types (`discard-in-play`, `fetch-to-deck`,
 * …) and now need to match the generalised `move` primitive.
 */
export function findMoveEffectByShape(
  def: { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined,
  select: MoveEffect['select'],
  from: MoveZone,
  to: MoveZone,
): MoveEffect | null {
  for (const e of def?.effects ?? []) {
    if (e.type !== 'move') continue;
    if (e.select !== select) continue;
    const fromMatches = Array.isArray(e.from) ? e.from.includes(from) : e.from === from;
    if (!fromMatches) continue;
    if (e.to !== to) continue;
    return e;
  }
  return null;
}

/**
 * Translate a `move`-shape "fetch into deck or hand" effect into the
 * {@link FetchToDeckEffect} shape used by the pending-effects queue.
 * The move's `from` zones (`'sideboard' | 'discard'`) map to the
 * legacy pile names (`'sideboard' | 'discard-pile'`).
 *
 * Handles both `to: 'deck'` (shuffle into play deck) and `to: 'hand'`
 * (return directly to hand). Returns null for non-fetch move shapes.
 */
export function moveToFetchToDeckPayload(
  move: MoveEffect,
): import('../types/effects.js').FetchToDeckEffect | null {
  if (move.select !== 'target') return null;
  if (move.to !== 'deck' && move.to !== 'hand') return null;
  const fromArr = Array.isArray(move.from) ? move.from : [move.from];
  const source = fromArr.map(z =>
    z === 'discard' ? 'discard-pile' : z === 'sideboard' ? 'sideboard' : null,
  ).filter((s): s is 'sideboard' | 'discard-pile' => s !== null);
  return {
    type: 'fetch-to-deck',
    source,
    filter: move.filter ?? {},
    count: move.count ?? 1,
    shuffle: move.shuffleAfter ?? true,
    to: move.to === 'hand' ? 'hand' : 'deck',
    ...(move.removeFromGame ? { removeFromGame: true } : {}),
  };
}
