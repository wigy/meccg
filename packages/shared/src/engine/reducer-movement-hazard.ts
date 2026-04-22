/**
 * @module reducer-movement-hazard
 *
 * Movement/Hazard phase handlers for the game reducer. Covers company selection,
 * site revelation, hazard play, creature keying, on-guard placement, draw cards,
 * and hand reset sub-steps.
 */

import type { GameState, MovementHazardPhaseState, Company, CreatureCard, GameAction, CombatState } from '../index.js';
import type { AhuntAttackEffect, CallCouncilEffect } from '../types/effects.js';
import { triggerCouncilCall } from './reducer-end-of-turn.js';
import type { CardInstanceId } from '../types/common.js';
import { Phase, CardStatus, isCharacterCard, isSiteCard, isResourceEventCard, RegionType, Race, Skill, getPlayerIndex, BASE_MAX_REGION_DISTANCE, hasPlayFlag } from '../index.js';
import { resolveHandSize, collectCharacterEffects, resolveDrawModifier } from './effects/index.js';
import { resolveAttackProwess, resolveAttackStrikes } from './effects/resolver.js';
import type { ResolverContext } from './effects/index.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { logDetail } from './legal-actions/log.js';
import { initiateChain, pushChainEntry } from './chain-reducer.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { clonePlayers, startDeckExhaust, completeDeckExhaust, handleExchangeSideboard, cleanupEmptyCompanies, autoMergeNonHavenCompanies, updatePlayer, updateCharacter, wrongActionType } from './reducer-utils.js';
import { handlePlayShortEvent, handlePlayResourceShortEvent } from './reducer-events.js';
import { handlePlayPermanentEvent } from './reducer-events.js';
import { handleGrantActionApply } from './reducer-organization.js';
import { sweepExpired, addConstraint, enqueueCorruptionCheck } from './pending.js';
import { buildInPlayNames } from './recompute-derived.js';
import { isDetainmentAttack } from './detainment.js';


/**
 * Handle actions during the Movement/Hazard phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the Site phase.
 */
type MHHandler = (state: GameState, action: GameAction, mhState: MovementHazardPhaseState) => ReducerResult;

/**
 * Per-step dispatch for the Movement/Hazard phase. Pending wound corruption
 * checks (Barrow-wight et al.) are intercepted by the unified
 * pending-resolution dispatcher before this table is consulted.
 */
const MH_STEP_HANDLERS: Readonly<Record<MovementHazardPhaseState['step'], MHHandler>> = {
  'select-company': handleSelectCompany,
  'reveal-new-site': handleRevealNewSite,
  'set-hazard-limit': handleSetHazardLimit,
  'order-effects': handleOrderEffectsStep,
  'draw-cards': handleDrawCards,
  'play-hazards': handlePlayHazards,
  'reset-hand': handleResetHand,
};

export function handleMovementHazard(state: GameState, action: GameAction): ReducerResult {
  const mhState = state.phaseState as MovementHazardPhaseState;
  const handler = MH_STEP_HANDLERS[mhState.step];
  if (!handler) return { state, error: `Unexpected step '${mhState.step as string}' in movement/hazard phase` };
  return handler(state, action, mhState);
}

/**
 * Snapshot the hazard limit at site reveal and advance to order-effects.
 * Per METD §5, this snapshot is the locked baseline for the rest of the
 * company's M/H phase; post-reveal modifiers accumulate via
 * currentHazardLimit() rather than mutating it.
 */
function handleSetHazardLimit(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'pass') return wrongActionType(state, action, 'pass', 'set-hazard-limit step');
  const playerIndex = getPlayerIndex(state, action.player);
  const company = state.players[playerIndex].companies[mhState.activeCompanyIndex];
  const { limit, preRevealConstraintIds } = snapshotHazardLimit(state, company);
  logDetail(`Movement/Hazard: hazard limit snapshot ${limit} → advancing to order-effects`);
  return {
    state: {
      ...state,
      phaseState: {
        ...mhState,
        step: 'order-effects' as const,
        hazardLimitAtReveal: limit,
        preRevealHazardLimitConstraintIds: preRevealConstraintIds,
      },
    },
  };
}

