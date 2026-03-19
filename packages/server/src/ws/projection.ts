/**
 * @module projection
 *
 * Transforms the full, omniscient {@link GameState} into a per-player
 * {@link PlayerView} that hides information the requesting player should
 * not see.
 *
 * In MECCG, hidden information includes the opponent's hand contents, their
 * play deck order, and their planned movement destinations. The projection
 * layer enforces this boundary so the client can safely display everything
 * it receives without leaking secrets.
 *
 * Design note: the projection is computed on every state change and sent
 * over WebSocket. It is intentionally cheap — just object mapping, no deep
 * copies of large structures.
 */

import type {
  GameState,
  PlayerState,
  PlayerView,
  SelfView,
  OpponentView,
  OpponentCompanyView,
  RevealedCard,
  PlayerId,
  CardInstanceId,
  CardDefinitionId,
} from '@meccg/shared';
import { LEGAL_ACTIONS_BY_PHASE } from '@meccg/shared';

/**
 * Resolves a card instance to a {@link RevealedCard} containing both the
 * instance ID and its underlying definition ID. Used for cards the
 * requesting player is allowed to see (e.g. their own hand).
 */
function resolveCard(state: GameState, instanceId: CardInstanceId): RevealedCard {
  const inst = state.instanceMap[instanceId as string];
  return {
    instanceId,
    definitionId: inst?.definitionId ?? ('' as CardDefinitionId),
    known: true,
  };
}

/**
 * Builds the "self" portion of a player's view. The player can see their
 * own hand contents (resolved to definition IDs), discard pile, site deck,
 * sideboard, companies, and characters — but only the *size* of their play
 * deck (not its order).
 */
function buildSelfView(state: GameState, player: PlayerState): SelfView {
  return {
    id: player.id,
    name: player.name,
    wizard: player.wizard,
    hand: player.hand.map(id => resolveCard(state, id)),
    playDeckSize: player.playDeck.length,
    discardPile: player.discardPile.map(id => resolveCard(state, id)),
    siteDeck: player.siteDeck.map(id => resolveCard(state, id)),
    siteDiscardPile: player.siteDiscardPile.map(id => resolveCard(state, id)),
    sideboard: player.sideboard.map(id => resolveCard(state, id)),
    companies: player.companies,
    characters: player.characters,
    generalInfluenceUsed: player.generalInfluenceUsed,
    deckExhaustionCount: player.deckExhaustionCount,
  };
}

/**
 * Builds the "opponent" portion of a player's view. Hides the opponent's
 * hand contents (only the count is exposed), play deck order, and planned
 * movement destinations (replaced with a boolean `hasPlannedMovement` flag).
 * Public information — characters in play, company locations, discard piles —
 * is passed through.
 */
function buildOpponentView(player: PlayerState): OpponentView {
  const companies: OpponentCompanyView[] = player.companies.map(c => ({
    id: c.id,
    characters: c.characters,
    currentSite: c.currentSite,
    hasPlannedMovement: c.destinationSite !== null,
    moved: c.moved,
  }));

  return {
    id: player.id,
    name: player.name,
    wizard: player.wizard,
    handSize: player.hand.length,
    playDeckSize: player.playDeck.length,
    discardPile: [],  // TODO: discard pile is public
    siteDiscardPile: [],
    companies,
    characters: player.characters,
    generalInfluenceUsed: player.generalInfluenceUsed,
    deckExhaustionCount: player.deckExhaustionCount,
  };
}

/**
 * Projects the full game state into a single player's view.
 *
 * Determines which player is "self" and which is "opponent" based on the
 * provided player ID, builds the appropriate sub-views, attaches the
 * current phase state and legal action list, and returns the composite
 * {@link PlayerView} ready for serialisation and transmission.
 *
 * @param state - The authoritative server-side game state.
 * @param playerId - The player requesting their view.
 * @returns A redacted {@link PlayerView} safe to send to the client.
 */
export function projectPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  const selfIndex = state.players[0].id === playerId ? 0 : 1;
  const opponentIndex = 1 - selfIndex;

  const self = buildSelfView(state, state.players[selfIndex]);
  const opponent = buildOpponentView(state.players[opponentIndex]);

  const legalActions = LEGAL_ACTIONS_BY_PHASE[state.phaseState.phase];

  return {
    self,
    opponent,
    activePlayer: state.activePlayer,
    phaseState: state.phaseState,
    eventsInPlay: state.eventsInPlay,
    turnNumber: state.turnNumber,
    legalActions,
  };
}
