/**
 * @module legendary-hoard
 *
 * The `dragon-hoard` effect — Legendary Hoard (td-127):
 *
 *   "Playable on an at home Dragon manifestation. Target Dragon's
 *    automatic-attack cannot be cancelled. Rotate this card 90˚ each time a
 *    manifestation of target Dragon is played. If the site receiving the
 *    Dragon's automatic-attack is untapped, a number of items played there do
 *    not tap the site: not rotated: 1 item; rotated once: 2 items; rotated
 *    twice or more: 3 items. If target Dragon is required to be discarded or
 *    removed from play, invert Dragon on table until this card is discarded.
 *    Discard this card when any item is played at target Dragon's lair that
 *    taps the site. Cannot be duplicated on a given Dragon."
 *
 * A hoard is a resource permanent-event in its controller's `cardsInPlay`
 * whose `attachedTo` names an "<Dragon> at Home" permanent-event — usually in
 * the *opponent's* `cardsInPlay` (the hazard player played it). The pieces:
 *
 * - {@link isAtHomeHoarded} — consulted by `collectAtHomeAttacks`
 *   (`manifestations.ts`) to mark the augmented lair attack
 *   `cannot-be-canceled`.
 * - {@link rotateHoardsOnManifestationPlay} — run by `reduce` after every
 *   successful card play (next to `recordCardPlayed`).
 * - {@link hoardFreeItemAtSite} / {@link applyHoardItemPlay} — the item-play
 *   site-tap override and the "item that taps the lair discards the hoard"
 *   trigger, called from `handleSitePlayHeroResource` (`reducer-site.ts`).
 * - {@link invertHoardedDragons} / {@link releaseInvertedDragons} /
 *   {@link discardOrphanedHoards} — the `postReduce` sweeps implementing the
 *   inversion: a prev/next diff catches the target leaving play by *any* path
 *   (combat defeat, manifestation cascade, ordinary discard) and pulls the
 *   card back from the pile it landed in into the hoard's `invertedDragon`
 *   slot; once the hoard itself leaves play the held card goes on to the
 *   pile it was originally headed for. While held, the card is outside
 *   `cardsInPlay`, so none of its effects (lair augment, hazard-limit grants,
 *   draw/item modifiers, …) apply, and {@link hoardHeldManifestIds} makes
 *   `isManifestationDefeated` treat the Dragon as defeated (g.man.3: the lair
 *   loses its automatic-attack, no further manifestations may be played).
 */

import type {
  CardDefinition,
  CardInPlay,
  CardInstance,
  CardInstanceId,
  DragonHoardEffect,
  GameState,
  PlayerState,
} from '../index.js';
import type { CardDefinitionId, PlayerId } from '../types/common.js';
import { logDetail } from './legal-actions/log.js';
import { defById, getCardEffects, toCardInstance } from './reducer-utils.js';
import { playedCardInstanceId } from './card-play-prohibition.js';
import { resolveInstanceId } from '../types/state.js';

/** The piles a discarded / removed-from-play Dragon may be headed for. */
const HELD_PILES = ['discardPile', 'killPile', 'outOfPlayPile'] as const;
type HeldPile = typeof HELD_PILES[number];

/** The card's `dragon-hoard` effect, if any. */
export function findDragonHoardEffect(def: CardDefinition | undefined): DragonHoardEffect | undefined {
  return getCardEffects(def).find((e): e is DragonHoardEffect => e.type === 'dragon-hoard');
}

/** The `manifestId` chain tag of a card definition (inlined to avoid a cycle with `manifestations.ts`). */
function manifestTag(def: CardDefinition | undefined): string | undefined {
  return (def as { manifestId?: string } | undefined)?.manifestId;
}

/** True when `def` carries a `dragon-at-home` effect (it is an "<Dragon> at Home" card). */
export function isAtHomeDef(def: CardDefinition | undefined): boolean {
  return getCardEffects(def).some(e => e.type === 'dragon-at-home');
}

/** Every in-play hoard (either player), with its holder's index. */
function allHoards(state: GameState): { card: CardInPlay; holderIdx: number; effect: DragonHoardEffect }[] {
  const out: { card: CardInPlay; holderIdx: number; effect: DragonHoardEffect }[] = [];
  state.players.forEach((p, holderIdx) => {
    for (const card of p.cardsInPlay) {
      const effect = findDragonHoardEffect(defById(state, card.definitionId));
      if (effect) out.push({ card, holderIdx, effect });
    }
  });
  return out;
}

