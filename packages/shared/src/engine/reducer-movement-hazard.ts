/**
 * @module reducer-movement-hazard
 *
 * Movement/Hazard phase handlers for the game reducer. Covers company selection,
 * site revelation, hazard play, creature keying, on-guard placement, draw cards,
 * and hand reset sub-steps.
 */

import type { GameState, MovementHazardPhaseState, Company, CreatureCard, GameAction } from '../index.js';
import { Phase, CardStatus, isCharacterCard, isSiteCard, RegionType, Race, Skill, getPlayerIndex, BASE_MAX_REGION_DISTANCE, hasPlayFlag } from '../index.js';
import { resolveHandSize } from './effects/index.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { logDetail } from './legal-actions/log.js';
import { initiateChain, pushChainEntry } from './chain-reducer.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { clonePlayers, startDeckExhaust, completeDeckExhaust, handleExchangeSideboard, cleanupEmptyCompanies, autoMergeNonHavenCompanies } from './reducer-utils.js';
import { handlePlayShortEvent } from './reducer-events.js';
import { handlePlayPermanentEvent } from './reducer-events.js';
import { sweepExpired, addConstraint } from './pending.js';


/**
 * Handle actions during the Movement/Hazard phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the Site phase.
 */
export function handleMovementHazard(state: GameState, action: GameAction): ReducerResult {
  const mhState = state.phaseState as MovementHazardPhaseState;

  // Pending wound corruption checks (Barrow-wight et al.) are now routed
  // through the unified pending-resolution dispatcher in `reducer.ts` /
  // `pending-reducers.ts` before this handler is reached.

  if (mhState.step === 'select-company') {
    return handleSelectCompany(state, action, mhState);
  }

  if (mhState.step === 'reveal-new-site') {
    return handleRevealNewSite(state, action, mhState);
  }

  // set-hazard-limit step (CoE step 3): compute and fix the hazard limit, then advance
  if (mhState.step === 'set-hazard-limit') {
    if (action.type !== 'pass') {
      return { state, error: `Expected 'pass' during set-hazard-limit step, got '${action.type}'` };
    }
    const playerIndex = getPlayerIndex(state, action.player);
    const company = state.players[playerIndex].companies[mhState.activeCompanyIndex];
    const hazardLimit = computeHazardLimit(state, company);
    logDetail(`Movement/Hazard: hazard limit set to ${hazardLimit} → advancing to order-effects`);
    return {
      state: {
        ...state,
        phaseState: {
          ...mhState,
          step: 'order-effects' as const,
          hazardLimit,
        },
      },
    };
  }

  // order-effects step (CoE step 4): hazard player orders ongoing effects — dummy for now
  if (mhState.step === 'order-effects') {
    if (action.type !== 'pass') {
      return { state, error: `Expected 'pass' during order-effects step, got '${action.type}'` };
    }
    return transitionToDrawCards(state, mhState);
  }

  // draw-cards step (CoE step 5): both players draw cards simultaneously
  if (mhState.step === 'draw-cards') {
    return handleDrawCards(state, action, mhState);
  }

  // play-hazards step (CoE step 7): hazard player plays hazards, resource player may respond
  if (mhState.step === 'play-hazards') {
    return handlePlayHazards(state, action, mhState);
  }

  // reset-hand step (CoE step 8): players discard down to hand size
  if (mhState.step === 'reset-hand') {
    return handleResetHand(state, action, mhState);
  }

  return { state, error: `Unexpected step '${mhState.step as string}' in movement/hazard phase` };
}

/**
 * Handle actions during the play-hazards step (CoE step 7).
 *
 * The hazard player may play hazard long-events (and eventually creatures,
 * short-events, permanent-events, on-guard cards) up to the hazard limit.
 * Both players may pass; the company's M/H phase ends when both have passed.
 * If the hazard player takes an action after the resource player passed,
 * the resource player's pass is reset.
 */


/**
 * Handle actions during the play-hazards step (CoE step 7).
 *
 * The hazard player may play hazard long-events (and eventually creatures,
 * short-events, permanent-events, on-guard cards) up to the hazard limit.
 * Both players may pass; the company's M/H phase ends when both have passed.
 * If the hazard player takes an action after the resource player passed,
 * the resource player's pass is reset.
 */
function handlePlayHazards(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const isResourcePlayer = action.player === state.activePlayer;

  // --- Pass ---
  if (action.type === 'pass') {
    const newMhState = {
      ...mhState,
      ...(isResourcePlayer
        ? { resourcePlayerPassed: true }
        : { hazardPlayerPassed: true }),
    };

    // Both passed → end this company's M/H phase
    if (newMhState.resourcePlayerPassed && newMhState.hazardPlayerPassed) {
      return endCompanyMH(state, newMhState);
    }

    logDetail(`Play-hazards: ${isResourcePlayer ? 'resource' : 'hazard'} player passed`);
    return { state: { ...state, phaseState: newMhState } };
  }

  // --- Play hazard ---
  if (action.type === 'play-hazard') {
    if (isResourcePlayer) {
      return { state, error: 'Only the hazard player may play hazards' };
    }
    if (mhState.hazardsPlayedThisCompany >= mhState.hazardLimit) {
      return { state, error: `Hazard limit reached (${mhState.hazardLimit})` };
    }
    return handlePlayHazardCard(state, action, mhState);
  }

  // --- Resource permanent event (e.g. Gates of Morning, rule 2.1.1) ---
  if (action.type === 'play-permanent-event') {
    return handlePlayPermanentEvent(state, action);
  }

  // --- Short event (e.g. Twilight canceling an environment) ---
  if (action.type === 'play-short-event') {
    return handlePlayShortEvent(state, action);
  }

  // --- Place on-guard ---
  if (action.type === 'place-on-guard') {
    if (isResourcePlayer) {
      return { state, error: 'Only the hazard player may place on-guard cards' };
    }
    if (mhState.onGuardPlacedThisCompany) {
      return { state, error: 'Already placed an on-guard card this company' };
    }
    if (mhState.hazardsPlayedThisCompany >= mhState.hazardLimit) {
      return { state, error: `Hazard limit reached (${mhState.hazardLimit})` };
    }
    return handlePlaceOnGuard(state, action, mhState);
  }

  return { state, error: `Unexpected action '${action.type}' during play-hazards step` };
}

/**
 * Play a hazard card from hand during the play-hazards step.
 *
 * Currently supports hazard long-events. Playing a hazard counts as one
 * against the hazard limit. If the resource player had passed, their
 * pass is reset (they may resume taking actions).
 *
 * TODO: creatures, short-events, permanent-events, on-guard cards
 */


