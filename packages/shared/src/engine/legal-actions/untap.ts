/**
 * @module legal-actions/untap
 *
 * Legal actions during the untap phase. The engine handles untapping
 * automatically; the active (resource) player confirms with pass.
 *
 * The non-active (hazard) player may access their sideboard if the
 * resource player's avatar is in play (CoE 2.I). This is a two-step
 * flow: declare intent (to deck or to discard), then select cards.
 * Accessing the sideboard halves the hazard limit for the upcoming
 * movement/hazard phase.
 *
 * Ordinary hand cards cannot be played during the untap phase, but a
 * card whose own text grants "any phase the company is at a site" timing
 * (A Chance Meeting tw-188, We Have Come to Kill le-252) is an exception —
 * see {@link recruitViaEventActions}. Sudden Call (le-235) is another: its
 * resource-side play is offered here per CoE rule 2.1.1 — see
 * {@link resourceCallCouncilActions}.
 */

import type { GameState, PlayerId, EvaluatedAction, UntapPhaseState, PlayerState, CardDefinition, CardInstanceId } from '../../index.js';
import { CardStatus } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import { logDetail } from './log.js';
import { notPlayable } from './action-builders.js';
import { sideboardFetchSubflowActions } from './sideboard-subflow.js';
import { findPlayerAvatar, filterSideboardByDef, playerById, activePlayerState, defById } from '../reducer-utils.js';
import { isResourceEventCard } from '../../types/cards.js';
import { canCallEndgameNow } from '../../state-utils.js';
import { grantedActionActivations } from './organization.js';
import { recruitViaEventActions } from './recruit-via-event.js';

/** Maximum hazard cards that can be fetched to discard per untap. */
const MAX_HAZARD_SIDEBOARD_TO_DISCARD = 5;

/** Minimum play deck size required to fetch a hazard to deck. */
const MIN_DECK_SIZE_FOR_HAZARD_TO_DECK = 5;

/**
 * Checks whether the active player has a non-inverted avatar in play.
 * The hazard player can only access their sideboard if this is true.
 */
function activePlayerHasAvatar(state: GameState): boolean {
  const activePlayer = activePlayerState(state);
  if (!activePlayer) return false;
  const avatar = findPlayerAvatar(state, activePlayer);
  return avatar !== undefined && avatar.status !== CardStatus.Inverted;
}

/** Eligibility predicate for the CoE 2.I hazard sideboard fetch: hazards only. */
function isHazardDef(def: CardDefinition): boolean {
  return def.cardType.includes('hazard');
}

/**
 * Returns eligible hazard cards from the sideboard per CoE rule 2.I.
 */
function getEligibleHazardCards(state: GameState, player: PlayerState) {
  return filterSideboardByDef(state, player.sideboard, isHazardDef);
}

