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
 */

import type { GameState, PlayerId, EvaluatedAction, UntapPhaseState, CardInstanceId } from '../../index.js';
import { Phase, CardStatus, isCharacterCard } from '../../index.js';
import { logDetail } from './log.js';
import { resolveDef } from '../effects/index.js';

/** Maximum hazard cards that can be fetched to discard per untap. */
const MAX_HAZARD_SIDEBOARD_TO_DISCARD = 5;

/** Minimum play deck size required to fetch a hazard to deck. */
const MIN_DECK_SIZE_FOR_HAZARD_TO_DECK = 5;

/**
 * Checks whether a card definition is a hazard — the card types eligible
 * for hazard sideboard access per CoE rule 2.I.
 */
function isHazardEligible(cardType: string): boolean {
  return cardType.includes('hazard');
}

/**
 * Checks whether the active player has an avatar (wizard/ringwraith) in play.
 * The hazard player can only access their sideboard if this is true.
 */
function activePlayerHasAvatar(state: GameState): boolean {
  const activePlayer = state.players.find(p => p.id === state.activePlayer);
  if (!activePlayer) return false;
  for (const char of Object.values(activePlayer.characters)) {
    const def = resolveDef(state, char.instanceId);
    if (isCharacterCard(def) && def.mind === null && char.status !== CardStatus.Inverted) {
      return true;
    }
  }
  return false;
}

/**
 * Returns eligible hazard cards from the sideboard.
 */
function getEligibleHazardCards(
  state: GameState,
  player: { readonly sideboard: readonly CardInstanceId[] },
): { instanceId: CardInstanceId; name: string }[] {
  const result: { instanceId: CardInstanceId; name: string }[] = [];
  for (const cardId of player.sideboard) {
    const def = resolveDef(state, cardId);
    if (def && isHazardEligible(def.cardType)) {
      result.push({ instanceId: cardId, name: def.name });
    }
  }
  return result;
}

export function untapActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  if (state.phaseState.phase !== Phase.Untap) return [];

  const untapState = state.phaseState;
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  const isActivePlayer = state.activePlayer === playerId;

  // ── Hazard player (non-active) actions ──
  if (!isActivePlayer) {
    // Active hazard sideboard sub-flow: only fetch actions (+ pass for discard with ≥1 fetched)
    if (untapState.hazardSideboardDestination !== null) {
      return hazardSideboardFetchActions(state, playerId, untapState);
    }

    // Check if hazard sideboard intent actions are available
    if (activePlayerHasAvatar(state)) {
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

  // If hazard sideboard sub-flow is active, resource player must wait
  if (untapState.hazardSideboardDestination !== null) {
    logDetail('Untap phase: resource player waiting for hazard sideboard sub-flow');
    return actions;
  }

  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  logDetail(`Untap phase: pass available for player ${playerId as string}`);

  for (const cardInstanceId of player.hand) {
    actions.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId },
      viable: false,
      reason: 'Cards cannot be played during the untap phase',
    });
  }
  logDetail(`Untap phase: ${player.hand.length} hand card(s) marked not playable`);

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
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  if (untapState.hazardSideboardDestination === 'deck') {
    if (untapState.hazardSideboardFetched >= 1) {
      logDetail('Hazard sideboard: already fetched 1 card to deck');
      return actions;
    }
    // Must pick exactly 1 — no pass
    const eligible = getEligibleHazardCards(state, player);
    for (const card of eligible) {
      logDetail(`Hazard sideboard: ${card.name} → play deck (viable)`);
      actions.push({
        action: { type: 'fetch-hazard-from-sideboard', player: playerId, sideboardCardInstanceId: card.instanceId },
        viable: true,
      });
    }
    return actions;
  }

  if (untapState.hazardSideboardDestination === 'discard') {
    if (untapState.hazardSideboardFetched >= MAX_HAZARD_SIDEBOARD_TO_DISCARD) {
      logDetail('Hazard sideboard: already fetched 5 cards to discard');
      return actions;
    }
    const eligible = getEligibleHazardCards(state, player);
    for (const card of eligible) {
      logDetail(`Hazard sideboard: ${card.name} → discard pile (viable)`);
      actions.push({
        action: { type: 'fetch-hazard-from-sideboard', player: playerId, sideboardCardInstanceId: card.instanceId },
        viable: true,
      });
    }
    // Pass available after at least 1 card fetched
    if (untapState.hazardSideboardFetched >= 1) {
      actions.push({ action: { type: 'pass', player: playerId }, viable: true });
    }
    return actions;
  }

  return actions;
}