/**
 * Play a hazard card from hand during the play-hazards step.
 *
 * Currently supports hazard long-events. Playing a hazard counts as one
 * against the hazard limit. If the resource player had passed, their
 * pass is reset (they may resume taking actions).
 *
 * TODO: creatures, short-events, permanent-events, on-guard cards
 */
function handlePlayHazardCard(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'play-hazard') return { state, error: 'Expected play-hazard action' };

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];

  // Validate card is in hand
  const cardIdx = hazardPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const handCard = hazardPlayer.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
  if (!def) return { state, error: 'Card definition not found' };

  // --- Creature handling (via chain of effects) ---
  if (def.cardType === 'hazard-creature') {
    const keyError = checkCreatureKeying(def, mhState);
    if (keyError) return { state, error: keyError };

    // Creatures must initiate a new chain — they cannot be played in response (CoE rule 307)
    if (state.chain != null) {
      return { state, error: 'Creatures must initiate a new chain — cannot be played in response' };
    }

    logDetail(`Play-hazards: hazard player plays creature "${def.name}" (${mhState.hazardsPlayedThisCompany + 1}/${mhState.hazardLimit}) — initiating chain`);

    // Remove card from hand — it resides on the chain entry until combat resolves
    const newHand = [...hazardPlayer.hand];
    newHand.splice(cardIdx, 1);
    const newPlayers = clonePlayers(state);
    newPlayers[hazardIndex] = { ...hazardPlayer, hand: newHand };

    let newState: GameState = {
      ...state,
      players: newPlayers,
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: mhState.hazardsPlayedThisCompany + 1,
        resourcePlayerPassed: false,
      },
    };

    // Initiate chain — when creature entry resolves, combat will start (TODO)
    newState = initiateChain(newState, action.player, handCard, { type: 'creature' });

    return { state: newState };
  }

  // --- Short event handling (via chain of effects) ---
  if (def.cardType === 'hazard-event' && def.eventType === 'short') {
    const bypassesLimit = hasPlayFlag(def, 'no-hazard-limit');
    const newHazardCount = bypassesLimit ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1;
    logDetail(`Play-hazards: hazard player plays short-event "${def.name}" (${newHazardCount}/${mhState.hazardLimit})${bypassesLimit ? ' [no-hazard-limit]' : ''}`);

    // Move card from hand to discard (short events are discarded after resolution)
    const newHand = [...hazardPlayer.hand];
    newHand.splice(cardIdx, 1);
    const newPlayers = clonePlayers(state);
    newPlayers[hazardIndex] = {
      ...hazardPlayer,
      hand: newHand,
      discardPile: [...hazardPlayer.discardPile, handCard],
    };

    let newState: GameState = {
      ...state,
      players: newPlayers,
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: newHazardCount,
        resourcePlayerPassed: false,
      },
    };

    // Initiate chain or push onto existing chain
    if (newState.chain === null) {
      newState = initiateChain(newState, action.player, handCard, { type: 'short-event' });
    } else {
      newState = pushChainEntry(newState, action.player, handCard, { type: 'short-event' });
    }

    return { state: newState };
  }

  // --- Event handling (long / permanent) ---
  if (def.cardType !== 'hazard-event' || (def.eventType !== 'long' && def.eventType !== 'permanent')) {
    return { state, error: `Cannot play ${def.cardType} during play-hazards — only creatures, short-events and hazard long/permanent-events are currently supported` };
  }

  // Uniqueness check: unique events can't be played if already in play
  if (def.unique) {
    const alreadyInPlay = state.players.some(p =>
      p.cardsInPlay.some(c => c.definitionId === def.id),
    );
    if (alreadyInPlay) return { state, error: `${def.name} is unique and already in play` };
  }

  // Duplication-limit check
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

  logDetail(`Play-hazards: hazard player plays ${def.eventType}-event "${def.name}" (${mhState.hazardsPlayedThisCompany + 1}/${mhState.hazardLimit}) → enters chain`);

  // Remove card from hand — it now resides on the chain
  const newHand = [...hazardPlayer.hand];
  newHand.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[hazardIndex] = { ...hazardPlayer, hand: newHand };

  let newState: GameState = {
    ...state,
    players: newPlayers,
    phaseState: {
      ...mhState,
      hazardsPlayedThisCompany: mhState.hazardsPlayedThisCompany + 1,
      // Reset resource player's pass — they may respond
      resourcePlayerPassed: false,
    },
  };

  // Initiate or push onto chain — card enters play upon resolution
  const payload: import('../index.js').ChainEntryPayload = def.eventType === 'permanent'
    ? {
        type: 'permanent-event',
        targetCharacterId: action.type === 'play-hazard' ? action.targetCharacterId : undefined,
        targetSiteDefinitionId: action.type === 'play-hazard' ? action.targetSiteDefinitionId : undefined,
      }
    : { type: 'long-event' };
  if (newState.chain === null) {
    newState = initiateChain(newState, action.player, handCard, payload);
  } else {
    newState = pushChainEntry(newState, action.player, handCard, payload);
  }

  return { state: newState };
}

/**
 * Place a card from the hazard player's hand face-down on the active
 * company as an on-guard card. Any card may be placed (bluffing is
 * allowed). Counts against the hazard limit and resets the resource
 * player's pass.
 */


/**
 * Place a card from the hazard player's hand face-down on the active
 * company as an on-guard card. Any card may be placed (bluffing is
 * allowed). Counts against the hazard limit and resets the resource
 * player's pass.
 */
function handlePlaceOnGuard(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'place-on-guard') return { state, error: 'Expected place-on-guard action' };

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];

  // Validate card is in hand
  const cardIdx = hazardPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const handCard = hazardPlayer.hand[cardIdx];

  logDetail(`Play-hazards: hazard player places on-guard card "${action.cardInstanceId}" (${mhState.hazardsPlayedThisCompany + 1}/${mhState.hazardLimit})`);

  // Remove card from hand
  const newHand = [...hazardPlayer.hand];
  newHand.splice(cardIdx, 1);

  // Add card to the active company's on-guard cards
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const newPlayers = clonePlayers(state);
  newPlayers[hazardIndex] = { ...hazardPlayer, hand: newHand };

  const resourcePlayer = newPlayers[activeIndex];
  const newCompanies = [...resourcePlayer.companies];
  const company = newCompanies[mhState.activeCompanyIndex];
  newCompanies[mhState.activeCompanyIndex] = {
    ...company,
    onGuardCards: [...company.onGuardCards, { instanceId: handCard.instanceId, definitionId: handCard.definitionId, revealed: false }],
  };
  newPlayers[activeIndex] = { ...resourcePlayer, companies: newCompanies };

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: mhState.hazardsPlayedThisCompany + 1,
        onGuardPlacedThisCompany: true,
        resourcePlayerPassed: false,
      },
    },
  };
}