export function untapActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  if (state.phaseState.phase !== Phase.Untap) return [];

  const untapState = state.phaseState;
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  const isActivePlayer = state.activePlayer === playerId;

  // ── Hazard player (non-active) actions ──
  if (!isActivePlayer) {
    // If hazard player already passed, no more actions
    if (untapState.hazardPlayerPassed) {
      logDetail('Untap phase: hazard player already passed');
      return actions;
    }

    // Active hazard sideboard sub-flow: only fetch actions (+ pass for discard with ≥1 fetched)
    if (untapState.hazardSideboardDestination !== null) {
      return hazardSideboardFetchActions(state, playerId, untapState);
    }

    // Check if hazard sideboard intent actions are available (once per untap)
    if (!untapState.hazardSideboardAccessed && activePlayerHasAvatar(state)) {
      const eligible = getEligibleHazardCards(state, player);
      if (eligible.length > 0) {
        logDetail('Untap: hazard player may access sideboard (resource avatar in play)');

        // Start-to-discard always available
        actions.push({
          action: { type: 'start-hazard-sideboard-to-discard', player: playerId },
          viable: true,
        });

        // Start-to-deck requires ≥5 cards in play deck
        if (player.playDeck.length >= MIN_DECK_SIZE_FOR_HAZARD_TO_DECK) {
          actions.push({
            action: { type: 'start-hazard-sideboard-to-deck', player: playerId },
            viable: true,
          });
        }
      }
    }

    // Hazard player can always pass (decline sideboard access)
    actions.push({ action: { type: 'pass', player: playerId }, viable: true });

    logDetail(`Untap phase: ${actions.length} action(s) for hazard player ${playerId as string}`);
    return actions;
  }

  // ── Active (resource) player actions ──

  // If hazard sideboard sub-flow is active, resource player waits
  if (untapState.hazardSideboardDestination !== null) {
    logDetail('Untap phase: resource player waiting for hazard sideboard sub-flow');
    return actions;
  }

  // If not yet untapped, offer the untap action
  if (!untapState.untapped) {
    actions.push({ action: { type: 'untap', player: playerId }, viable: true });
    logDetail(`Untap phase: untap action available for player ${playerId as string}`);
  } else {
    // Already untapped — waiting for hazard player to pass
    logDetail('Untap phase: resource player already untapped, waiting for hazard player');
  }

  // Rule 2.1.1: resource player may activate any-phase grant-actions (e.g.
  // Gandalf tapping to test a gold ring in his company, tw-156) during any
  // phase of their own turn, including the untap phase.
  actions.push(...grantedActionActivations(state, playerId, 'anyPhase'));

  // CRF 22 (A Chance Meeting tw-188): "May be played on your turn during any
  // phase the company is at a site" — this includes the untap phase, since a
  // company remains "at" its site (rule 2.IV.5) from the end of last turn's
  // movement/hazard phase through the whole of this turn's untap phase, well
  // before any new destination is revealed. Character-recruitment events are
  // therefore also offered here via {@link recruitViaEventActions}.
  const recruitViaEventEvaluated = recruitViaEventActions(state, playerId);
  actions.push(...recruitViaEventEvaluated);
  const recruitViaEventInstances = new Set<string>();
  for (const ea of recruitViaEventEvaluated) {
    const a = ea.action as { characterInstanceId?: CardInstanceId; viaEventInstanceId?: CardInstanceId };
    if (a.characterInstanceId) recruitViaEventInstances.add(a.characterInstanceId as string);
    if (a.viaEventInstanceId) recruitViaEventInstances.add(a.viaEventInstanceId as string);
  }

  // Rule 2.1.1: resource short-events may be played during any phase of the
  // resource player's turn — Sudden Call's resource-side council call
  // (le-235, rule 10.2.R1 "on a player's own turn") included.
  const callCouncilEvaluated = resourceCallCouncilActions(state, player);
  actions.push(...callCouncilEvaluated);
  const handledInstances = new Set(recruitViaEventInstances);
  for (const ea of callCouncilEvaluated) {
    const a = ea.action as { cardInstanceId?: CardInstanceId };
    if (a.cardInstanceId) handledInstances.add(a.cardInstanceId as string);
  }

  for (const handCard of player.hand) {
    if (handledInstances.has(handCard.instanceId as string)) continue;
    actions.push(notPlayable(playerId, handCard.instanceId, 'Cards cannot be played during the untap phase'));
  }
  logDetail(`Untap phase: ${player.hand.length - handledInstances.size} hand card(s) marked not playable`);

  return actions;
}

/**
 * Resource-side `call-council` short-events (Sudden Call, le-235) in the
 * resource player's hand. Applies the same gate as the organization and
 * long-event phases: the caller must meet the end-of-game conditions
 * (CoE rule 10.2) and the endgame must not already have been called.
 */
function resourceCallCouncilActions(state: GameState, player: PlayerState): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  for (const handCard of player.hand) {
    const def = defById(state, handCard.definitionId);
    if (!isResourceEventCard(def) || def.eventType !== 'short') continue;
    const callsCouncil = def.effects?.some(e => e.type === 'call-council' && e.lastTurnFor === 'opponent');
    if (!callsCouncil) continue;
    if (!canCallEndgameNow(player, state.gameLength ?? 'short')) {
      logDetail(`${def.name}: caller has not met end-of-game conditions`);
      actions.push(notPlayable(player.id, handCard.instanceId, `${def.name}: end-of-game conditions not met`));
      continue;
    }
    if (player.freeCouncilCalled || state.lastTurnFor !== null) {
      logDetail(`${def.name}: endgame already called`);
      actions.push(notPlayable(player.id, handCard.instanceId, `${def.name}: endgame already called`));
      continue;
    }
    logDetail(`Untap phase: resource short-event "${def.name}" playable — caller meets end-of-game conditions`);
    actions.push({
      action: { type: 'play-short-event', player: player.id, cardInstanceId: handCard.instanceId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Generate fetch actions during the active hazard sideboard sub-flow.
 */
function hazardSideboardFetchActions(
  state: GameState,
  playerId: PlayerId,
  untapState: UntapPhaseState,
): EvaluatedAction[] {
  if (untapState.hazardSideboardDestination === null) return [];
  return sideboardFetchSubflowActions(state, playerId, {
    destination: untapState.hazardSideboardDestination,
    fetched: untapState.hazardSideboardFetched,
    maxToDiscard: MAX_HAZARD_SIDEBOARD_TO_DISCARD,
    fetchActionType: 'fetch-hazard-from-sideboard',
    isEligible: isHazardDef,
    logPrefix: 'Hazard sideboard',
    guardWithPass: false,
  });
}
