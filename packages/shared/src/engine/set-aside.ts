/**
 * @module engine/set-aside
 *
 * MEAS §1 — "Placement of cards off to the side".
 *
 * Certain cards/effects place other cards "off to the side" and keep them with
 * a host permanent-event (e.g. *Sack Over the Head*, *Summons from Long Sleep*,
 * *Sacrifice of Form*). Such cards:
 *
 * - are kept with the host (the host's `cardsInPlay` entry lists them in
 *   `setAside`; each child is stamped with `setAsideHost`);
 * - remain reachable in state — no card instance disappears (see the package
 *   invariant) — so they stay registered in the host player's `cardsInPlay`;
 * - count as "in play" for uniqueness (`countCopiesInPlay` walks `cardsInPlay`);
 * - cannot be targeted except by cards whose `play-target` declares
 *   `targetsSetAside` (see {@link isSetAsideCard});
 * - are discarded to their **owner** when the host leaves play, unless the host
 *   stated otherwise (`setAsideKeepOnRemoval`);
 * - award their marshalling points to their **owner** (handled in
 *   `recompute-derived.ts`).
 *
 * This module owns the placement helpers and the host-removal sweep. Wiring a
 * specific host card to set a particular target aside is card-certification
 * work and lives with that card; the mechanics here are alignment-agnostic.
 */

import type { GameState, CardInstance, CardInstanceId, CardInPlay, PlayerState, CardDefinition, CardEffect } from '../index.js';
import { CardStatus } from '../types/common.js';
import { isSiteCard } from '../types/cards.js';
import { ownerOf } from '../types/state.js';
import { logDetail } from './legal-actions/log.js';
import { toCardInstance } from './reducer-utils.js';

/** True when this in-play card has itself been placed "off to the side". */
export function isSetAsideCard(card: CardInPlay): boolean {
  return card.setAsideHost !== undefined;
}

/**
 * True when the card definition *specifically affects cards off to the side* —
 * i.e. it carries a `play-target` effect with `targetsSetAside: true`. Only such
 * cards may reach set-aside cards in target collectors (MEAS §1); every other
 * card treats set-aside cards as untargetable.
 */
export function cardTargetsSetAside(def: CardDefinition | undefined): boolean {
  if (!def || !('effects' in def)) return false;
  const effects = (def as { effects?: readonly CardEffect[] }).effects;
  return !!effects?.some(e => e.type === 'play-target' && e.targetsSetAside === true);
}

/** Locate the player index whose `cardsInPlay` holds the given host instance. */
function hostPlayerIndex(state: GameState, hostInstanceId: CardInstanceId): number {
  return state.players.findIndex(p =>
    p.cardsInPlay.some(c => c.instanceId === hostInstanceId),
  );
}

/**
 * Low-level placement: register `child` as a set-aside card kept with the host
 * permanent-event `hostInstanceId`. The child becomes an untapped `CardInPlay`
 * entry in the **host player's** `cardsInPlay` (so it is in play for
 * uniqueness) carrying `setAsideHost`, and is appended to the host's `setAside`
 * list. The caller is responsible for having removed `child` from its prior
 * location — this helper only performs the registration so that callers minting
 * a card (from hand, deck, …) or relocating one share one disposition point.
 */
export function placeCardSetAside(
  state: GameState,
  hostInstanceId: CardInstanceId,
  child: CardInstance,
  keepOnHostRemoval = false,
  noMp = false,
): GameState {
  const hostIdx = hostPlayerIndex(state, hostInstanceId);
  if (hostIdx === -1) {
    logDetail(`placeCardSetAside: host ${hostInstanceId as string} not found in any cardsInPlay — no-op`);
    return state;
  }

  const newPlayers = state.players.map((p, idx) => {
    if (idx !== hostIdx) return p;
    const cardsInPlay: CardInPlay[] = p.cardsInPlay.map(c =>
      c.instanceId === hostInstanceId
        ? { ...c, setAside: [...(c.setAside ?? []), child.instanceId] }
        : c,
    );
    cardsInPlay.push({
      instanceId: child.instanceId,
      definitionId: child.definitionId,
      status: CardStatus.Untapped,
      setAsideHost: hostInstanceId,
      ...(keepOnHostRemoval ? { setAsideKeepOnRemoval: true } : {}),
      ...(noMp ? { setAsideNoMp: true } : {}),
    });
    return { ...p, cardsInPlay };
  }) as [PlayerState, PlayerState];

  logDetail(`Set aside ${child.instanceId as string} with host ${hostInstanceId as string}${keepOnHostRemoval ? ' (kept on host removal)' : ''}${noMp ? ' (no marshalling points)' : ''}`);
  return { ...state, players: newPlayers };
}