/**
 * End the current company's M/H phase and either select the next company
 * or advance to the Site phase.
 */
/**
 * End the current company's M/H phase (CoE step 8).
 *
 * 1. Complete movement: update currentSite, handle site of origin.
 * 2. Draw up to hand size (automatic for both players).
 * 3. If either player exceeds hand size, transition to 'reset-hand' step
 *    for interactive discard. Otherwise advance directly.
 *
 * TODO: passive conditions at end of M/H phase
 * TODO: check if other companies have unresolved movement to site of origin
 */


/**
 * End the current company's M/H phase (CoE step 8).
 *
 * 1. Complete movement: update currentSite, handle site of origin.
 * 2. Draw up to hand size (automatic for both players).
 * 3. If either player exceeds hand size, transition to 'reset-hand' step
 *    for interactive discard. Otherwise advance directly.
 *
 * TODO: passive conditions at end of M/H phase
 * TODO: check if other companies have unresolved movement to site of origin
 */
function endCompanyMH(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const newPlayers = clonePlayers(state);

  // --- Step 8a: Complete movement ---
  const resourcePlayer = newPlayers[activeIndex];
  const company = resourcePlayer.companies[mhState.activeCompanyIndex];

  // Track an optional `company-arrives-at-site` event to fire after the
  // base move completes. We compute the post-move state first, then run
  // the event hook on the resulting state so the destination is the
  // company's *current* site.
  let companyArrivedAt: { companyId: typeof company.id; siteInstanceId: typeof company.destinationSite extends null ? never : NonNullable<typeof company.destinationSite>['instanceId'] } | null = null;

  if (company.destinationSite && !mhState.returnedToOrigin) {
    const originSite = company.currentSite;

    // Rule 2.II.7.2: detect whether another of this player's companies is
    // already at the destination — the moving company then shares the site
    // without taking a physical copy (same invariant as split-at-haven).
    const sharedDestinationOwner = resourcePlayer.companies.find(
      (c, idx) => idx !== mhState.activeCompanyIndex
        && c.currentSite?.instanceId === company.destinationSite!.instanceId,
    );

    const updatedCompanies = [...resourcePlayer.companies];
    updatedCompanies[mhState.activeCompanyIndex] = {
      ...company,
      currentSite: { instanceId: company.destinationSite.instanceId, definitionId: company.destinationSite.definitionId, status: CardStatus.Untapped },
      destinationSite: null,
      moved: true,
      siteOfOrigin: null,
      siteCardOwned: sharedDestinationOwner ? false : true,
    };

    if (sharedDestinationOwner) {
      logDetail(`Step 8: arrived at site already in play at sibling company ${sharedDestinationOwner.id as string} — siteCardOwned=false`);
    }

    // Handle site of origin: return to siteDeck (untapped/haven) or discard
    // (tapped non-haven). Rule 2.II.7.2: if another of this player's companies
    // is still at the origin, the site stays in play and must not be
    // returned or discarded.
    // TODO: discard tapped non-haven sites once site tapping is implemented
    let newSiteDeck = [...resourcePlayer.siteDeck];
    if (originSite) {
      const siblingStillAtOrigin = resourcePlayer.companies.some(
        (c, idx) => idx !== mhState.activeCompanyIndex
          && c.currentSite?.instanceId === originSite.instanceId,
      );
      if (siblingStillAtOrigin) {
        logDetail(`Step 8: site of origin remains in play — still occupied by a sibling company`);
      } else {
        const originDef = state.cardPool[originSite.definitionId as string];
        const isHaven = originDef && isSiteCard(originDef) && originDef.siteType === 'haven';
        newSiteDeck = newSiteDeck.filter(c => c.instanceId !== originSite.instanceId);
        if (isHaven) {
          logDetail(`Step 8: site of origin is a haven — returning to location deck`);
        } else {
          logDetail(`Step 8: site of origin is non-haven — returning to location deck (TODO: discard if tapped)`);
        }
        newSiteDeck.push({ instanceId: originSite.instanceId, definitionId: originSite.definitionId });
      }
    }

    logDetail(`Step 8: company moved to ${mhState.destinationSiteName ?? '?'}, origin site handled`);
    newPlayers[activeIndex] = {
      ...resourcePlayer,
      companies: updatedCompanies,
      siteDeck: newSiteDeck,
    };

    // Defer firing the company-arrives-at-site event until we've
    // assembled the final state below.
    companyArrivedAt = {
      companyId: company.id,
      siteInstanceId: company.destinationSite.instanceId as never,
    };
  } else if (mhState.returnedToOrigin) {
    const updatedCompanies = [...resourcePlayer.companies];
    updatedCompanies[mhState.activeCompanyIndex] = {
      ...company,
      destinationSite: null,
      siteOfOrigin: null,
    };
    logDetail(`Step 8: company was returned to origin — staying at current site`);
    newPlayers[activeIndex] = { ...resourcePlayer, companies: updatedCompanies };
  } else {
    const updatedCompanies = [...resourcePlayer.companies];
    updatedCompanies[mhState.activeCompanyIndex] = {
      ...company,
      siteOfOrigin: null,
    };
    newPlayers[activeIndex] = { ...resourcePlayer, companies: updatedCompanies };
  }

  // --- Step 8b: Draw up to hand size (automatic) ---
  // Use intermediate state for hand size resolution so updated companies are visible
  let intermediateState = { ...state, players: newPlayers };
  for (let i = 0; i < 2; i++) {
    const p = newPlayers[i];
    const handSize = resolveHandSize(intermediateState, i);
    if (p.hand.length < handSize) {
      const drawCount = Math.min(handSize - p.hand.length, p.playDeck.length);
      if (drawCount > 0) {
        logDetail(`Step 8: player ${p.name} draws ${drawCount} card(s) to reach hand size ${handSize}`);
        newPlayers[i] = {
          ...p,
          hand: [...p.hand, ...p.playDeck.slice(0, drawCount)],
          playDeck: p.playDeck.slice(drawCount),
        };
        intermediateState = { ...intermediateState, players: newPlayers };
      }
    }
  }

  // --- Step 8c: If anyone needs to discard, go to reset-hand step ---
  const needsDiscard = newPlayers.some((p, i) => p.hand.length > resolveHandSize(intermediateState, i));
  let updatedState: GameState = { ...state, players: newPlayers };

  // Fire the company-arrives-at-site event hook (River, etc.) on the
  // post-move state. The hook scans both players' cardsInPlay for
  // hazards with a matching `on-event: company-arrives-at-site` and
  // dispatches them to the on-event handler.
  if (companyArrivedAt) {
    updatedState = fireCompanyArrivesAtSite(
      updatedState,
      companyArrivedAt.companyId,
      companyArrivedAt.siteInstanceId,
    );
  }

  if (needsDiscard) {
    logDetail(`Step 8: player(s) over hand size — entering reset-hand for discard`);
    return {
      state: {
        ...updatedState,
        phaseState: {
          ...mhState,
          step: 'reset-hand' as const,
        },
      },
    };
  }

  return advanceAfterCompanyMH(updatedState, mhState);
}

