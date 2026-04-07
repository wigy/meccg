/**
 * @module reducer-events
 *
 * Event card handlers for the game reducer. Covers playing permanent events,
 * short events, long events, and resource short events. These handlers are
 * shared across multiple phases (organization, long-event, movement/hazard).
 */

import type { GameState, CardInstance, ChainEntryPayload, PendingEffect, GameAction } from '../index.js';
import { Phase, CardStatus, getPlayerIndex, BASE_MAX_REGION_DISTANCE } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { initiateChain, pushChainEntry } from './chain-reducer.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { clonePlayers } from './reducer-utils.js';


/**
 * Handle playing a permanent-event resource card.
 * Removes the card from hand, places it on the chain, and initiates/pushes
 * a chain of effects. The card enters play upon resolution (see chain-reducer).
 */
export function handlePlayPermanentEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-permanent-event') return { state, error: 'Expected play-permanent-event action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
  if (!def || def.cardType !== 'hero-resource-event' || def.eventType !== 'permanent') {
    return { state, error: 'Card is not a permanent resource event' };
  }

  // Check duplication-limit with scope "game"
  if (def.effects) {
    for (const effect of def.effects) {
      if (effect.type !== 'duplication-limit' || effect.scope !== 'game') continue;
      const copiesInPlay = state.players.reduce((count, p) =>
        count + p.cardsInPlay.filter(c => {
          const cDef = state.cardPool[c.definitionId as string];
          return cDef && cDef.name === def.name;
        }).length, 0,
      );
      if (copiesInPlay >= effect.max) {
        return { state, error: `${def.name} cannot be duplicated` };
      }
    }
  }

  logDetail(`Playing permanent event: ${def.name} → enters chain`);

  // Remove card from hand — it now resides on the chain
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, hand: newHand };
  let newState: GameState = { ...state, players: newPlayers };

  // Initiate or push onto chain — card enters play upon resolution
  if (newState.chain === null) {
    newState = initiateChain(newState, action.player, handCard, { type: 'permanent-event' });
  } else {
    newState = pushChainEntry(newState, action.player, handCard, { type: 'permanent-event' });
  }

  return { state: newState };
}

/**
 * Handle playing a short-event as a resource (e.g. Twilight).
 * Moves the short event from hand to discard and initiates (or pushes onto)
 * a chain of effects. The target environment remains in play until the chain
 * entry resolves — giving both players a chance to respond.
 */


/**
 * Handle playing a short-event as a resource (e.g. Twilight).
 * Moves the short event from hand to discard and initiates (or pushes onto)
 * a chain of effects. The target environment remains in play until the chain
 * entry resolves — giving both players a chance to respond.
 */
export function handlePlayShortEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-short-event') return { state, error: 'Expected play-short-event action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
  if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'short') {
    return { state, error: 'Card is not a hazard short-event' };
  }

  if (!action.targetInstanceId) {
    return { state, error: 'Target environment required for hazard short-event' };
  }

  // Validate target exists (in cardsInPlay or the current chain)
  const targetInCards = state.players.some(p =>
    p.cardsInPlay.some(c => c.instanceId === action.targetInstanceId),
  );
  const targetInChain = state.chain?.entries.some(
    e => e.card?.instanceId === action.targetInstanceId && !e.resolved && !e.negated,
  ) ?? false;
  if (!targetInCards && !targetInChain) {
    return { state, error: 'Target environment not in play or on chain' };
  }

  const targetDefId = resolveInstanceId(state, action.targetInstanceId);
  const targetDef = targetDefId ? state.cardPool[targetDefId as string] : undefined;
  logDetail(`Playing short event ${def.name}: targeting environment ${targetDef?.name ?? action.targetInstanceId} (chain will resolve the cancel)`);

  // Move short event from hand → discard
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    hand: newHand,
    discardPile: [...player.discardPile, handCard],
  };

  let newState: GameState = { ...state, players: newPlayers };

  // Initiate chain or push onto existing chain — target stored in payload
  const payload: ChainEntryPayload = { type: 'short-event', targetInstanceId: action.targetInstanceId };
  if (newState.chain === null) {
    newState = initiateChain(newState, action.player, handCard, payload);
  } else {
    newState = pushChainEntry(newState, action.player, handCard, payload);
  }

  return { state: newState };
}