/** Definition of the hoard's target Dragon — in play, or held inverted with it. */
function hoardTargetDef(state: GameState, hoard: CardInPlay): CardDefinition | undefined {
  if (hoard.invertedDragon) return defById(state, hoard.invertedDragon.card.definitionId);
  if (hoard.attachedTo === undefined) return undefined;
  for (const p of state.players) {
    const target = p.cardsInPlay.find(c => c.instanceId === hoard.attachedTo);
    if (target) return defById(state, target.definitionId);
  }
  return undefined;
}

/** True when an in-play hoard is attached to the in-play at-home card `atHomeInstanceId`. */
export function isAtHomeHoarded(state: GameState, atHomeInstanceId: CardInstanceId): boolean {
  return allHoards(state).some(h => h.card.attachedTo === atHomeInstanceId && !h.card.invertedDragon);
}

/** True when some in-play hoard is attached to `targetInstanceId` (the "cannot be duplicated on a given Dragon" check). */
export function hoardAttachedTo(state: GameState, targetInstanceId: CardInstanceId): boolean {
  return allHoards(state).some(h => h.card.attachedTo === targetInstanceId);
}

/**
 * Chain tags (`manifestId`) of every Dragon currently held inverted under a
 * hoard. Such a Dragon is out of play for every purpose but the hoard's own,
 * so `isManifestationDefeated` / `applyManifestationCascade` treat its chain
 * as defeated.
 */
export function hoardHeldManifestIds(state: GameState): ReadonlySet<string> {
  const out = new Set<string>();
  for (const h of allHoards(state)) {
    if (!h.card.invertedDragon) continue;
    const m = manifestTag(defById(state, h.card.invertedDragon.card.definitionId));
    if (m) out.add(m);
  }
  return out;
}

/** Number of items per turn the hoard lets be played at the lair without tapping it. */
export function hoardFreeItemLimit(hoard: CardInPlay, effect: DragonHoardEffect): number {
  const table = effect.freeItemsByRotation;
  if (table.length === 0) return 0;
  return table[Math.min(hoard.rotations ?? 0, table.length - 1)];
}

/** Hoards whose target Dragon's lair is `siteDef` (matched by `lairOf`, so every version of the lair). */
function hoardsForLair(state: GameState, siteDefId: CardDefinitionId): { card: CardInPlay; holderIdx: number; effect: DragonHoardEffect }[] {
  const siteDef = defById(state, siteDefId) as { lairOf?: string } | undefined;
  const lairOf = siteDef?.lairOf;
  if (!lairOf) return [];
  return allHoards(state).filter(h => manifestTag(hoardTargetDef(state, h.card)) === lairOf);
}

/**
 * The hoard (instance id) that lets an item played now at `siteDefId` leave
 * the site untapped, or `undefined`. Requires the site to be untapped
 * (caller passes `siteUntapped`) and the hoard's per-turn allowance
 * (`hoardFreeItems`, reset each turn) not yet used up.
 */
export function hoardFreeItemAtSite(
  state: GameState,
  siteDefId: CardDefinitionId,
  siteUntapped: boolean,
): CardInstanceId | undefined {
  if (!siteUntapped) return undefined;
  for (const h of hoardsForLair(state, siteDefId)) {
    const limit = hoardFreeItemLimit(h.card, h.effect);
    const used = h.card.hoardFreeItems?.turnNumber === state.turnNumber ? h.card.hoardFreeItems.count : 0;
    const name = defById(state, h.card.definitionId)?.name ?? '?';
    if (used < limit) {
      logDetail(`${name}: item at the hoarded lair does not tap the site (${used + 1}/${limit} this turn, rotations ${h.card.rotations ?? 0})`);
      return h.card.instanceId;
    }
    logDetail(`${name}: free-item allowance at the lair used up (${used}/${limit} this turn)`);
  }
  return undefined;
}

/**
 * Post-item-play bookkeeping at a site: count the item against the hoard that
 * kept the site untapped (`freeHoardId`), or — when the item tapped the site
 * (`tappedSite`) — discard every hoard whose target Dragon's lair it is
 * ("Discard this card when any item is played at target Dragon's lair that
 * taps the site").
 */