/**
 * Dispatch the `company-arrives-at-site` on-event hook for the given
 * company arriving at the given site. Scans both players' cardsInPlay
 * for cards whose effects array contains an
 * `on-event: company-arrives-at-site` entry; for each match, applies
 * the configured triggered action (typically `add-constraint`).
 *
 * Site-attached hazards (those with `card.attachedToSite` set, e.g.
 * *River*) only fire when the company is arriving at the bound site
 * location — the binding is by site definition ID, so multiple
 * players' copies of the same site share one trigger condition.
 * Cards without `attachedToSite` fire on every arrival (no current
 * card uses this; reserved for future "any arrival" effects).
 */
function fireCompanyArrivesAtSite(
  state: GameState,
  arrivingCompanyId: import('../index.js').CompanyId,
  siteInstanceId: import('../index.js').CardInstanceId,
): GameState {
  // Resolve the destination site's definition ID so we can match it
  // against any `attachedToSite` bindings on cards in play.
  const arrivalSiteDefId = resolveInstanceId(state, siteInstanceId);

  let newState = state;
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      // Site-attached hazards only fire for the bound site location.
      if (card.attachedToSite && card.attachedToSite !== arrivalSiteDefId) {
        continue;
      }
      const def = state.cardPool[card.definitionId as string];
      if (!def || !('effects' in def) || !def.effects) continue;
      for (const effect of def.effects) {
        if (effect.type !== 'on-event') continue;
        if (effect.event !== 'company-arrives-at-site') continue;
        if (effect.apply.type !== 'add-constraint') continue;
        const constraintKind = effect.apply.constraint;
        const scopeName = effect.apply.scope;
        if (!constraintKind || !scopeName) continue;

        // Map scope name to ConstraintScope
        let scope: import('../types/pending.js').ConstraintScope;
        switch (scopeName) {
          case 'company-site-phase':
            scope = { kind: 'company-site-phase', companyId: arrivingCompanyId };
            break;
          case 'turn':
            scope = { kind: 'turn' };
            break;
          case 'until-cleared':
            scope = { kind: 'until-cleared' };
            break;
          default:
            continue;
        }
        let kind: import('../types/pending.js').ActiveConstraint['kind'];
        switch (constraintKind) {
          case 'site-phase-do-nothing':
            kind = effect.apply.cancelWhen
              ? { type: 'site-phase-do-nothing', cancelWhen: effect.apply.cancelWhen }
              : { type: 'site-phase-do-nothing' };
            break;
          case 'no-creature-hazards-on-company':
            kind = { type: 'no-creature-hazards-on-company' };
            break;
          case 'deny-scout-resources':
            kind = { type: 'deny-scout-resources' };
            break;
          default:
            continue;
        }
        logDetail(`company-arrives-at-site: "${def.name}" fires → adding constraint ${constraintKind} on company ${arrivingCompanyId as string}`);
        newState = addConstraint(newState, {
          source: card.instanceId,
          sourceDefinitionId: card.definitionId,
          scope,
          target: { kind: 'company', companyId: arrivingCompanyId },
          kind,
        });
      }
    }
  }

  // Scan allies in the arriving company for discard-self on-event effects.
  newState = fireAllyArrivalEffects(newState, arrivingCompanyId, siteInstanceId);

  return newState;
}

/**
 * Scan allies attached to characters in the arriving company for
 * `on-event: company-arrives-at-site` effects with `discard-self`.
 * When the effect's `when` condition matches the arrival site context,
 * the ally is discarded from its bearer to the owning player's discard pile.
 */
function fireAllyArrivalEffects(
  state: GameState,
  arrivingCompanyId: import('../index.js').CompanyId,
  siteInstanceId: import('../index.js').CardInstanceId,
): GameState {
  const siteDef = state.cardPool[resolveInstanceId(state, siteInstanceId) as string];
  const siteRegion = siteDef && isSiteCard(siteDef) ? siteDef.region : '';

  let newState = state;
  for (let pIdx = 0; pIdx < 2; pIdx++) {
    const player = newState.players[pIdx];
    const company = player.companies.find(c => c.id === arrivingCompanyId);
    if (!company) continue;

    for (const charInstId of company.characters) {
      const char = player.characters[charInstId as string];
      if (!char) continue;

      for (const ally of char.allies) {
        const def = newState.cardPool[ally.definitionId as string];
        if (!def || !('effects' in def) || !def.effects) continue;
        const effects = (def as { effects: readonly import('../types/effects.js').CardEffect[] }).effects;
        for (const effect of effects) {
          if (effect.type !== 'on-event') continue;
          if (effect.event !== 'company-arrives-at-site') continue;
          if (effect.apply.type !== 'discard-self') continue;

          const context: Record<string, unknown> = { site: { region: siteRegion } };
          if (effect.when && !matchesCondition(effect.when, context)) continue;

          logDetail(`company-arrives-at-site: ally "${def.name}" discard-self triggered (site region: ${siteRegion})`);
          const newPlayers = clonePlayers(newState);
          const updatedAllies = char.allies.filter(a => a.instanceId !== ally.instanceId);
          newPlayers[pIdx] = {
            ...newPlayers[pIdx],
            characters: {
              ...newPlayers[pIdx].characters,
              [charInstId as string]: { ...newPlayers[pIdx].characters[charInstId as string], allies: updatedAllies },
            },
            discardPile: [...newPlayers[pIdx].discardPile, { instanceId: ally.instanceId, definitionId: ally.definitionId }],
          };
          newState = { ...newState, players: [newPlayers[0], newPlayers[1]] as unknown as typeof newState.players };
          break;
        }
      }
    }
  }
  return newState;
}

/**
 * Handle the reset-hand step: players with hand > HAND_SIZE must discard.
 * Each discard-card action removes one card. Once both players are at or
 * below hand size, advance to the next company or Site phase.
 */


