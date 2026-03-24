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
  CharacterDeckDraftPlayerState,
} from '@meccg/shared';
import { UNKNOWN_CARD, getPlayerIndex, Phase } from '@meccg/shared';
import { computeLegalActions } from '@meccg/shared';

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

/** Resolve an entire pile of card instances to revealed cards. */
function resolvePile(state: GameState, ids: readonly CardInstanceId[]): RevealedCard[] {
  return ids.map(id => resolveCard(state, id));
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
    alignment: player.alignment,
    wizard: player.wizard,
    hand: resolvePile(state, player.hand),
    playDeckSize: player.playDeck.length,
    discardPile: resolvePile(state, player.discardPile),
    siteDeck: resolvePile(state, player.siteDeck),
    siteDiscardPile: resolvePile(state, player.siteDiscardPile),
    sideboard: resolvePile(state, player.sideboard),
    eliminatedPile: resolvePile(state, player.eliminatedPile),
    companies: player.companies,
    characters: player.characters,
    cardsInPlay: player.cardsInPlay,
    marshallingPoints: player.marshallingPoints,
    generalInfluenceUsed: player.generalInfluenceUsed,
    deckExhaustionCount: player.deckExhaustionCount,
    lastDiceRoll: player.lastDiceRoll,
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
    siteCardOwned: c.siteCardOwned,
    hasPlannedMovement: c.destinationSite !== null,
    revealedDestinationSite: null,
    moved: c.moved,
    hasOnGuardCard: c.onGuardCards.length > 0,
  }));

  return {
    id: player.id,
    name: player.name,
    alignment: player.alignment,
    wizard: player.wizard,
    handSize: player.hand.length,
    playDeckSize: player.playDeck.length,
    siteDeckSize: player.siteDeck.length,
    discardPile: [],  // TODO: discard pile is public
    siteDiscardPile: [],
    eliminatedPile: [],  // TODO: eliminated pile is public
    companies,
    characters: player.characters,
    cardsInPlay: player.cardsInPlay,
    marshallingPoints: player.marshallingPoints,
    generalInfluenceUsed: player.generalInfluenceUsed,
    deckExhaustionCount: player.deckExhaustionCount,
    lastDiceRoll: player.lastDiceRoll,
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
    for (const id of player.eliminatedPile) addInstance(id);
    for (const company of player.companies) {
      if (company.currentSite) addInstance(company.currentSite);
    }
    for (const char of Object.values(player.characters)) {
      addInstance(char.instanceId);
      for (const item of char.items) addInstance(item.instanceId);
      for (const ally of char.allies) addInstance(ally.instanceId);
      for (const id of char.corruptionCards) addInstance(id);
    }
    for (const card of player.cardsInPlay) addInstance(card.instanceId);
  }

  return {
    self: {
      id: p1.id,
      name: p1.name,
      alignment: p1.alignment,
      wizard: p1.wizard,
      hand: [],
      playDeckSize: p1.playDeck.length,
      discardPile: [],
      siteDeck: [],
      siteDiscardPile: [],
      sideboard: [],
      eliminatedPile: [],
      companies: p1.companies,
      characters: p1.characters,
      cardsInPlay: p1.cardsInPlay,
      marshallingPoints: p1.marshallingPoints,
      generalInfluenceUsed: p1.generalInfluenceUsed,
      deckExhaustionCount: p1.deckExhaustionCount,
      lastDiceRoll: p1.lastDiceRoll,
    },
    opponent,
    activePlayer: state.activePlayer,
    phaseState: redactPhaseForSpectator(state.phaseState),
    combat: state.combat,
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
  if (phaseState.phase !== 'setup') return phaseState;

  const opponentIndex = 1 - selfIndex;
  const step = phaseState.setupStep;

  if (step.step === 'character-draft') {
    const newDraftState: [DraftPlayerState, DraftPlayerState] = [
      step.draftState[0],
      step.draftState[1],
    ];
    const oppPool = step.draftState[opponentIndex].pool;
    newDraftState[opponentIndex] = {
      ...step.draftState[opponentIndex],
      pool: oppPool.map(() => UNKNOWN_CARD),
      // Show that opponent has picked (face-down) without revealing what
      currentPick: step.draftState[opponentIndex].currentPick !== null ? UNKNOWN_CARD : null,
      // drafted stays visible — it's public after reveal
    };
    return { ...phaseState, setupStep: { ...step, draftState: newDraftState } };
  }

  if (step.step === 'character-deck-draft') {
    const newDeckDraftState: [CharacterDeckDraftPlayerState, CharacterDeckDraftPlayerState] = [
      step.deckDraftState[0],
      step.deckDraftState[1],
    ];
    newDeckDraftState[opponentIndex] = {
      ...step.deckDraftState[opponentIndex],
      remainingPool: step.deckDraftState[opponentIndex].remainingPool.map(() => UNKNOWN_CARD),
    };
    return { ...phaseState, setupStep: { ...step, deckDraftState: newDeckDraftState } };
  }

  return phaseState;
}