export function applyHoardItemPlay(
  state: GameState,
  siteDefId: CardDefinitionId,
  freeHoardId: CardInstanceId | undefined,
  tappedSite: boolean,
): GameState {
  if (freeHoardId) {
    return mapHoard(state, freeHoardId, h => {
      const used = h.hoardFreeItems?.turnNumber === state.turnNumber ? h.hoardFreeItems.count : 0;
      return { ...h, hoardFreeItems: { turnNumber: state.turnNumber, count: used + 1 } };
    });
  }
  if (!tappedSite) return state;
  let next = state;
  for (const h of hoardsForLair(state, siteDefId)) {
    logDetail(`${defById(state, h.card.definitionId)?.name ?? '?'}: an item played at the lair tapped the site — discarding the hoard`);
    next = discardHoard(next, h.card.instanceId);
  }
  return next;
}

/** Apply `fn` to the in-play hoard `hoardId`, wherever it lives. */
function mapHoard(state: GameState, hoardId: CardInstanceId, fn: (c: CardInPlay) => CardInPlay): GameState {
  const players = state.players.map(p => (p.cardsInPlay.some(c => c.instanceId === hoardId)
    ? { ...p, cardsInPlay: p.cardsInPlay.map(c => (c.instanceId === hoardId ? fn(c) : c)) }
    : p)) as unknown as GameState['players'];
  return { ...state, players };
}

/**
 * Move the hoard to its holder's discard pile. A Dragon held inverted with it
 * goes on to the pile it was headed for (see {@link releaseInvertedDragons},
 * which performs the same release for hoards leaving play by other paths).
 */
function discardHoard(state: GameState, hoardId: CardInstanceId): GameState {
  const holderIdx = state.players.findIndex(p => p.cardsInPlay.some(c => c.instanceId === hoardId));
  if (holderIdx < 0) return state;
  const hoard = state.players[holderIdx].cardsInPlay.find(c => c.instanceId === hoardId)!;
  let players = state.players.map((p, i) => (i === holderIdx
    ? { ...p, cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== hoardId), discardPile: [...p.discardPile, toCardInstance(hoard)] }
    : p));
  if (hoard.invertedDragon) players = pushToPile(players, hoard.invertedDragon.card, hoard.invertedDragon.pile, hoard.invertedDragon.pileOwner, state);
  return {
    ...state,
    players: players as unknown as GameState['players'],
    activeConstraints: state.activeConstraints.filter(c => c.source !== hoardId),
  };
}

/** Append `card` to `pile` of the player `owner`. */
function pushToPile(
  players: readonly PlayerState[],
  card: CardInstance,
  pile: HeldPile,
  owner: PlayerId,
  state: GameState,
): PlayerState[] {
  logDetail(`Legendary Hoard left play: inverted Dragon ${defById(state, card.definitionId)?.name ?? (card.definitionId as string)} goes to ${owner as string}'s ${pile}`);
  return players.map(p => (p.id === owner ? { ...p, [pile]: [...p[pile], card] } : p));
}

/**
 * Rotate every hoard whose target Dragon is the same entity as the card the
 * just-applied action played ("Rotate this card 90˚ each time a manifestation
 * of target Dragon is played"). `before` resolves the played card (still in
 * hand there); `after` is the post-action state.
 */
export function rotateHoardsOnManifestationPlay(before: GameState, after: GameState, action: { readonly type: string }): GameState {
  const instId = playedCardInstanceId(action);
  if (instId === undefined) return after;
  const defId = resolveInstanceId(before, instId);
  const playedDef = defId ? defById(before, defId) : undefined;
  if (!playedDef) return after;
  const playedTag = manifestTag(playedDef) ?? (playedDef.id as string);
  let next = after;
  for (const h of allHoards(after)) {
    const target = hoardTargetDef(after, h.card);
    const targetTag = manifestTag(target);
    if (!targetTag || targetTag !== playedTag) continue;
    const rotations = (h.card.rotations ?? 0) + 1;
    logDetail(`${defById(after, h.card.definitionId)?.name ?? '?'}: a manifestation of ${target?.name ?? targetTag} (${playedDef.name}) was played — rotated to ${rotations}×90°`);
    next = mapHoard(next, h.card.instanceId, c => ({ ...c, rotations }));
  }
  return next;
}