/**
 * Handle the reset-hand step: players with hand > HAND_SIZE must discard.
 * Each discard-card action removes one card. Once both players are at or
 * below hand size, advance to the next company or Site phase.
 */
function handleResetHand(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'discard-card') {
    return { state, error: `Expected 'discard-card' during reset-hand step, got '${action.type}'` };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const handSize = resolveHandSize(state, playerIndex);

  if (player.hand.length <= handSize) {
    return { state, error: `Player ${player.name} does not need to discard (hand: ${player.hand.length}/${handSize})` };
  }

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) {
    return { state, error: 'Card not in hand' };
  }

  const discardedCard = player.hand[cardIdx];
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    hand: newHand,
    discardPile: [...player.discardPile, discardedCard],
  };

  logDetail(`Reset-hand: player ${player.name} discards 1 card (${newHand.length}/${handSize})`);

  const updatedState = { ...state, players: newPlayers };

  // Check if both players are now at hand size
  if (newPlayers.every((p, i) => p.hand.length <= resolveHandSize(updatedState, i))) {
    logDetail(`Reset-hand: all players at hand size → advancing`);
    return advanceAfterCompanyMH(updatedState, mhState);
  }

  return { state: updatedState };
}

/**
 * Advance to the next company's M/H sub-phase or to the Site phase
 * after the current company's step 8 is fully resolved.
 */


/**
 * Advance to the next company's M/H sub-phase or to the Site phase
 * after the current company's step 8 is fully resolved.
 */
function advanceAfterCompanyMH(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const currentCompany = state.players[activeIndex].companies[mhState.activeCompanyIndex];
  const updatedHandled = [...mhState.handledCompanyIds, currentCompany.id];

  // Sweep any active constraints / pending resolutions scoped to the
  // company that just finished its M/H sub-phase.
  state = sweepExpired(state, { kind: 'company-mh-end', companyId: currentCompany.id });

  const remainingCount = state.players[activeIndex].companies.length - updatedHandled.length;

  if (remainingCount <= 0) {
    logDetail(`Movement/Hazard: all companies handled → advancing to Site phase`);
    // Rule 2.IV.6: auto-merge any of the resource player's companies that
    // ended up at the same non-haven site. Run before resetting moved flags
    // so the merge sees the post-movement company layout.
    const mergedState = autoMergeNonHavenCompanies(state, activeIndex);
    // Reset moved flags so the site phase shows a clean slate
    const newPlayers = clonePlayers(mergedState);
    newPlayers[activeIndex] = {
      ...newPlayers[activeIndex],
      companies: newPlayers[activeIndex].companies.map(c => ({ ...c, moved: false, specialMovement: undefined, extraRegionDistance: undefined })),
    };
    return {
      state: cleanupEmptyCompanies({
        ...mergedState,
        players: newPlayers,
        phaseState: {
          phase: Phase.Site,
          step: 'select-company',
          activeCompanyIndex: 0,
          handledCompanyIds: [],
          automaticAttacksResolved: 0,
          siteEntered: false,
          resourcePlayed: false,
          minorItemAvailable: false,

          declaredAgentAttack: null,
          awaitingOnGuardReveal: false,
          pendingResourceAction: null,
          opponentInteractionThisTurn: null,
          pendingOpponentInfluence: null,
        },
      }),
    };
  }

  logDetail(`Movement/Hazard: company ${currentCompany.id} done → returning to select-company (${remainingCount} remaining)`);
  return {
    state: {
      ...state,
      phaseState: {
        ...mhState,
        step: 'select-company' as const,
        handledCompanyIds: updatedHandled,
        movementType: null,
        declaredRegionPath: [],
        maxRegionDistance: BASE_MAX_REGION_DISTANCE,
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
        hazardsEncountered: [],
      },
    },
  };
}

/**
 * Check whether any of the creature's region types can be keyed to the
 * company's site path.
 *
 * Each distinct region type is an independent keying option (OR). If the
 * same type appears N times on the creature card, the path must contain
 * at least N regions of that type.
 *
 * Per CoE: "If multiple of the same region type appear on the creature card,
 * the company must be moving through at least that many corresponding regions
 * (but which need not be consecutive)."
 */


/**
 * Check whether any of the creature's region types can be keyed to the
 * company's site path.
 *
 * Each distinct region type is an independent keying option (OR). If the
 * same type appears N times on the creature card, the path must contain
 * at least N regions of that type.
 *
 * Per CoE: "If multiple of the same region type appear on the creature card,
 * the company must be moving through at least that many corresponding regions
 * (but which need not be consecutive)."
 */
function regionTypesMatch(required: readonly RegionType[], path: readonly RegionType[]): boolean {
  // Count how many of each type the creature requires
  const requiredCounts = new Map<RegionType, number>();
  for (const rt of required) requiredCounts.set(rt, (requiredCounts.get(rt) ?? 0) + 1);
  // Count how many of each type are in the path
  const pathCounts = new Map<RegionType, number>();
  for (const rt of path) pathCounts.set(rt, (pathCounts.get(rt) ?? 0) + 1);
  // Any type with enough matches in the path is sufficient (OR)
  for (const [rt, need] of requiredCounts) {
    if ((pathCounts.get(rt) ?? 0) >= need) return true;
  }
  return false;
}

/**
 * Check whether a creature can be keyed to the current company's site path
 * or destination site (CoE rule 2.IV.vii.2).
 *
 * A creature is keyable if any of its {@link CreatureKeyRestriction} entries
 * match at least one of:
 * - A region type on the company's resolved site path
 * - A region name on the company's resolved site path
 * - The destination site type
 * - The destination site name (TODO: not yet checked)
 *
 * @returns An error string if the creature cannot be keyed, or undefined if legal.
 */


/**
 * Check whether a creature can be keyed to the current company's site path
 * or destination site (CoE rule 2.IV.vii.2).
 *
 * A creature is keyable if any of its {@link CreatureKeyRestriction} entries
 * match at least one of:
 * - A region type on the company's resolved site path
 * - A region name on the company's resolved site path
 * - The destination site type
 * - The destination site name (TODO: not yet checked)
 *
 * @returns An error string if the creature cannot be keyed, or undefined if legal.
 */
