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
  PhaseState,
  DraftPlayerState,
} from '@meccg/shared';
import { UNKNOWN_CARD } from '@meccg/shared';
import { computeLegalActions } from '../engine/legal-actions/index.js';

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
    marshallingPoints: player.marshallingPoints,
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
    marshallingPoints: player.marshallingPoints,
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
/**
 * Projects the game state for a spectator who sees both players as opponents.
 * No hands, site decks, or sideboards are visible — only public information.
 */
export function projectSpectatorView(state: GameState): PlayerView {
  const p1 = state.players[0];
  const p2 = state.players[1];

  const _self = buildOpponentView(p1);
  const opponent = buildOpponentView(p2);

  // Spectators see only public cards: characters, items, company sites, discard piles
  const visibleInstances: Record<string, CardDefinitionId> = {};
  const addInstance = (id: CardInstanceId) => {
    const inst = state.instanceMap[id as string];
    if (inst) {
      visibleInstances[id as string] = inst.definitionId;
    }
  };

  for (const player of state.players) {
    for (const id of player.discardPile) addInstance(id);
    for (const id of player.siteDiscardPile) addInstance(id);
    for (const company of player.companies) {
      addInstance(company.currentSite);
    }
    for (const char of Object.values(player.characters)) {
      addInstance(char.instanceId);
      for (const id of char.items) addInstance(id);
      for (const id of char.allies) addInstance(id);
      for (const id of char.corruptionCards) addInstance(id);
    }
  }

  return {
    self: {
      id: p1.id,
      name: p1.name,
      wizard: p1.wizard,
      hand: [],
      playDeckSize: p1.playDeck.length,
      discardPile: [],
      siteDeck: [],
      siteDiscardPile: [],
      sideboard: [],
      companies: p1.companies,
      characters: p1.characters,
      marshallingPoints: p1.marshallingPoints,
      generalInfluenceUsed: p1.generalInfluenceUsed,
      deckExhaustionCount: p1.deckExhaustionCount,
    },
    opponent,
    activePlayer: state.activePlayer,
    phaseState: redactPhaseForSpectator(state.phaseState),
    eventsInPlay: state.eventsInPlay,
    turnNumber: state.turnNumber,
    legalActions: [],
    visibleInstances,
  };
}

/**
 * Redacts phase-specific state for spectators. During the character draft,
 * pools, picks, and starting minor items are hidden — spectators only see
 * the round number, what's been drafted (public after reveal), and set-aside.
 */
/**
 * Redacts draft state for a player: own pool/drafted visible,
 * opponent's pool and pick hidden, but opponent's drafted visible
 * (public info after reveal).
 */
function redactPhaseForPlayer(phaseState: PhaseState, selfIndex: number): PhaseState {
  if (phaseState.phase !== 'character-draft') return phaseState;

  const opponentIndex = 1 - selfIndex;
  const newDraftState: [DraftPlayerState, DraftPlayerState] = [
    phaseState.draftState[0],
    phaseState.draftState[1],
  ];
  const oppPool = phaseState.draftState[opponentIndex].pool;
  newDraftState[opponentIndex] = {
    ...phaseState.draftState[opponentIndex],
    pool: oppPool.map(() => UNKNOWN_CARD),
    currentPick: null,
    startingMinorItems: [],
    // drafted stays visible — it's public after reveal
  };

  return { ...phaseState, draftState: newDraftState };
}

/**
 * Redacts draft state for spectators: both players' drafted and
 * set-aside are visible, but pools, picks, and starting items are hidden.
 */
function redactPhaseForSpectator(phaseState: PhaseState): PhaseState {
  if (phaseState.phase !== 'character-draft') return phaseState;

  const redact = (d: DraftPlayerState): DraftPlayerState => ({
    ...d,
    pool: d.pool.map(() => UNKNOWN_CARD),
    // drafted stays visible — it's public after reveal
    currentPick: null,
    startingMinorItems: [],
  });

  return {
    ...phaseState,
    draftState: [redact(phaseState.draftState[0]), redact(phaseState.draftState[1])],
  };
}

export function projectPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  const selfIndex = state.players[0].id === playerId ? 0 : 1;
  const opponentIndex = 1 - selfIndex;

  const selfPlayer = state.players[selfIndex];
  const opponentPlayer = state.players[opponentIndex];

  const self = buildSelfView(state, selfPlayer);
  const opponent = buildOpponentView(opponentPlayer);

  const legalActions = computeLegalActions(state, playerId);

  // Build visible instances map: all cards this player can see
  const visibleInstances: Record<string, CardDefinitionId> = {};

  const addInstance = (id: CardInstanceId) => {
    const inst = state.instanceMap[id as string];
    if (inst) {
      visibleInstances[id as string] = inst.definitionId;
    }
  };

  // Own cards: hand, discard, site deck, sideboard, companies, characters + their attachments
  for (const id of selfPlayer.hand) addInstance(id);
  for (const id of selfPlayer.discardPile) addInstance(id);
  for (const id of selfPlayer.siteDeck) addInstance(id);
  for (const id of selfPlayer.siteDiscardPile) addInstance(id);
  for (const id of selfPlayer.sideboard) addInstance(id);
  for (const company of selfPlayer.companies) {
    addInstance(company.currentSite);
    if (company.destinationSite) addInstance(company.destinationSite);
    for (const id of company.movementPath) addInstance(id);
  }
  for (const char of Object.values(selfPlayer.characters)) {
    addInstance(char.instanceId);
    for (const id of char.items) addInstance(id);
    for (const id of char.allies) addInstance(id);
    for (const id of char.corruptionCards) addInstance(id);
  }

  // Opponent's public cards: discard piles, characters + attachments, company sites
  for (const id of opponentPlayer.discardPile) addInstance(id);
  for (const id of opponentPlayer.siteDiscardPile) addInstance(id);
  for (const company of opponentPlayer.companies) {
    addInstance(company.currentSite);
  }
  for (const char of Object.values(opponentPlayer.characters)) {
    addInstance(char.instanceId);
    for (const id of char.items) addInstance(id);
    for (const id of char.allies) addInstance(id);
    for (const id of char.corruptionCards) addInstance(id);
  }

  return {
    self,
    opponent,
    activePlayer: state.activePlayer,
    phaseState: redactPhaseForPlayer(state.phaseState, selfIndex),
    eventsInPlay: state.eventsInPlay,
    turnNumber: state.turnNumber,
    legalActions,
    visibleInstances,
  };
}