/** Find `instanceId` in any player's discard / kill / out-of-play pile. */
function findInPiles(state: GameState, instanceId: CardInstanceId): { playerIdx: number; pile: HeldPile } | undefined {
  for (let playerIdx = 0; playerIdx < state.players.length; playerIdx++) {
    for (const pile of HELD_PILES) {
      if (state.players[playerIdx][pile].some(c => c.instanceId === instanceId)) return { playerIdx, pile };
    }
  }
  return undefined;
}

/** True when `instanceId` sits in some player's `cardsInPlay`. */
function inPlay(state: GameState, instanceId: CardInstanceId): boolean {
  return state.players.some(p => p.cardsInPlay.some(c => c.instanceId === instanceId));
}

/**
 * `postReduce` sweep — "If target Dragon is required to be discarded or
 * removed from play, invert Dragon on table until this card is discarded."
 * For every hoard still in play whose target was in play in `prev` but has
 * just landed in a discard / kill / out-of-play pile (by any path), pull the
 * card back out and hold it inverted with the hoard, remembering where it was
 * headed.
 */
export function invertHoardedDragons(prev: GameState, next: GameState): GameState {
  let state = next;
  for (const h of allHoards(next)) {
    const targetId = h.card.attachedTo;
    if (targetId === undefined || h.card.invertedDragon) continue;
    if (!inPlay(prev, targetId) || inPlay(next, targetId)) continue;
    const loc = findInPiles(state, targetId);
    if (!loc) continue;
    const pileOwner = state.players[loc.playerIdx];
    const card = pileOwner[loc.pile].find(c => c.instanceId === targetId)!;
    logDetail(`${defById(state, h.card.definitionId)?.name ?? '?'}: target Dragon ${defById(state, card.definitionId)?.name ?? '?'} would go to ${pileOwner.id as string}'s ${loc.pile} — inverted on the table with the hoard instead`);
    const players = state.players.map((p, i) => (i === loc.playerIdx
      ? { ...p, [loc.pile]: p[loc.pile].filter(c => c.instanceId !== targetId) }
      : p)) as unknown as GameState['players'];
    state = mapHoard({ ...state, players }, h.card.instanceId, c => ({
      ...c,
      invertedDragon: { card: toCardInstance(card), pile: loc.pile, pileOwner: pileOwner.id },
    }));
  }
  return state;
}

/**
 * `postReduce` sweep — a hoard whose target is neither in play nor held by
 * it (e.g. returned to hand, or the hoard resolved after its target left)
 * has nothing to be played on: discard it.
 */
export function discardOrphanedHoards(state: GameState): GameState {
  let next = state;
  for (const h of allHoards(state)) {
    if (h.card.invertedDragon || h.card.attachedTo === undefined) continue;
    if (inPlay(state, h.card.attachedTo)) continue;
    logDetail(`${defById(state, h.card.definitionId)?.name ?? '?'}: target ${h.card.attachedTo as string} left play — discarding the hoard`);
    next = discardHoard(next, h.card.instanceId);
  }
  return next;
}

/**
 * `postReduce` safety net — a hoard holding an inverted Dragon that left play
 * through a path unaware of `invertedDragon` (any generic discard of the
 * hoard) would otherwise take the held card with it. For each such hoard seen
 * in any of `sources` but no longer in play in `next`, send the held Dragon to
 * the pile it was headed for (unless it is already reachable in `next`).
 */
export function releaseInvertedDragons(sources: readonly GameState[], next: GameState): GameState {
  let players: PlayerState[] = [...next.players];
  const released = new Set<string>();
  for (const src of sources) {
    for (const h of allHoards(src)) {
      const held = h.card.invertedDragon;
      if (!held || released.has(held.card.instanceId as string)) continue;
      if (inPlay(next, h.card.instanceId)) continue;
      if (resolveInstanceId({ ...next, players: players as unknown as GameState['players'] }, held.card.instanceId) !== undefined) continue;
      released.add(held.card.instanceId as string);
      players = pushToPile(players, held.card, held.pile, held.pileOwner, next);
    }
  }
  if (released.size === 0) return next;
  return { ...next, players: players as unknown as GameState['players'] };
}