function checkCreatureKeying(def: CreatureCard, mhState: MovementHazardPhaseState): string | undefined {
  for (const key of def.keyedTo) {
    // Check region types against site path (count-based: if the creature
    // lists a region type N times, the path must contain at least N of that type)
    if (key.regionTypes && key.regionTypes.length > 0) {
      if (regionTypesMatch(key.regionTypes, mhState.resolvedSitePath)) {
        logDetail(`Creature "${def.name}" keyable to region type(s): ${key.regionTypes.join(', ')}`);
        return undefined;
      }
    }
    // Check region names against site path names
    if (key.regionNames && key.regionNames.length > 0) {
      const pathNames = mhState.resolvedSitePathNames;
      if (key.regionNames.some(rn => pathNames.includes(rn))) {
        logDetail(`Creature "${def.name}" keyable to region name: ${key.regionNames.join(', ')}`);
        return undefined;
      }
    }
    // Check site types against destination
    if (key.siteTypes && key.siteTypes.length > 0 && mhState.destinationSiteType) {
      if (key.siteTypes.includes(mhState.destinationSiteType)) {
        logDetail(`Creature "${def.name}" keyable to site type: ${mhState.destinationSiteType}`);
        return undefined;
      }
    }
  }

  const keyDesc = def.keyedTo.map(k => {
    const parts: string[] = [];
    if (k.regionTypes?.length) parts.push(`regions: ${k.regionTypes.join('/')}`);
    if (k.regionNames?.length) parts.push(`named: ${k.regionNames.join('/')}`);
    if (k.siteTypes?.length) parts.push(`sites: ${k.siteTypes.join('/')}`);
    return parts.join(', ');
  }).join(' OR ');
  return `${def.name} cannot be keyed to this company's path (requires ${keyDesc})`;
}

/**
 * Handle the 'select-company' action: resource player picks which company
 * resolves its M/H sub-phase next.
 */


/**
 * Handle the 'select-company' action: resource player picks which company
 * resolves its M/H sub-phase next.
 */
function handleSelectCompany(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'select-company') {
    return { state, error: `Expected 'select-company' action during select-company step, got '${action.type}'` };
  }

  if (action.player !== state.activePlayer) {
    return { state, error: `Only the active player may select a company` };
  }

  const playerIndex = getPlayerIndex(state, state.activePlayer);
  const player = state.players[playerIndex];
  const companyIndex = player.companies.findIndex(c => c.id === action.companyId);

  if (companyIndex === -1) {
    return { state, error: `Company '${action.companyId}' not found` };
  }

  if (mhState.handledCompanyIds.includes(action.companyId)) {
    return { state, error: `Company '${action.companyId}' has already been handled this turn` };
  }

  const company = player.companies[companyIndex];
  const isMoving = company.destinationSite !== null;

  // Compute effective max region distance from base + card effects (e.g. Cram's extra-region-movement)
  const maxRegionDistance = BASE_MAX_REGION_DISTANCE + (company.extraRegionDistance ?? 0);
  logDetail(`Movement/Hazard: selected company ${action.companyId} (index ${companyIndex}), moving=${isMoving}, maxRegions=${maxRegionDistance} (base ${BASE_MAX_REGION_DISTANCE} + extra ${company.extraRegionDistance ?? 0}) → advancing to reveal-new-site`);
  return {
    state: {
      ...state,
      phaseState: {
        ...mhState,
        step: 'reveal-new-site' as const,
        activeCompanyIndex: companyIndex,
        siteRevealed: isMoving,
        maxRegionDistance,
      },
    },
  };
}

/**
 * Handle the 'reveal-new-site' step (CoE step 1): the new site card is
 * revealed and the resource player declares their movement path.
 *
 * For non-moving companies, accepts a 'pass' action to advance.
 * For moving companies, accepts a 'declare-path' action that sets the
 * movement type and (for region movement) the region path.
 *
 * TODO: triggering events on site reveal
 * TODO: under-deeps movement roll (stay if roll < site number)
 */


/**
 * Handle the 'reveal-new-site' step (CoE step 1): the new site card is
 * revealed and the resource player declares their movement path.
 *
 * For non-moving companies, accepts a 'pass' action to advance.
 * For moving companies, accepts a 'declare-path' action that sets the
 * movement type and (for region movement) the region path.
 *
 * TODO: triggering events on site reveal
 * TODO: under-deeps movement roll (stay if roll < site number)
 */
function handleRevealNewSite(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.player !== state.activePlayer) {
    return { state, error: `Only the active player may act during reveal-new-site` };
  }

  // Non-moving company: pass to advance (skip declare-path, go to set-hazard-limit)
  // Set destinationSiteType/Name to current site so creatures can be keyed to it
  if (action.type === 'pass') {
    const playerIdx = getPlayerIndex(state, action.player);
    const nonMovingCompany = state.players[playerIdx].companies[mhState.activeCompanyIndex];
    const currentSiteDef = nonMovingCompany.currentSite ? state.cardPool[nonMovingCompany.currentSite.definitionId as string] : undefined;
    const currentSite = currentSiteDef && isSiteCard(currentSiteDef) ? currentSiteDef : undefined;
    logDetail(`Movement/Hazard: non-moving company → advancing to set-hazard-limit`);
    return {
      state: {
        ...state,
        phaseState: {
          ...mhState,
          step: 'set-hazard-limit' as const,
          destinationSiteType: currentSite?.siteType ?? null,
          destinationSiteName: currentSite?.name ?? null,
        },
      },
    };
  }

  if (action.type !== 'declare-path') {
    return { state, error: `Expected 'pass' or 'declare-path' during reveal-new-site step, got '${action.type}'` };
  }

  // Resolve origin and destination sites
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const company = player.companies[mhState.activeCompanyIndex];
  if (!company?.destinationSite) {
    return { state, error: `Active company has no destination site` };
  }

  const originDef = company.currentSite ? state.cardPool[company.currentSite.definitionId as string] : undefined;
  const destDefId = company.destinationSite.definitionId;
  const destDef = destDefId ? state.cardPool[destDefId as string] : undefined;

  if (!originDef || !isSiteCard(originDef) || !destDef || !isSiteCard(destDef)) {
    return { state, error: `Could not resolve origin or destination site definitions` };
  }

  // Compute resolved site path (region types) and region names
  let resolvedSitePath: RegionType[] = [];
  const resolvedSitePathNames: string[] = [];

  if (action.movementType === 'starter') {
    // Starter: use the site card's sitePath for region types
    const originIsHaven = originDef.siteType === 'haven';
    const destIsHaven = destDef.siteType === 'haven';
    if (originIsHaven && destIsHaven && originDef.havenPaths) {
      resolvedSitePath = [...(originDef.havenPaths[destDef.name] ?? [])];
    } else if (originIsHaven && !destIsHaven) {
      resolvedSitePath = [...destDef.sitePath];
    } else if (!originIsHaven && destIsHaven) {
      resolvedSitePath = [...originDef.sitePath];
    }
    // Names: origin and destination regions
    if (originDef.region) resolvedSitePathNames.push(originDef.region);
    if (destDef.region && destDef.region !== originDef.region) resolvedSitePathNames.push(destDef.region);
  } else if (action.movementType === 'region' && action.regionPath) {
    // Region: look up each region's regionType and name
    for (const regionDefId of action.regionPath) {
      const regionDef = state.cardPool[regionDefId as string];
      if (regionDef && regionDef.cardType === 'region') {
        resolvedSitePath.push(regionDef.regionType);
        resolvedSitePathNames.push(regionDef.name);
      }
    }
  } else if (action.movementType === 'special') {
    // Special movement (e.g. Gwaihir): no region path traversed.
    // Only site-type keyed creatures can be played against this company.
    logDetail(`Special movement: no region path — only site-keyed hazards apply`);
  }

  logDetail(`Movement/Hazard: path declared (${action.movementType}, ${resolvedSitePath.length} region types: ${resolvedSitePath.join(', ')}) → advancing to set-hazard-limit`);
  return {
    state: {
      ...state,
      phaseState: {
        ...mhState,
        step: 'set-hazard-limit' as const,
        movementType: action.movementType,
        declaredRegionPath: action.regionPath ?? [],
        resolvedSitePath,
        resolvedSitePathNames,
        destinationSiteType: destDef.siteType,
        destinationSiteName: destDef.name,
      },
    },
  };
}

