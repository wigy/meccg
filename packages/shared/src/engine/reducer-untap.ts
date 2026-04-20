/**
 * @module reducer-untap
 *
 * Untap phase handlers for the game reducer. Manages untapping of cards,
 * hazard sideboard access, and transition to the organization phase.
 */

import type { GameState, CharacterInPlay, UntapPhaseState, GameAction } from '../index.js';
import { Phase, shuffle, CardStatus, isSiteCard, SiteType, getPlayerIndex, matchesCondition } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import type { ReducerResult } from './reducer-utils.js';
import { clonePlayers } from './reducer-utils.js';
import { enqueueCorruptionCheck } from './pending.js';
import type { OnEventEffect, CardEffect } from '../types/effects.js';


/**
 * Handles the Untap phase. The resource player untaps; the hazard player
 * may access their sideboard. Both pass to advance to Organization.
 */
export function handleUntap(state: GameState, action: GameAction): ReducerResult {
  const untapState = state.phaseState as UntapPhaseState;

  if (action.type === 'start-hazard-sideboard-to-deck' || action.type === 'start-hazard-sideboard-to-discard') {
    const destination = action.type === 'start-hazard-sideboard-to-deck' ? 'deck' : 'discard';
    logDetail(`Untap: hazard player declares sideboard access (${destination})`);
    return {
      state: {
        ...state,
        phaseState: { ...untapState, hazardSideboardDestination: destination, hazardSideboardAccessed: true, hazardPlayerPassed: false },
      },
    };
  }

  if (action.type === 'fetch-hazard-from-sideboard') {
    return handleFetchHazardFromSideboard(state, action);
  }

  if (action.type === 'untap') {
    logDetail(`Untap: resource player ${action.player as string} untaps cards`);
    const untappedState = performUntap(state);
    const newUntapState = { ...untapState, untapped: true };
    if (newUntapState.hazardPlayerPassed) {
      return advanceToOrganization({ ...untappedState, phaseState: newUntapState });
    }
    return { state: { ...untappedState, phaseState: newUntapState } };
  }

  // 'pass' from the hazard player — either exits the sideboard sub-flow
  // or signals the hazard player is done. The resource player never has
  // a legal 'pass' here, so this branch always runs as the hazard player.
  if (untapState.hazardSideboardDestination === 'discard') {
    logDetail(`Hazard sideboard: player ${action.player as string} done fetching to discard (${untapState.hazardSideboardFetched} cards)`);
    const hazardIndex = getPlayerIndex(state, action.player);
    const newPlayers = clonePlayers(state);
    newPlayers[hazardIndex] = { ...newPlayers[hazardIndex], sideboardAccessedDuringUntap: true };
    return {
      state: {
        ...state,
        players: newPlayers,
        phaseState: { ...untapState, hazardSideboardDestination: null },
      },
    };
  }

  logDetail(`Untap: hazard player ${action.player as string} passed`);
  if (untapState.untapped) {
    return advanceToOrganization(state);
  }
  return {
    state: {
      ...state,
      phaseState: { ...untapState, hazardPlayerPassed: true },
    },
  };
}