/**
 * Reverse of {@link placeCardSetAside}: pulls `childInstanceId` out of
 * whichever player's `cardsInPlay` holds it and off its host's `setAside`
 * list. Used when a set-aside card is played directly out of its slot rather
 * than being disposed of by {@link sweepSetAside} (e.g. Great Secrets Buried
 * There dm-63: the deck owner plays the set-aside item "as though it were in
 * his hand"). No-op (with a log line) if the instance is not currently
 * set aside — callers that already validated the source need not guard.
 */
export function removeItemFromSetAside(state: GameState, childInstanceId: CardInstanceId): GameState {
  const holderIdx = state.players.findIndex(p =>
    p.cardsInPlay.some(c => c.instanceId === childInstanceId && isSetAsideCard(c)),
  );
  if (holderIdx === -1) {
    logDetail(`removeItemFromSetAside: ${childInstanceId as string} is not currently set aside — no-op`);
    return state;
  }
  const child = state.players[holderIdx].cardsInPlay.find(c => c.instanceId === childInstanceId)!;
  const hostInstanceId = child.setAsideHost!;

  const newPlayers = state.players.map((p, idx) => {
    if (idx !== holderIdx) return p;
    const cardsInPlay: CardInPlay[] = p.cardsInPlay
      .filter(c => c.instanceId !== childInstanceId)
      .map(c => {
        if (c.instanceId !== hostInstanceId || !c.setAside) return c;
        const pruned = c.setAside.filter(id => id !== childInstanceId);
        if (pruned.length > 0) return { ...c, setAside: pruned };
        const { setAside: _s, ...rest } = c;
        void _s;
        return rest;
      });
    return { ...p, cardsInPlay };
  }) as [PlayerState, PlayerState];

  logDetail(`Played set-aside card ${childInstanceId as string} out of its slot with host ${hostInstanceId as string}`);
  return { ...state, players: newPlayers };
}

/**
 * Place a company character "off to the side" with a host permanent-event —
 * the *Sack Over the Head* shape: the character leaves its owner's company and
 * `characters` map, and the character card (plus any items and allies it
 * carried, which travel with it) is registered as set-aside cards kept with the
 * host. Hazards attached to the character are returned to their owners' discard
 * piles (they no longer have a host character). No instance is dropped.
 *
 * The character must not currently control followers (callers should unfollow
 * first); followers are left untouched and would otherwise be orphaned.
 */
export function setAsideCompanyCharacter(
  state: GameState,
  hostInstanceId: CardInstanceId,
  characterInstanceId: CardInstanceId,
  keepOnHostRemoval = false,
): GameState {
  const ownerIdx = state.players.findIndex(p => p.characters[characterInstanceId] !== undefined);
  if (ownerIdx === -1) {
    logDetail(`setAsideCompanyCharacter: character ${characterInstanceId as string} not in play — no-op`);
    return state;
  }

  const owner = state.players[ownerIdx];
  const char = owner.characters[characterInstanceId];

  // Cards that go off to the side with the character: the character itself plus
  // its borne items and allies.
  const accompanying: CardInstance[] = [
    { instanceId: char.instanceId, definitionId: char.definitionId },
    ...char.items.map(toCardInstance),
    ...char.allies.map(toCardInstance),
  ];

  // Detach the character from its owner's characters map and company.
  const newCharacters = { ...owner.characters };
  delete newCharacters[characterInstanceId];
  const newCompanies = owner.companies.map(c => ({
    ...c,
    characters: c.characters.filter(id => id !== characterInstanceId),
  }));

  // Route attached hazards back to their owners' discard piles.
  let working: GameState = {
    ...state,
    players: state.players.map((p, idx) =>
      idx === ownerIdx ? { ...p, characters: newCharacters, companies: newCompanies } : p,
    ) as [PlayerState, PlayerState],
  };
  for (const hazard of char.hazards) {
    const hazOwner = ownerOf(hazard.instanceId);
    working = {
      ...working,
      players: working.players.map(p =>
        p.id === hazOwner
          ? { ...p, discardPile: [...p.discardPile, toCardInstance(hazard)] }
          : p,
      ) as [PlayerState, PlayerState],
    };
    logDetail(`setAsideCompanyCharacter: hazard ${hazard.instanceId as string} → ${hazOwner as string} discard`);
  }

  // Register each accompanying card off to the side with the host.
  for (const card of accompanying) {
    working = placeCardSetAside(working, hostInstanceId, card, keepOnHostRemoval);
  }
  return working;
}