/**
 * Generate a unique company ID for a player by finding the highest existing
 * index among their companies and incrementing it. This avoids ID collisions
 * that can occur when companies are merged (removing lower-indexed IDs) and
 * then new companies are created.
 */


/**
 * Compute the effective company size, accounting for hobbits and orc scouts
 * each counting as half a character (rounded up for the total).
 *
 * Per CoE rules: "The number of characters in a company, with each Hobbit
 * or Orc scout character only counting as half of a character (rounded up)."
 */
function getCompanySize(state: GameState, company: Company): number {
  let halfCount = 0;
  let fullCount = 0;
  for (const charInstId of company.characters) {
    const charDefId = resolveInstanceId(state, charInstId);
    if (!charDefId) { fullCount++; continue; }
    const def = state.cardPool[charDefId as string];
    if (!def || !isCharacterCard(def)) { fullCount++; continue; }
    const isHobbit = def.race === Race.Hobbit;
    const isOrcScout = def.race === Race.Orc && def.skills.includes(Skill.Scout);
    if (isHobbit || isOrcScout) {
      halfCount++;
      logDetail(`  ${def.name} (${def.race}${isOrcScout ? '/scout' : ''}) counts as half`);
    } else {
      fullCount++;
    }
  }
  const size = Math.ceil(fullCount + halfCount / 2);
  logDetail(`Company size: ${fullCount} full + ${halfCount} half = ${size}`);
  return size;
}

/**
 * Compute the base hazard limit for a company (CoE step 3, rule 2.IV.iii).
 *
 * The limit equals the greater of the company's current size or 2,
 * then halved (rounded up) if the hazard player accessed the sideboard
 * during this turn's untap phase. The result is fixed for the entire
 * company's M/H phase, even if characters are later eliminated.
 */


/**
 * Compute the base hazard limit for a company (CoE step 3, rule 2.IV.iii).
 *
 * The limit equals the greater of the company's current size or 2,
 * then halved (rounded up) if the hazard player accessed the sideboard
 * during this turn's untap phase. The result is fixed for the entire
 * company's M/H phase, even if characters are later eliminated.
 */
function computeHazardLimit(state: GameState, company: Company): number {
  const companySize = getCompanySize(state, company);
  let limit = Math.max(companySize, 2);
  logDetail(`Hazard limit (step 3): company size ${companySize} → base limit ${limit}`);

  // Hazard player is the non-active player
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const hazardIndex = 1 - activeIndex;
  const hazardPlayer = state.players[hazardIndex];

  if (hazardPlayer.sideboardAccessedDuringUntap) {
    const halved = Math.ceil(limit / 2);
    logDetail(`Hazard limit halved (hazard player accessed sideboard during untap): ${limit} → ${halved}`);
    limit = halved;
  }

  logDetail(`Hazard limit set to ${limit}`);
  return limit;
}

/**
 * Transition from order-effects to draw-cards (CoE step 5).
 *
 * If the company is not moving, skip draws entirely and go to play-hazards.
 * Otherwise, compute the max draw counts from the appropriate site card:
 * - New site if moving to a non-haven
 * - Site of origin if moving to a haven
 *
 * The resource player may only draw if the company contains an avatar
 * (wizard/ringwraith with mind null) or a character with mind ≥ 3.
 */


/**
 * Transition from order-effects to draw-cards (CoE step 5).
 *
 * If the company is not moving, skip draws entirely and go to play-hazards.
 * Otherwise, compute the max draw counts from the appropriate site card:
 * - New site if moving to a non-haven
 * - Site of origin if moving to a haven
 *
 * The resource player may only draw if the company contains an avatar
 * (wizard/ringwraith with mind null) or a character with mind ≥ 3.
 */
function transitionToDrawCards(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[activeIndex];
  const company = player.companies[mhState.activeCompanyIndex];

  // Non-moving company: skip draws entirely
  if (!company.destinationSite) {
    logDetail(`Movement/Hazard: company not moving — skipping draw-cards → play-hazards`);
    return {
      state: {
        ...state,
        phaseState: {
          ...mhState,
          step: 'play-hazards' as const,
        },
      },
    };
  }

  // Determine which site card provides draw numbers
  const destDefId2 = company.destinationSite ? company.destinationSite.definitionId : undefined;
  const destDef = destDefId2 ? state.cardPool[destDefId2 as string] : undefined;
  const originDef = company.currentSite ? state.cardPool[company.currentSite.definitionId as string] : undefined;

  // Use new site for non-haven destination, site of origin for haven destination
  const movingToHaven = destDef && isSiteCard(destDef) && destDef.siteType === 'haven';
  const drawSite = movingToHaven ? originDef : destDef;

  let resourceDrawMax = 0;
  let hazardDrawMax = 0;

  if (drawSite && isSiteCard(drawSite)) {
    hazardDrawMax = drawSite.hazardDraws;

    // Resource player may only draw if company has an avatar or character with mind ≥ 3
    const hasEligibleCharacter = company.characters.some(charInstId => {
      const cDefId = resolveInstanceId(state, charInstId);
      if (!cDefId) return false;
      const def = state.cardPool[cDefId as string];
      if (!def || !isCharacterCard(def)) return false;
      return def.mind === null || def.mind >= 3;
    });

    if (hasEligibleCharacter) {
      resourceDrawMax = drawSite.resourceDraws;
    } else {
      logDetail(`No avatar or character with mind ≥ 3 — resource player cannot draw`);
    }
  }

  logDetail(`Movement/Hazard: order-effects done → draw-cards (resource max: ${resourceDrawMax}, hazard max: ${hazardDrawMax}, site: ${drawSite && isSiteCard(drawSite) ? drawSite.name : '?'})`);

  return {
    state: {
      ...state,
      phaseState: {
        ...mhState,
        step: 'draw-cards' as const,
        resourceDrawMax,
        hazardDrawMax,
        resourceDrawCount: 0,
        hazardDrawCount: 0,
      },
    },
  };
}