/** Handle fetch-hazard-from-sideboard during the untap hazard sideboard sub-flow. */
function handleFetchHazardFromSideboard(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'fetch-hazard-from-sideboard') return { state, error: 'Expected fetch-hazard-from-sideboard action' };

  const untapState = state.phaseState as UntapPhaseState;
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.sideboard.findIndex(c => c.instanceId === action.sideboardCardInstanceId);
  const sideboardCard = player.sideboard[cardIdx];
  const def = state.cardPool[sideboardCard.definitionId as string];
  const destination = untapState.hazardSideboardDestination!;

  const newSideboard = [...player.sideboard];
  newSideboard.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  let newRng = state.rng;

  if (destination === 'discard') {
    logDetail(`Hazard sideboard → discard: ${def.name} (${action.sideboardCardInstanceId as string})`);
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      sideboard: newSideboard,
      discardPile: [...player.discardPile, sideboardCard],
    };
  } else {
    logDetail(`Hazard sideboard → play deck: ${def.name} (${action.sideboardCardInstanceId as string}), shuffling`);
    const [shuffledDeck, nextRng] = shuffle([...player.playDeck, sideboardCard], state.rng);
    newRng = nextRng;
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      sideboard: newSideboard,
      playDeck: shuffledDeck,
    };
  }

  // Mark sideboard accessed for hazard limit halving
  newPlayers[playerIndex] = { ...newPlayers[playerIndex], sideboardAccessedDuringUntap: true };

  const newUntapState: UntapPhaseState = {
    ...untapState,
    hazardSideboardFetched: untapState.hazardSideboardFetched + 1,
    // Deck destination: exit sub-flow after 1 card; discard: stay in sub-flow
    hazardSideboardDestination: destination === 'deck' ? null : destination,
  };

  return {
    state: {
      ...state,
      players: newPlayers,
      rng: newRng,
      phaseState: newUntapState,
    },
  };
}

/**
 * Perform the untap mechanics on the active player's cards.
 * Called when entering the untap phase (before any player actions).
 * Untaps all tapped characters, items, allies, and cards in play.
 * Heals wounded characters at havens to tapped position.
 */


/**
 * Perform the untap mechanics on the active player's cards.
 * Called when entering the untap phase (before any player actions).
 * Untaps all tapped characters, items, allies, and cards in play.
 * Heals wounded characters at havens to tapped position.
 */
function performUntap(state: GameState): GameState {
  const playerIndex = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[playerIndex];

  // Build a set of character IDs at havens for healing wounded characters.
  // Also check site-type-override constraints (e.g. The White Tree makes
  // Minas Tirith a haven for healing purposes).
  const charsAtHaven = new Set<string>();
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteDef = state.cardPool[company.currentSite.definitionId];
    if (!siteDef || !isSiteCard(siteDef)) continue;
    let isHaven = siteDef.siteType === SiteType.Haven;
    if (!isHaven) {
      const siteDefId = company.currentSite.definitionId as unknown as string;
      isHaven = state.activeConstraints.some(c => {
        if (c.kind.type !== 'attribute-modifier'
          || c.kind.attribute !== 'site.type'
          || c.kind.op !== 'override'
          || c.kind.value !== SiteType.Haven) return false;
        const filterSiteDefId = (c.kind.filter as { 'site.definitionId'?: string } | undefined)?.['site.definitionId'];
        return filterSiteDefId === siteDefId;
      });
    }
    if (isHaven) {
      for (const charId of company.characters) {
        charsAtHaven.add(charId as string);
      }
    }
  }

  // Untap all tapped characters and their items/allies;
  // heal wounded (inverted) characters at havens to tapped position
  const newCharacters: Record<string, CharacterInPlay> = {};
  let healedCount = 0;
  for (const [key, ch] of Object.entries(player.characters)) {
    const untappedItems = ch.items.map(item =>
      item.status === CardStatus.Tapped ? { ...item, status: CardStatus.Untapped } : item,
    );
    const untappedAllies = ch.allies.map(ally =>
      ally.status === CardStatus.Tapped ? { ...ally, status: CardStatus.Untapped } : ally,
    );
    let newStatus = ch.status;
    if (ch.status === CardStatus.Tapped) {
      newStatus = CardStatus.Untapped;
    } else if (ch.status === CardStatus.Inverted && charsAtHaven.has(key)) {
      newStatus = CardStatus.Tapped;
      healedCount++;
    }
    newCharacters[key] = {
      ...ch,
      status: newStatus,
      items: untappedItems,
      allies: untappedAllies,
    };
  }

  // Untap all tapped cards in play (permanent events, factions, etc.)
  const newCardsInPlay = player.cardsInPlay.map(card =>
    card.status === CardStatus.Tapped ? { ...card, status: CardStatus.Untapped } : card,
  );

  const tappedCharCount = Object.values(player.characters).filter(ch => ch.status === CardStatus.Tapped).length;
  logDetail(`Untap: untapping ${tappedCharCount} character(s), healing ${healedCount} wounded character(s) at havens/healing sites`);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, characters: newCharacters, cardsInPlay: newCardsInPlay };
  return { ...state, players: newPlayers };
}