/** Advance from the order-effects step once the hazard player passes. */
function handleOrderEffectsStep(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'pass') return wrongActionType(state, action, 'pass', 'order-effects step');
  return handleOrderEffects(state, mhState);
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

    // Both passed → fire end-of-MH corruption triggers, then end this company's M/H phase
    if (newMhState.resourcePlayerPassed && newMhState.hazardPlayerPassed) {
      const withChecks = fireEndOfCompanyMHCorruptionChecks(state, newMhState);
      return endCompanyMH(withChecks, newMhState);
    }

    logDetail(`Play-hazards: ${isResourcePlayer ? 'resource' : 'hazard'} player passed`);
    return { state: { ...state, phaseState: newMhState } };
  }

  // --- Play hazard ---
  if (action.type === 'play-hazard') {
    return handlePlayHazardCard(state, action, mhState);
  }

  // --- Resource permanent event (e.g. Gates of Morning, rule 2.1.1) ---
  if (action.type === 'play-permanent-event') {
    return handlePlayPermanentEvent(state, action);
  }

  // --- Short event ---
  // Route by card type: resource short-events (hero or minion, e.g.
  // Marvels Told, Voices of Malice) go through the resource handler so
  // their tap cost and discard-in-play target resolve inline. Hazard
  // short-events (e.g. Twilight canceling an environment) go through
  // the chain-initiating hazard handler.
  if (action.type === 'play-short-event') {
    const actingPlayer = state.players.find(p => p.id === action.player);
    const handCard = actingPlayer?.hand.find(c => c.instanceId === action.cardInstanceId);
    const def = handCard ? state.cardPool[handCard.definitionId as string] : undefined;
    if (isResourceEventCard(def)) {
      return handlePlayResourceShortEvent(state, action);
    }
    return handlePlayShortEvent(state, action);
  }

  // --- Granted-action (e.g. Cram untap-bearer; Great Ship
  //     cancel-chain-entry; River ranger-cancel — all via the shared
  //     handler that resolves the apply from either the source card's
  //     grant-action effect or an active granted-action constraint). ---
  if (action.type === 'activate-granted-action') {
    return handleGrantActionApply(state, action);
  }

  // --- Place on-guard ---
  if (action.type === 'place-on-guard') {
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
  if (action.type !== 'play-hazard') return wrongActionType(state, action, 'play-hazard');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];

  const cardIdx = hazardPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  const handCard = hazardPlayer.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
  if (!def) return { state, error: 'Card definition not found' };

  // --- Resource-as-hazard (e.g. Sudden Call) with call-council effect ---
  // Playing a resource-event as a hazard on the opponent's turn, solely
  // to trigger the endgame. Bypasses the chain: the effect resolves
  // immediately with the Sudden Call player getting one last turn.
  const defEffects = 'effects' in def ? def.effects : undefined;
  const hazardCallCouncil = defEffects?.find(
    (e): e is CallCouncilEffect => e.type === 'call-council' && e.lastTurnFor === 'self',
  );
  if (hazardCallCouncil
    && (def.cardType === 'hero-resource-event' || def.cardType === 'minion-resource-event')
    && hasPlayFlag(def, 'playable-as-hazard')) {
    logDetail(`Play-hazards: ${action.player as string} plays resource-as-hazard "${def.name}" → triggering endgame (caller gets last turn)`);
    const newHand = [...hazardPlayer.hand];
    newHand.splice(cardIdx, 1);
    const afterDiscard = updatePlayer(state, hazardIndex, p => ({
      ...p,
      hand: newHand,
      discardPile: [...p.discardPile, handCard],
    }));
    return { state: triggerCouncilCall(afterDiscard, action.player, 'self') };
  }

  // --- Creature handling (via chain of effects) ---
  if (def.cardType === 'hazard-creature') {
    const keyError = checkCreatureKeying(def, mhState);
    if (keyError) return { state, error: keyError };

    const raceExempt = isCreatureRaceExempt(state, action, def);
    const newHazardCount = raceExempt ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1;
    logDetail(`Play-hazards: hazard player plays creature "${def.name}" (${newHazardCount}/${currentHazardLimit(state, mhState, action.targetCompanyId)})${raceExempt ? ` [race "${def.race}" exempt from hazard limit]` : ''} — initiating chain`);

    // Remove card from hand — it resides on the chain entry until combat resolves
    const newHand = [...hazardPlayer.hand];
    newHand.splice(cardIdx, 1);

    let newState: GameState = {
      ...updatePlayer(state, hazardIndex, p => ({ ...p, hand: newHand })),
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: newHazardCount,
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
    logDetail(`Play-hazards: hazard player plays short-event "${def.name}" (${newHazardCount}/${currentHazardLimit(state, mhState, action.targetCompanyId)})${bypassesLimit ? ' [no-hazard-limit]' : ''}`);

    // Move card from hand to discard (short events are discarded after resolution)
    const newHand = [...hazardPlayer.hand];
    newHand.splice(cardIdx, 1);

    let newState: GameState = {
      ...updatePlayer(state, hazardIndex, p => ({
        ...p,
        hand: newHand,
        discardPile: [...p.discardPile, handCard],
      })),
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: newHazardCount,
        resourcePlayerPassed: false,
      },
    };

    // creature-race-choice: add constraint for the chosen race
    if (action.type === 'play-hazard' && action.chosenCreatureRace && def.effects) {
      const activePlayerId = newState.activePlayer;
      if (activePlayerId) {
        const activeIndex = newState.players[0].id === activePlayerId ? 0 : 1;
        const targetCompany = newState.players[activeIndex].companies[mhState.activeCompanyIndex];
        if (targetCompany) {
          logDetail(`Short-event "${def.name}": adding creature-type-no-hazard-limit constraint for race "${action.chosenCreatureRace}" on company ${targetCompany.id as string}`);
          newState = addConstraint(newState, {
            source: handCard.instanceId,
            sourceDefinitionId: handCard.definitionId,
            scope: { kind: 'company-mh-phase', companyId: targetCompany.id },
            target: { kind: 'company', companyId: targetCompany.id },
            kind: { type: 'creature-type-no-hazard-limit', exemptRace: action.chosenCreatureRace },
          });
        }
      }
    }

    // Initiate chain or push onto existing chain
    const shortEventPayload: import('../index.js').ChainEntryPayload = {
      type: 'short-event',
      ...(action.type === 'play-hazard' && action.targetFactionInstanceId
        ? { targetFactionInstanceId: action.targetFactionInstanceId }
        : {}),
      ...(action.type === 'play-hazard' && action.targetCharacterId
        ? { targetCharacterId: action.targetCharacterId }
        : {}),
    };
    if (newState.chain === null) {
      newState = initiateChain(newState, action.player, handCard, shortEventPayload);
    } else {
      newState = pushChainEntry(newState, action.player, handCard, shortEventPayload);
    }

    return { state: newState };
  }

  // --- Hazard-corruption handling (attaches to character like permanent events) ---
  if (def.cardType === 'hazard-corruption') {
    logDetail(`Play-hazards: hazard player plays corruption "${def.name}" (${mhState.hazardsPlayedThisCompany + 1}/${currentHazardLimit(state, mhState, action.targetCompanyId)}) → enters chain`);
    const newHand = [...hazardPlayer.hand];
    newHand.splice(cardIdx, 1);
    let newState: GameState = {
      ...updatePlayer(state, hazardIndex, p => ({ ...p, hand: newHand })),
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: mhState.hazardsPlayedThisCompany + 1,
        resourcePlayerPassed: false,
      },
    };
    const payload: import('../index.js').ChainEntryPayload = {
      type: 'permanent-event',
      targetCharacterId: action.type === 'play-hazard' ? action.targetCharacterId : undefined,
    };
    if (newState.chain === null) {
      newState = initiateChain(newState, action.player, handCard, payload);
    } else {
      newState = pushChainEntry(newState, action.player, handCard, payload);
    }
    return { state: newState };
  }

  // --- Event handling (long / permanent) ---
  // The narrowing here is load-bearing for downstream `def.eventType` access.
  if (def.cardType !== 'hazard-event' || (def.eventType !== 'long' && def.eventType !== 'permanent')) {
    return { state, error: `Unsupported hazard card type during play-hazards` };
  }

  logDetail(`Play-hazards: hazard player plays ${def.eventType}-event "${def.name}" (${mhState.hazardsPlayedThisCompany + 1}/${currentHazardLimit(state, mhState, action.targetCompanyId)}) → enters chain`);

  // Remove card from hand — it now resides on the chain
  const newHand = [...hazardPlayer.hand];
  newHand.splice(cardIdx, 1);

  let newState: GameState = {
    ...updatePlayer(state, hazardIndex, p => ({ ...p, hand: newHand })),
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
  if (action.type !== 'place-on-guard') return wrongActionType(state, action, 'place-on-guard');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const activeIdx = getPlayerIndex(state, state.activePlayer!);
  const targetCompanyId = state.players[activeIdx].companies[mhState.activeCompanyIndex].id;

  const cardIdx = hazardPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  const handCard = hazardPlayer.hand[cardIdx];

  logDetail(`Play-hazards: hazard player places on-guard card "${action.cardInstanceId}" (${mhState.hazardsPlayedThisCompany + 1}/${currentHazardLimit(state, mhState, targetCompanyId)})`);

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
 * Fires end-of-company-MH corruption checks for characters with attached
 * hazards carrying `on-event: end-of-company-mh`. Enqueues one corruption
 * check per region traversed in the site path for each matching character.
 */
function fireEndOfCompanyMHCorruptionChecks(
  state: GameState,
  mhState: MovementHazardPhaseState,
): GameState {
  const regionCount = mhState.resolvedSitePath.length;
  if (regionCount === 0) return state;

  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[activeIndex];
  const company = resourcePlayer.companies[mhState.activeCompanyIndex];

  let newState = state;
  for (const charId of company.characters) {
    const char = resourcePlayer.characters[charId as string];
    if (!char) continue;
    for (const hazard of char.hazards) {
      const hDef = newState.cardPool[hazard.definitionId as string];
      if (!hDef || !('effects' in hDef) || !hDef.effects) continue;
      for (const effect of hDef.effects) {
        if (effect.type !== 'on-event') continue;
        const onEvent = effect;
        if (onEvent.event !== 'end-of-company-mh') continue;
        if (onEvent.apply.type !== 'force-check' || onEvent.apply.check !== 'corruption') continue;

        logDetail(`end-of-company-mh: "${hDef.name}" triggers ${regionCount} corruption check(s) for character ${charId as string}`);
        const possessions = [
          ...char.items.map(i => i.instanceId),
          ...char.allies.map(a => a.instanceId),
          ...char.hazards.map(h => h.instanceId),
        ];
        for (let i = 0; i < regionCount; i++) {
          newState = enqueueCorruptionCheck(newState, {
            source: hazard.instanceId,
            actor: state.activePlayer!,
            scope: { kind: 'phase', phase: Phase.MovementHazard },
            characterId: charId,
            reason: `${hDef.name} (region ${i + 1}/${regionCount})`,
            possessions,
          });
        }
      }
    }
  }
  return newState;
}

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

    // Handle site of origin (CoE rule 2.IV.vii): if no sibling company is
    // still at the origin, either discard it (tapped non-haven) or return it
    // to the location deck (untapped or haven).
    let newSiteDeck = [...resourcePlayer.siteDeck];
    const newSiteDiscardPile = [...resourcePlayer.siteDiscardPile];
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
        const isTapped = originSite.status === CardStatus.Tapped;
        newSiteDeck = newSiteDeck.filter(c => c.instanceId !== originSite.instanceId);
        const entry = { instanceId: originSite.instanceId, definitionId: originSite.definitionId };
        if (!isHaven && isTapped) {
          logDetail(`Step 8: site of origin is tapped non-haven — discarding to site discard pile`);
          newSiteDiscardPile.push(entry);
        } else if (isHaven) {
          logDetail(`Step 8: site of origin is a haven — returning to location deck`);
          newSiteDeck.push(entry);
        } else {
          logDetail(`Step 8: site of origin is untapped non-haven — returning to location deck`);
          newSiteDeck.push(entry);
        }
      }
    }

    logDetail(`Step 8: company moved to ${mhState.destinationSiteName ?? '?'}, origin site handled`);
    newPlayers[activeIndex] = {
      ...resourcePlayer,
      companies: updatedCompanies,
      siteDeck: newSiteDeck,
      siteDiscardPile: newSiteDiscardPile,
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

  // --- Step 8a-2: Fire bearer-company-moves discard ---
  // When a company has moved, discard any character items with an
  // on-event: bearer-company-moves + discard-self effect (e.g. Align Palantír).
  if (company.destinationSite && !mhState.returnedToOrigin) {
    const movedCompany = newPlayers[activeIndex].companies[mhState.activeCompanyIndex];
    let discardedAny = false;
    for (const charId of movedCompany.characters) {
      const charData = newPlayers[activeIndex].characters[charId as string];
      if (!charData) continue;
      const itemsToKeep: import('../index.js').ItemInPlay[] = [];
      const itemsToDiscard: import('../index.js').CardInstance[] = [];
      for (const item of charData.items) {
        const itemDef = state.cardPool[item.definitionId as string];
        const hasTrigger = itemDef && 'effects' in itemDef &&
          (itemDef as { effects?: readonly import('../index.js').CardEffect[] }).effects?.some(
            e => e.type === 'on-event' && e.event === 'bearer-company-moves' &&
                 e.apply.type === 'discard-self',
          );
        if (hasTrigger) {
          logDetail(`bearer-company-moves: discarding "${itemDef?.name ?? item.definitionId}" from ${charId as string}`);
          itemsToDiscard.push({ instanceId: item.instanceId, definitionId: item.definitionId });
        } else {
          itemsToKeep.push(item);
        }
      }
      if (itemsToDiscard.length > 0) {
        discardedAny = true;
        newPlayers[activeIndex] = {
          ...newPlayers[activeIndex],
          characters: {
            ...newPlayers[activeIndex].characters,
            [charId as string]: { ...charData, items: itemsToKeep },
          },
          discardPile: [...newPlayers[activeIndex].discardPile, ...itemsToDiscard],
        };
      }
    }
    if (discardedAny) {
      logDetail('bearer-company-moves: finished discarding items from moving company');
    }
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
            kind = { type: 'site-phase-do-nothing' };
            break;
          case 'no-creature-hazards-on-company':
            kind = { type: 'no-creature-hazards-on-company' };
            break;
          case 'deny-scout-resources':
            kind = { type: 'deny-scout-resources' };
            break;
          case 'granted-action': {
            const payload = effect.apply.grantedAction;
            if (!payload) continue;
            kind = {
              type: 'granted-action',
              action: payload.action,
              phase: payload.phase as import('../types/state-phases.js').Phase | undefined,
              window: payload.window,
              cost: payload.cost,
              when: payload.when,
              apply: payload.apply,
            };
            break;
          }
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
          const updatedAllies = char.allies.filter(a => a.instanceId !== ally.instanceId);
          newState = updatePlayer(newState, pIdx, p => ({
            ...updateCharacter(p, charInstId, c => ({ ...c, allies: updatedAllies })),
            discardPile: [...p.discardPile, { instanceId: ally.instanceId, definitionId: ally.definitionId }],
          }));
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
  if (action.type !== 'discard-card') return wrongActionType(state, action, 'discard-card', 'reset-hand step');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  const discardedCard = player.hand[cardIdx];
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const updatedState = updatePlayer(state, playerIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: [...p.discardPile, discardedCard],
  }));

  logDetail(`Reset-hand: player ${player.name} discards 1 card (hand now ${newHand.length})`);

  // Check if both players are now at hand size
  if (updatedState.players.every((p, i) => p.hand.length <= resolveHandSize(updatedState, i))) {
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
    return {
      state: cleanupEmptyCompanies({
        ...updatePlayer(mergedState, activeIndex, p => ({
          ...p,
          companies: p.companies.map(c => ({ ...c, moved: false, specialMovement: undefined, extraRegionDistance: undefined })),
        })),
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
        hazardLimitAtReveal: 0,
        preRevealHazardLimitConstraintIds: [],
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
        ahuntAttacksResolved: 0,
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

  const playerIndex = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[playerIndex];
  const companyIndex = player.companies.findIndex(c => c.id === action.companyId);
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
 * Snapshot the company's hazard limit at the moment its new site is
 * revealed (CoE step 3, rule 2.IV.iii; METD §5). The result is the
 * "pre-reveal" baseline that subsequent post-reveal modifiers add to.
 *
 * The base equals max(companySize, 2), halved (rounded up) if the hazard
 * player accessed the sideboard during this turn's untap phase, plus any
 * `hazard-limit-modifier` constraints that already exist at this moment.
 * Returned alongside the IDs of the constraints that were folded in, so
 * the running limit can avoid double-counting them.
 */
function snapshotHazardLimit(
  state: GameState,
  company: Company,
): { limit: number; preRevealConstraintIds: readonly string[] } {
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

  const preRevealConstraintIds: string[] = [];
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type === 'hazard-limit-modifier'
        && constraint.target.kind === 'company'
        && constraint.target.companyId === company.id) {
      const prev = limit;
      limit += constraint.kind.value;
      preRevealConstraintIds.push(constraint.id);
      logDetail(`Hazard limit modified by ${constraint.kind.value} (${constraint.sourceDefinitionId as string}): ${prev} → ${limit}`);
    }
  }
  limit = Math.max(limit, 0);

  logDetail(`Hazard limit at reveal: ${limit}`);
  return { limit, preRevealConstraintIds };
}

/**
 * The company's running hazard limit at any point during its M/H phase.
 *
 * Equals the at-reveal snapshot ({@link MovementHazardPhaseState.hazardLimitAtReveal})
 * plus any `hazard-limit-modifier` constraints introduced *after* the
 * snapshot. Pre-reveal constraints are skipped because their value is
 * already folded into the snapshot.
 *
 * Per METD §5, post-reveal modifiers take effect for future hazard plays
 * in resolution order; they do not retroactively cancel hazards already
 * announced.
 */
export function currentHazardLimit(
  state: GameState,
  mhState: MovementHazardPhaseState,
  companyId: import('../types/common.js').CompanyId,
): number {
  let limit = mhState.hazardLimitAtReveal;
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'hazard-limit-modifier') continue;
    if (constraint.target.kind !== 'company') continue;
    if (constraint.target.companyId !== companyId) continue;
    if (mhState.preRevealHazardLimitConstraintIds.includes(constraint.id)) continue;
    limit += constraint.kind.value;
  }
  return Math.max(limit, 0);
}