/**
 * Handle actions during the long-event phase.
 *
 * The resource player may play resource long-events and short-events from
 * hand. On pass, the hazard player's hazard long-events are discarded and
 * the phase advances. Resource short events with fetch-to-deck effects
 * enter a sub-flow for card selection.
 */


/**
 * Handle actions during the long-event phase.
 *
 * The resource player may play resource long-events and short-events from
 * hand. On pass, the hazard player's hazard long-events are discarded and
 * the phase advances. Resource short events with fetch-to-deck effects
 * enter a sub-flow for card selection.
 */
export function handleLongEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type === 'play-long-event') {
    return handlePlayLongEvent(state, action);
  }
  if (action.type === 'play-short-event') {
    return handlePlayResourceShortEvent(state, action);
  }
  if (action.type === 'pass') {
    // [2.III.3] At end of long-event phase: hazard player discards own hazard long-events
    const activePlayer = state.activePlayer!;
    const hazardPlayerIndex = (getPlayerIndex(state, activePlayer) + 1) % state.players.length;
    const hazardPlayer = state.players[hazardPlayerIndex];
    const discardedEvents: CardInstance[] = [];
    const remainingCards = hazardPlayer.cardsInPlay.filter(card => {
      const def = state.cardPool[card.definitionId as string];
      if (def && def.cardType === 'hazard-event' && def.eventType === 'long') {
        logDetail(`Long-event exit: discarding hazard long-event "${def.name}" (${card.instanceId as string})`);
        discardedEvents.push({ instanceId: card.instanceId, definitionId: card.definitionId });
        return false;
      }
      return true;
    });

    const newPlayers = clonePlayers(state);
    newPlayers[hazardPlayerIndex] = {
      ...newPlayers[hazardPlayerIndex],
      cardsInPlay: remainingCards,
      discardPile: [...newPlayers[hazardPlayerIndex].discardPile, ...discardedEvents],
    };

    // Reset moved flags on the active player's companies for the new M/H phase
    const activeIndex = getPlayerIndex(state, activePlayer);
    newPlayers[activeIndex] = {
      ...newPlayers[activeIndex],
      companies: newPlayers[activeIndex].companies.map(c => ({ ...c, moved: false })),
    };

    logDetail(`Long-event: active player ${action.player as string} passed → advancing to Movement/Hazard phase`);
    return {
      state: {
        ...state,
        players: newPlayers,
        phaseState: {
          phase: Phase.MovementHazard,
          step: 'select-company',
          activeCompanyIndex: 0,
          handledCompanyIds: [],
          movementType: null,
          declaredRegionPath: [],
          maxRegionDistance: BASE_MAX_REGION_DISTANCE,
          pendingEffectsToOrder: [],
          hazardsPlayedThisCompany: 0,
          hazardLimit: 0,
          resolvedSitePath: [],
          resolvedSitePathNames: [],
          destinationSiteType: null,
          destinationSiteName: null,
          resourceDrawMax: 0,
          hazardDrawMax: 0,
          resourceDrawCount: 0,
          hazardDrawCount: 0,
          resourcePlayerPassed: false,
          hazardPlayerPassed: false,
          siteRevealed: false,
          onGuardPlacedThisCompany: false,
          returnedToOrigin: false,
          pendingWoundCorruptionChecks: [],
        },
      },
    };
  }
  return { state, error: `Unexpected action '${action.type}' in long-event phase` };
}

/**
 * Handle playing a resource short-event card during the long-event phase.
 *
 * Removes the card from hand, discards it, and if it has a `fetch-to-deck`
 * effect, sets up the pendingFetch sub-flow on the phase state.
 */