/**
 * Redacts draft state for spectators: both players' drafted and
 * set-aside are visible, but pools, picks, and starting items are hidden.
 */
function redactPhaseForSpectator(phaseState: PhaseState): PhaseState {
  if (phaseState.phase !== 'setup' || phaseState.setupStep.step !== 'character-draft') return phaseState;

  const step = phaseState.setupStep;
  const redact = (d: DraftPlayerState): DraftPlayerState => ({
    ...d,
    pool: d.pool.map(() => UNKNOWN_CARD),
    // drafted stays visible — it's public after reveal
    currentPick: null,
  });

  return {
    ...phaseState,
    setupStep: { ...step, draftState: [redact(step.draftState[0]), redact(step.draftState[1])] },
  };
}

export function projectPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  const selfIndex = getPlayerIndex(state, playerId);
  const opponentIndex = 1 - selfIndex;

  const selfPlayer = state.players[selfIndex];
  const opponentPlayer = state.players[opponentIndex];

  const self = buildSelfView(state, selfPlayer);
  let opponent = buildOpponentView(opponentPlayer);

  // Reveal the active company's destination site to the opponent when the
  // site has been revealed during this company's M/H sub-phase.
  if (state.phaseState.phase === Phase.MovementHazard) {
    const mhState = state.phaseState;
    if (mhState.siteRevealed && state.activePlayer !== playerId) {
      const activeCompany = opponentPlayer.companies[mhState.activeCompanyIndex];
      if (activeCompany?.destinationSite) {
        opponent = {
          ...opponent,
          companies: opponent.companies.map((c, i) =>
            i === mhState.activeCompanyIndex
              ? { ...c, revealedDestinationSite: activeCompany.destinationSite }
              : c,
          ),
        };
      }
    }
  }

  const legalActions = computeLegalActions(state, playerId);

  // Build visible instances map: all cards this player can see
  const visibleInstances: Record<string, CardDefinitionId> = {};

  const addInstance = (id: CardInstanceId) => {
    const inst = state.instanceMap[id as string];
    if (inst) {
      visibleInstances[id as string] = inst.definitionId;
    }
  };

  // Item draft: unassigned items are visible to their owner
  if (state.phaseState.phase === 'setup' && state.phaseState.setupStep.step === 'item-draft') {
    for (const id of state.phaseState.setupStep.itemDraftState[selfIndex].unassignedItems) addInstance(id);
  }

  // Site selection: selected sites are no longer in siteDeck but should still be visible
  if (state.phaseState.phase === 'setup' && state.phaseState.setupStep.step === 'starting-site-selection') {
    for (const id of state.phaseState.setupStep.siteSelectionState[selfIndex].selectedSites) addInstance(id);
  }

  // Own cards: hand, discard, site deck, sideboard, companies, characters + their attachments
  for (const id of selfPlayer.hand) addInstance(id);
  for (const id of selfPlayer.discardPile) addInstance(id);
  for (const id of selfPlayer.siteDeck) addInstance(id);
  for (const id of selfPlayer.siteDiscardPile) addInstance(id);
  for (const id of selfPlayer.sideboard) addInstance(id);
  for (const id of selfPlayer.eliminatedPile) addInstance(id);
  for (const company of selfPlayer.companies) {
    if (company.currentSite) addInstance(company.currentSite);
    if (company.destinationSite) addInstance(company.destinationSite);
    for (const id of company.movementPath) addInstance(id);
  }
  for (const char of Object.values(selfPlayer.characters)) {
    addInstance(char.instanceId);
    for (const item of char.items) addInstance(item.instanceId);
    for (const ally of char.allies) addInstance(ally.instanceId);
    for (const id of char.corruptionCards) addInstance(id);
  }
  for (const card of selfPlayer.cardsInPlay) addInstance(card.instanceId);

  // Opponent's public cards: discard piles, eliminated pile, characters + attachments, company sites
  for (const id of opponentPlayer.discardPile) addInstance(id);
  for (const id of opponentPlayer.siteDiscardPile) addInstance(id);
  for (const id of opponentPlayer.eliminatedPile) addInstance(id);
  for (const company of opponentPlayer.companies) {
    if (company.currentSite) addInstance(company.currentSite);
  }
  // Revealed destination site (opponent's active company during M/H phase)
  for (const company of opponent.companies) {
    if (company.revealedDestinationSite) addInstance(company.revealedDestinationSite);
  }
  for (const char of Object.values(opponentPlayer.characters)) {
    addInstance(char.instanceId);
    for (const item of char.items) addInstance(item.instanceId);
    for (const ally of char.allies) addInstance(ally.instanceId);
    for (const id of char.corruptionCards) addInstance(id);
  }
  for (const card of opponentPlayer.cardsInPlay) addInstance(card.instanceId);

  return {
    self,
    opponent,
    activePlayer: state.activePlayer,
    phaseState: redactPhaseForPlayer(state.phaseState, selfIndex),
    combat: state.combat,
    eventsInPlay: state.eventsInPlay,
    turnNumber: state.turnNumber,
    legalActions,
    visibleInstances,
  };
}