/**
 * Host-removal sweep (called from `postReduce`). For every set-aside child
 * whose host is no longer present as a live (non-set-aside) card in any
 * player's `cardsInPlay`, dispose of the child:
 *
 * - default: route the child to its **owner's** discard pile;
 * - when the child carries `setAsideKeepOnRemoval` (the host said otherwise):
 *   the child stays in play but is detached — its `setAsideHost` /
 *   `setAsideKeepOnRemoval` flags are cleared so it becomes an ordinary in-play
 *   card. (It remains in the host player's `cardsInPlay`.)
 *
 * Also prunes stale ids from any surviving host's `setAside` list. This is the
 * single load-bearing disposition point: a host-removal path that forgets a
 * child surfaces here as an orphan rather than a silently dropped instance.
 */
export function sweepSetAside(state: GameState): GameState {
  // Instance ids of all live (non-set-aside) cards in play across both players.
  const liveHosts = new Set<string>();
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      if (!isSetAsideCard(c)) liveHosts.add(c.instanceId as string);
    }
  }

  let changed = false;
  const discardsByPlayer = new Map<string, CardInstance[]>();
  const siteReturnsByPlayer = new Map<string, CardInstance[]>();
  const newPlayers = state.players.map(p => {
    const keep: CardInPlay[] = [];
    let playerChanged = false;
    for (const card of p.cardsInPlay) {
      const host = card.setAsideHost;
      if (host === undefined || liveHosts.has(host as string)) {
        keep.push(card);
        continue;
      }
      // Host has left play — dispose of the orphaned child.
      changed = true;
      playerChanged = true;
      if (card.setAsideKeepOnRemoval) {
        // Host said otherwise: detach and keep in play as an ordinary card.
        const { setAsideHost: _h, setAsideKeepOnRemoval: _k, ...rest } = card;
        void _h; void _k;
        keep.push(rest);
        logDetail(`sweepSetAside: host ${host as string} gone — ${card.instanceId as string} kept in play (host override)`);
      } else if (isSiteCard(state.cardPool[card.definitionId])) {
        // A set-aside SITE card (Long Grievous Siege ba-40's besieged
        // Border-hold) is never discarded — site cards return to their
        // owner's location deck.
        const owner = ownerOf(card.instanceId) as string;
        const list = siteReturnsByPlayer.get(owner) ?? [];
        list.push(toCardInstance(card));
        siteReturnsByPlayer.set(owner, list);
        logDetail(`sweepSetAside: host ${host as string} gone — returning site ${card.instanceId as string} to owner ${owner}'s location deck`);
      } else {
        const owner = ownerOf(card.instanceId) as string;
        const list = discardsByPlayer.get(owner) ?? [];
        list.push(toCardInstance(card));
        discardsByPlayer.set(owner, list);
        logDetail(`sweepSetAside: host ${host as string} gone — discarding ${card.instanceId as string} to owner ${owner}`);
      }
    }
    return playerChanged ? { ...p, cardsInPlay: keep } : p;
  });

  if (!changed) return state;

  // Prune dangling ids from surviving hosts' setAside lists and apply discards.
  const remainingChildIds = new Set<string>();
  for (const p of newPlayers) {
    for (const c of p.cardsInPlay) {
      if (isSetAsideCard(c)) remainingChildIds.add(c.instanceId as string);
    }
  }

  const finalPlayers = newPlayers.map((p): PlayerState => {
    const cardsInPlay: CardInPlay[] = p.cardsInPlay.map(c => {
      if (!c.setAside) return c;
      const pruned = c.setAside.filter(id => remainingChildIds.has(id as string));
      if (pruned.length > 0) return { ...c, setAside: pruned };
      const { setAside: _s, ...rest } = c;
      void _s;
      return rest;
    });
    const discards = discardsByPlayer.get(p.id as string);
    const siteReturns = siteReturnsByPlayer.get(p.id as string);
    return {
      ...p,
      cardsInPlay,
      ...(discards ? { discardPile: [...p.discardPile, ...discards] } : {}),
      ...(siteReturns ? { siteDeck: [...p.siteDeck, ...siteReturns] } : {}),
    };
  }) as [PlayerState, PlayerState];

  return { ...state, players: finalPlayers };
}
