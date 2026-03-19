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

function resolveCard(state: GameState, instanceId: CardInstanceId): RevealedCard {
  const inst = state.instanceMap[instanceId as string];
  return {
    instanceId,
    definitionId: inst?.definitionId ?? ('' as CardDefinitionId),
    known: true,
  };
}

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