/**
 * Build the untap phase state.
 * Called from all entry points into the untap phase.
 */


/**
 * Build the untap phase state.
 * Called from all entry points into the untap phase.
 */
export function enterUntapPhase(state: GameState): GameState {
  return {
    ...state,
    phaseState: { phase: Phase.Untap, untapped: false, hazardSideboardDestination: null, hazardSideboardFetched: 0, hazardSideboardAccessed: false, resourcePlayerPassed: false, hazardPlayerPassed: false },
  };
}

/**
 * Advance from the untap phase to the Organization phase.
 * Called when resource player has untapped and hazard player has passed.
 */


/**
 * Advance from the untap phase to the Organization phase.
 * Called when resource player has untapped and hazard player has passed.
 */
function advanceToOrganization(state: GameState): ReducerResult {
  logDetail('Untap: advancing to Organization phase');

  // Trigger `untap-phase-end` on-event effects (Lure of the Senses,
  // The Least of Gold Rings, etc.). Each character of the active
  // player scans its attached hazards/items/allies for matching
  // effects. An optional `when` condition on the effect is evaluated
  // against the bearer context ({ bearer: { siteType, atHaven } });
  // cards that should only fire at a haven (Lure) express that as
  // `when: { "bearer.atHaven": true }` instead of using a dedicated
  // event name. For every match, enqueue a corruption-check
  // resolution scoped to the Organization phase.
  let advanced: GameState = {
    ...state,
    phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null },
  };

  // Only scan the active (resource) player's characters — the card text
  // says "at the end of *his* untap phase", so it fires only when the
  // character's controller's untap phase transitions to organization.
  const activeIndex = state.players.findIndex(p => p.id === state.activePlayer);
  const player = state.players[activeIndex];
  const charSiteType = new Map<string, SiteType | null>();
  for (const company of player.companies) {
    const siteDef = company.currentSite ? state.cardPool[company.currentSite.definitionId] : undefined;
    const siteType = siteDef && isSiteCard(siteDef) ? siteDef.siteType : null;
    for (const charId of company.characters) charSiteType.set(charId as string, siteType);
  }

  for (const [charId, char] of Object.entries(player.characters)) {
    const siteType = charSiteType.get(charId) ?? null;
    const bearerCtx = { bearer: { siteType, atHaven: siteType === SiteType.Haven } };
    // Scan attached hazards, items, allies for matching on-event effects
    const attached = [...char.hazards, ...char.items, ...char.allies];
    for (const card of attached) {
      const def = state.cardPool[card.definitionId as string];
      const effects = (def && 'effects' in def
        ? (def as { effects?: readonly CardEffect[] }).effects
        : undefined) ?? [];
      for (const e of effects) {
        if (e.type !== 'on-event') continue;
        const oe: OnEventEffect = e;
        if (oe.event !== 'untap-phase-end') continue;
        if (oe.apply.type !== 'force-check' || oe.apply.check !== 'corruption') continue;
        if (oe.when && !matchesCondition(oe.when, bearerCtx as unknown as Record<string, unknown>)) {
          logDetail(`Untap-phase-end: skipping ${def?.name ?? '?'} on ${char.instanceId as string} — when condition not met (siteType=${siteType ?? 'none'})`);
          continue;
        }
        const modifier = oe.apply.modifier ?? 0;
        logDetail(`Untap-phase-end: enqueuing corruption check for ${def?.name ?? '?'} on ${char.instanceId as string} (modifier ${modifier})`);
        advanced = enqueueCorruptionCheck(advanced, {
          source: card.instanceId,
          actor: player.id,
          scope: { kind: 'phase', phase: Phase.Organization },
          characterId: char.instanceId,
          modifier,
          reason: def?.name ?? 'Untap-phase-end',
        });
      }
    }
  }

  return { state: advanced };
}

/** Handle actions during the organization phase. */