/**
 * Handle playing a resource short-event card during the long-event phase.
 *
 * Removes the card from hand, discards it, and if it has a `fetch-to-deck`
 * effect, sets up the pendingFetch sub-flow on the phase state.
 */
export function handlePlayResourceShortEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-short-event') return { state, error: 'Expected play-short-event action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
  if (!def || def.cardType !== 'hero-resource-event' || def.eventType !== 'short') {
    return { state, error: 'Card is not a resource short-event' };
  }

  logDetail(`Playing resource short-event: ${def.name} (${action.cardInstanceId as string})`);

  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  // Collect all effects that require player interaction to resolve
  const interactiveEffects: PendingEffect[] = (def.effects ?? [])
    .filter(e => e.type === 'fetch-to-deck')
    .map(effect => ({ type: 'card-effect' as const, cardInstanceId: handCard.instanceId, effect }));

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, hand: newHand };

  if (interactiveEffects.length > 0) {
    // Card goes to player's cardsInPlay (visible on table) while effects resolve
    logDetail(`${def.name} → cardsInPlay, resolving ${interactiveEffects.length} effect(s)`);
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      cardsInPlay: [...newPlayers[playerIndex].cardsInPlay, { instanceId: handCard.instanceId, definitionId: handCard.definitionId, status: CardStatus.Untapped }],
    };
    return {
      state: {
        ...state,
        players: newPlayers,
        pendingEffects: [...state.pendingEffects, ...interactiveEffects],
      },
    };
  }

  // No interactive effects: discard immediately
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    discardPile: [...newPlayers[playerIndex].discardPile, handCard],
  };
  return { state: { ...state, players: newPlayers } };
}

/**
 * Handle fetching a card from sideboard or discard pile into the play deck.
 *
 * Part of the fetch-to-deck effect resolution. The current effect is the
 * first entry in {@link GameState.pendingEffects}. After the fetch,
 * the effect is consumed; if no more effects remain, the event card moves
 * from cardsInPlay to the player's discard pile.
 */


/**
 * Handle playing a resource long-event card during the long-event phase.
 * Removes the card from hand, places it on the chain, and initiates/pushes
 * a chain of effects. The card enters play upon resolution (see chain-reducer).
 */
function handlePlayLongEvent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'play-long-event') return { state, error: 'Expected play-long-event action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
  if (!def || def.cardType !== 'hero-resource-event' || def.eventType !== 'long') {
    return { state, error: 'Card is not a resource long-event' };
  }

  // Check uniqueness: unique long-events can't be played if already in play
  if (def.unique) {
    const alreadyInPlay = state.players.some(p =>
      p.cardsInPlay.some(c => c.definitionId === def.id),
    );
    if (alreadyInPlay) return { state, error: `${def.name} is unique and already in play` };
  }

  // Check duplication-limit with scope "game"
  if (def.effects) {
    for (const effect of def.effects) {
      if (effect.type !== 'duplication-limit' || effect.scope !== 'game') continue;
      const copiesInPlay = state.players.reduce((count, p) =>
        count + p.cardsInPlay.filter(c => {
          const cDef = state.cardPool[c.definitionId as string];
          return cDef && cDef.name === def.name;
        }).length, 0,
      );
      if (copiesInPlay >= effect.max) {
        return { state, error: `${def.name} cannot be duplicated` };
      }
    }
  }

  logDetail(`Playing resource long-event: ${def.name} → enters chain`);

  // Remove card from hand — it now resides on the chain
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, hand: newHand };
  let newState: GameState = { ...state, players: newPlayers };

  // Initiate or push onto chain — card enters play upon resolution
  if (newState.chain === null) {
    newState = initiateChain(newState, action.player, handCard, { type: 'long-event' });
  } else {
    newState = pushChainEntry(newState, action.player, handCard, { type: 'long-event' });
  }

  return { state: newState };
}

/**
 * Handle actions during the Movement/Hazard phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the Site phase.
 */

