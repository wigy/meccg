/**
 * @module legal-actions/organization-sideboard
 *
 * Sideboard access actions during the organization phase (CoE rule 2.II.6).
 * A player can tap their avatar to fetch resource or character cards from
 * the sideboard to either the play deck (1 card) or the discard pile (up to 5).
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  PlayerState,
  CardDefinition,
} from '../../index.js';
import { requirePhaseState } from '../../state-utils.js';
import { CardStatus } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import { logDetail } from './log.js';
import { sideboardFetchSubflowActions } from './sideboard-subflow.js';
import { findPlayerAvatar, filterSideboardByDef, playerById, defById, selfSideboardToDeckMove } from '../reducer-utils.js';

/**
 * Card-granted sideboard self-relocation actions during the organization phase.
 * Independent of the CoE 2.II.6 avatar-tap access ({@link fetchFromSideboardActions}):
 * emits one `card-sideboard-to-deck` per card in the player's sideboard that
 * carries a `select: 'self'` sideboard→deck `move` effect. Taps nothing and has
 * no deck-size gate. Used by Terror Heralds Doom (ba-78).
 */
export function cardSideboardToDeckActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const actions: EvaluatedAction[] = [];
  for (const card of player.sideboard) {
    const def = defById(state, card.definitionId);
    if (!selfSideboardToDeckMove(def)) continue;
    logDetail(`Sideboard self-relocation: ${def?.name ?? card.definitionId} → play deck (viable)`);
    actions.push({
      action: { type: 'card-sideboard-to-deck', player: playerId, cardInstanceId: card.instanceId },
      viable: true,
    });
  }
  return actions;
}

/** Maximum number of sideboard cards fetchable to the discard pile per avatar tap. */
const MAX_SIDEBOARD_TO_DISCARD = 5;

/** Minimum play deck size required to fetch a sideboard card to deck. */
const MIN_DECK_SIZE_FOR_SIDEBOARD_TO_DECK = 5;

/**
 * Eligibility predicate for the CoE 2.II.6 sideboard fetch: resources and
 * characters may be fetched.
 */
function isFetchableSideboardDef(def: CardDefinition): boolean {
  return def.cardType.includes('character') || def.cardType.includes('resource');
}

/**
 * Returns eligible sideboard cards (resources and characters) for fetch
 * actions per CoE rule 2.II.6.
 */
function getEligibleSideboardCards(state: GameState, player: PlayerState) {
  return filterSideboardByDef(state, player.sideboard, isFetchableSideboardDef);
}

/**
 * Generates sideboard access actions during organization phase (CoE 2.II.6).
 *
 * Two-step flow:
 * 1. Intent: `start-sideboard-to-deck` or `start-sideboard-to-discard` (taps avatar)
 * 2. Selection: `fetch-from-sideboard` for each eligible card (destination locked in state)
 *
 * When no intent has been declared, generates the intent actions.
 * When an intent is active, generates only fetch actions (and pass for discard with >=1 fetched).
 */
export function fetchFromSideboardActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const orgState = requirePhaseState(state, Phase.Organization);
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  // ── Active sub-flow: generate fetch actions ──

  if (orgState.sideboardFetchDestination !== null) {
    return sideboardFetchSubflowActions(state, playerId, {
      destination: orgState.sideboardFetchDestination,
      fetched: orgState.sideboardFetchedThisTurn,
      maxToDiscard: MAX_SIDEBOARD_TO_DISCARD,
      fetchActionType: 'fetch-from-sideboard',
      isEligible: isFetchableSideboardDef,
      logPrefix: 'Sideboard access',
      guardWithPass: true,
    });
  }

  // ── No intent declared: generate start actions ──

  const avatar = findPlayerAvatar(state, player);
  if (!avatar || avatar.status !== CardStatus.Untapped) {
    logDetail('Sideboard access: no untapped avatar');
    return actions;
  }
  const avatarId = avatar.instanceId;

  const eligible = getEligibleSideboardCards(state, player);
  if (eligible.length === 0) {
    logDetail('Sideboard access: no eligible resources/characters in sideboard');
    return actions;
  }

  // Start-to-discard is always available with untapped avatar and eligible cards
  logDetail('Sideboard access: start-sideboard-to-discard available');
  actions.push({
    action: { type: 'start-sideboard-to-discard', player: playerId, characterInstanceId: avatarId },
    viable: true,
  });

  // Start-to-deck requires ≥5 cards in play deck
  if (player.playDeck.length >= MIN_DECK_SIZE_FOR_SIDEBOARD_TO_DECK) {
    logDetail('Sideboard access: start-sideboard-to-deck available');
    actions.push({
      action: { type: 'start-sideboard-to-deck', player: playerId, characterInstanceId: avatarId },
      viable: true,
    });
  }

  return actions;
}
