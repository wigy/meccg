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
  OrganizationPhaseState,
} from '../../index.js';
import { CardStatus } from '../../index.js';
import { logDetail } from './log.js';
import { findPlayerAvatar, filterSideboardByDef } from '../reducer-utils.js';

/** Maximum number of sideboard cards fetchable to the discard pile per avatar tap. */
const MAX_SIDEBOARD_TO_DISCARD = 5;

/** Minimum play deck size required to fetch a sideboard card to deck. */
const MIN_DECK_SIZE_FOR_SIDEBOARD_TO_DECK = 5;

/**
 * Returns eligible sideboard cards (resources and characters) for fetch
 * actions per CoE rule 2.II.6.
 */
function getEligibleSideboardCards(state: GameState, player: PlayerState) {
  return filterSideboardByDef(
    state,
    player.sideboard,
    def => def.cardType.includes('character') || def.cardType.includes('resource'),
  );
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
  const orgState = state.phaseState as OrganizationPhaseState;
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  // ── Active sub-flow: generate fetch actions ──

  if (orgState.sideboardFetchDestination === 'deck') {
    if (orgState.sideboardFetchedThisTurn >= 1) {
      logDetail('Sideboard access: already fetched 1 card to deck this turn');
      return actions;
    }
    // Must pick exactly 1 card — no pass
    const eligible = getEligibleSideboardCards(state, player);
    for (const card of eligible) {
      logDetail(`Sideboard access: ${card.name} → play deck (viable)`);
      actions.push({
        action: { type: 'fetch-from-sideboard', player: playerId, sideboardCardInstanceId: card.instanceId },
        viable: true,
      });
    }
    return actions;
  }

  if (orgState.sideboardFetchDestination === 'discard') {
    if (orgState.sideboardFetchedThisTurn >= MAX_SIDEBOARD_TO_DISCARD) {
      logDetail('Sideboard access: already fetched 5 cards to discard this turn');
      return actions;
    }
    const eligible = getEligibleSideboardCards(state, player);
    for (const card of eligible) {
      logDetail(`Sideboard access: ${card.name} → discard pile (viable)`);
      actions.push({
        action: { type: 'fetch-from-sideboard', player: playerId, sideboardCardInstanceId: card.instanceId },
        viable: true,
      });
    }
    // Pass available after at least 1 card fetched
    if (orgState.sideboardFetchedThisTurn >= 1) {
      actions.push({ action: { type: 'pass', player: playerId }, viable: true });
    }
    return actions;
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