/**
 * Collect all ahunt-attack effects from both players' cardsInPlay that
 * match the current company's movement path. Returns an array of
 * { instanceId, effect } pairs, one per matching long-event.
 */
function collectMatchingAhuntAttacks(
  state: GameState,
  mhState: MovementHazardPhaseState,
): { instanceId: CardInstanceId; effect: AhuntAttackEffect }[] {
  const pathNames = mhState.resolvedSitePathNames;
  const pathTypes = mhState.resolvedSitePath as readonly string[];
  if (pathNames.length === 0) return [];

  const inPlayNames = buildInPlayNames(state);
  const results: { instanceId: CardInstanceId; effect: AhuntAttackEffect }[] = [];

  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = state.cardPool[card.definitionId as string];
      if (!def || !('effects' in def) || !def.effects) continue;

      for (const effect of def.effects) {
        if (effect.type !== 'ahunt-attack') continue;

        const extendedApplies = effect.extended
          && matchesCondition(effect.extended.when, { inPlay: inPlayNames } as Record<string, unknown>);

        const regionNames = extendedApplies && effect.extended
          ? [...effect.regionNames, ...(effect.extended.regionNames ?? [])]
          : [...effect.regionNames];
        const regionTypes = extendedApplies && effect.extended
          ? [...(effect.regionTypes ?? []), ...(effect.extended.regionTypes ?? [])]
          : [...(effect.regionTypes ?? [])];

        const nameMatch = regionNames.some(rn => pathNames.includes(rn));
        const typeMatch = regionTypes.some(rt => pathTypes.includes(rt));

        if (nameMatch || typeMatch) {
          results.push({ instanceId: card.instanceId, effect });
        }
      }
    }
  }

  return results;
}