/**
 * Handle actions during the draw-cards step (CoE step 5).
 *
 * Both players draw simultaneously. Each gets `draw-cards` (count: 1)
 * to draw one card at a time. After the first mandatory draw, `pass`
 * becomes available to stop drawing early. Once a player has drawn
 * their max or passed, they are done. When both are done, advance
 * to play-hazards.
 */


/**
 * Handle actions during the draw-cards step (CoE step 5).
 *
 * Both players draw simultaneously. Each gets `draw-cards` (count: 1)
 * to draw one card at a time. After the first mandatory draw, `pass`
 * becomes available to stop drawing early. Once a player has drawn
 * their max or passed, they are done. When both are done, advance
 * to play-hazards.
 */
function handleDrawCards(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const isResourcePlayer = action.player === state.activePlayer;
  const actingIndex = getPlayerIndex(state, action.player);

  const drawnSoFar = isResourcePlayer ? mhState.resourceDrawCount : mhState.hazardDrawCount;
  const drawMax = isResourcePlayer ? mhState.resourceDrawMax : mhState.hazardDrawMax;
  const playerLabel = isResourcePlayer ? 'resource' : 'hazard';

  // Pass during deck exhaust exchange sub-flow: complete the exhaust
  if (action.type === 'pass' && state.players[actingIndex].deckExhaustPending) {
    logDetail(`Movement/Hazard draw-cards: ${playerLabel} player completed deck exhaust exchange`);
    return { state: completeDeckExhaust(state, actingIndex) };
  }

  // Pass: allowed after first mandatory draw, or if max is 0
  if (action.type === 'pass') {
    if (drawnSoFar === 0 && drawMax > 0) {
      return { state, error: `${playerLabel} player must draw at least 1 card before passing` };
    }

    logDetail(`Movement/Hazard draw-cards: ${playerLabel} player passed (drew ${drawnSoFar}/${drawMax})`);
    return advanceDrawCards(state, mhState, isResourcePlayer, drawMax);
  }

  // Deck exhaustion: enter exchange sub-flow
  if (action.type === 'deck-exhaust') {
    const exPlayer = state.players[actingIndex];
    if (exPlayer.playDeck.length > 0) {
      return { state, error: 'Cannot exhaust — play deck is not empty' };
    }
    if (exPlayer.discardPile.length === 0) {
      return { state, error: 'Cannot exhaust — discard pile is also empty' };
    }
    return { state: startDeckExhaust(state, actingIndex) };
  }

  // Exchange sideboard during deck exhaustion sub-flow
  if (action.type === 'exchange-sideboard') {
    return handleExchangeSideboard(state, action);
  }

  if (action.type !== 'draw-cards' || action.count !== 1) {
    return { state, error: `Expected 'draw-cards' (count: 1), 'deck-exhaust', 'exchange-sideboard', or 'pass' during draw-cards step, got '${action.type}'` };
  }

  if (drawnSoFar >= drawMax) {
    return { state, error: `${playerLabel} player has already drawn maximum (${drawMax}) cards` };
  }

  // Draw 1 card from play deck into hand
  const player = state.players[actingIndex];
  if (player.playDeck.length === 0) {
    logDetail(`Movement/Hazard draw-cards: ${playerLabel} player has no cards to draw`);
    return advanceDrawCards(state, mhState, isResourcePlayer, drawMax);
  }

  const drawnCard = player.playDeck[0];
  const newPlayers = clonePlayers(state);
  newPlayers[actingIndex] = {
    ...player,
    hand: [...player.hand, drawnCard],
    playDeck: player.playDeck.slice(1),
  };

  const newDrawCount = drawnSoFar + 1;
  logDetail(`Movement/Hazard draw-cards: ${playerLabel} player drew card ${newDrawCount}/${drawMax}`);

  const newMhState = {
    ...mhState,
    ...(isResourcePlayer
      ? { resourceDrawCount: newDrawCount }
      : { hazardDrawCount: newDrawCount }),
  };

  // If this player just hit their max, check if both are done
  if (newDrawCount >= drawMax) {
    const otherDone = isResourcePlayer
      ? newMhState.hazardDrawCount >= newMhState.hazardDrawMax
      : newMhState.resourceDrawCount >= newMhState.resourceDrawMax;

    if (otherDone) {
      logDetail(`Movement/Hazard draw-cards: both players done → advancing to play-hazards`);
      return {
        state: {
          ...state,
          players: newPlayers,
          phaseState: { ...newMhState, step: 'play-hazards' as const },
        },
      };
    }
  }

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: newMhState,
    },
  };
}

/**
 * Mark a player as done drawing and advance to play-hazards if both are done.
 */


/**
 * Mark a player as done drawing and advance to play-hazards if both are done.
 */
function advanceDrawCards(
  state: GameState,
  mhState: MovementHazardPhaseState,
  isResourcePlayer: boolean,
  drawMax: number,
): ReducerResult {
  // Mark this player as done by setting their draw count to max
  const newMhState = {
    ...mhState,
    ...(isResourcePlayer
      ? { resourceDrawCount: drawMax }
      : { hazardDrawCount: drawMax }),
  };

  const otherDone = isResourcePlayer
    ? newMhState.hazardDrawCount >= newMhState.hazardDrawMax
    : newMhState.resourceDrawCount >= newMhState.resourceDrawMax;

  if (otherDone) {
    logDetail(`Movement/Hazard draw-cards: both players done → advancing to play-hazards`);
    return {
      state: {
        ...state,
        phaseState: { ...newMhState, step: 'play-hazards' as const },
      },
    };
  }

  return {
    state: {
      ...state,
      phaseState: newMhState,
    },
  };
}

// handleMHWoundCorruptionCheck removed: wound corruption checks are
// now handled by `applyCorruptionCheckResolution` in
// `engine/pending-reducers.ts`.

/**
 * Handle all actions during the site phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the End-of-Turn phase.
 */