/**
 * Handle the order-effects step (CoE step 4).
 *
 * Scans cardsInPlay for ahunt-attack long-events whose region lists
 * overlap the current company's movement path. Each matching ahunt
 * effect initiates a creature-like combat (one at a time, tracked by
 * ahuntAttacksResolved). After all ahunt combats are resolved,
 * transitions to draw-cards.
 */
function handleOrderEffects(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const matchingAhunts = collectMatchingAhuntAttacks(state, mhState);

  if (mhState.ahuntAttacksResolved >= matchingAhunts.length) {
    return transitionToDrawCards(state, mhState);
  }

  const { instanceId, effect } = matchingAhunts[mhState.ahuntAttacksResolved];
  const defId = resolveInstanceId(state, instanceId);
  const defName = defId ? (state.cardPool[defId as string]?.name ?? 'unknown') : 'unknown';

  logDetail(`Order-effects: ahunt attack ${mhState.ahuntAttacksResolved + 1}/${matchingAhunts.length} — ${defName}`);

  const activePlayerIndex = state.players.findIndex(p => p.id === state.activePlayer);
  const company = state.players[activePlayerIndex].companies[mhState.activeCompanyIndex];
  if (!company) {
    logDetail(`Order-effects: no active company — skipping ahunt`);
    return transitionToDrawCards(state, mhState);
  }

  const hazardPlayerId = state.players.find(p => p.id !== state.activePlayer)!.id;

  const inPlayNames = buildInPlayNames(state);
  const effectiveProwess = resolveAttackProwess(state, effect.prowess, inPlayNames, effect.race, false);
  const effectiveStrikes = resolveAttackStrikes(state, effect.strikes, inPlayNames, effect.race);

  const attackerChooses = effect.combatRules?.includes('attacker-chooses-defenders') ?? false;
  if (attackerChooses) {
    logDetail(`Ahunt attack has attacker-chooses-defenders`);
  }

  const combat: CombatState = {
    attackSource: { type: 'ahunt', longEventInstanceId: instanceId },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayerId,
    strikesTotal: effectiveStrikes,
    strikeProwess: effectiveProwess,
    creatureBody: effect.body,
    creatureRace: effect.race,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: attackerChooses ? 'cancel-window' : 'defender',
    bodyCheckTarget: null,
    detainment: isDetainmentAttack({
      attackRace: effect.race as Race,
      defendingAlignment: state.players[activePlayerIndex].alignment,
    }),
  };

  logDetail(`Ahunt combat initiated: ${defName} (${effect.strikes} strikes${effectiveStrikes !== effect.strikes ? ` → ${effectiveStrikes}` : ''}, ${effect.prowess} prowess${effectiveProwess !== effect.prowess ? ` → ${effectiveProwess}` : ''}) vs company ${company.id as string}`);

  return {
    state: {
      ...state,
      combat,
      phaseState: {
        ...mhState,
        ahuntAttacksResolved: mhState.ahuntAttacksResolved + 1,
      },
    },
  };
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

  // Apply draw-modifier effects from company characters (e.g. Alatar reduces hazard draws)
  const drawContext: ResolverContext = { reason: 'draw-modifier' };
  const allDrawEffects = company.characters.flatMap(charInstId => {
    const char = player.characters[charInstId as string];
    if (!char) return [];
    return collectCharacterEffects(state, char, drawContext);
  });
  const hazardMod = resolveDrawModifier(allDrawEffects, 'hazard');
  if (hazardMod.adjustment !== 0) {
    const before = hazardDrawMax;
    hazardDrawMax = Math.max(hazardMod.min, hazardDrawMax + hazardMod.adjustment);
    logDetail(`draw-modifier: hazard draws ${before} → ${hazardDrawMax} (adjustment ${hazardMod.adjustment}, min ${hazardMod.min})`);
  }
  const resourceMod = resolveDrawModifier(allDrawEffects, 'resource');
  if (resourceMod.adjustment !== 0) {
    const before = resourceDrawMax;
    resourceDrawMax = Math.max(resourceMod.min, resourceDrawMax + resourceMod.adjustment);
    logDetail(`draw-modifier: resource draws ${before} → ${resourceDrawMax} (adjustment ${resourceMod.adjustment}, min ${resourceMod.min})`);
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

  if (action.type === 'pass') {
    logDetail(`Movement/Hazard draw-cards: ${playerLabel} player passed (drew ${drawnSoFar}/${drawMax})`);
    return advanceDrawCards(state, mhState, isResourcePlayer, drawMax);
  }

  if (action.type === 'deck-exhaust') {
    return { state: startDeckExhaust(state, actingIndex) };
  }

  if (action.type === 'exchange-sideboard') {
    return handleExchangeSideboard(state, action);
  }

  if (action.type !== 'draw-cards' || action.count !== 1) {
    return { state, error: `Expected 'draw-cards' (count: 1), 'deck-exhaust', 'exchange-sideboard', or 'pass' during draw-cards step, got '${action.type}'` };
  }

  // Draw 1 card from play deck into hand
  const player = state.players[actingIndex];
  if (player.playDeck.length === 0) {
    logDetail(`Movement/Hazard draw-cards: ${playerLabel} player has no cards to draw`);
    return advanceDrawCards(state, mhState, isResourcePlayer, drawMax);
  }

  const drawnCard = player.playDeck[0];
  const drawnState = updatePlayer(state, actingIndex, p => ({
    ...p,
    hand: [...p.hand, drawnCard],
    playDeck: p.playDeck.slice(1),
  }));

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
          ...drawnState,
          phaseState: { ...newMhState, step: 'play-hazards' as const },
        },
      };
    }
  }

  return {
    state: {
      ...drawnState,
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
 * Check whether a creature's race is exempted from the hazard limit by
 * a `creature-type-no-hazard-limit` constraint on the target company.
 */
function isCreatureRaceExempt(state: GameState, action: GameAction, def: CreatureCard): boolean {
  if (action.type !== 'play-hazard') return false;
  if (!state.activeConstraints) return false;
  return state.activeConstraints.some(
    c => c.target.kind === 'company'
      && c.target.companyId === action.targetCompanyId
      && c.kind.type === 'creature-type-no-hazard-limit'
      && c.kind.exemptRace === def.race,
  );
}

/**
 * Handle all actions during the site phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the End-of-Turn phase.
 */

