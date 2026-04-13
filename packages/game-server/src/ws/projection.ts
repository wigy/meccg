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
  ViewCard,
  PlayerId,
  CardInstance,
  CardInstanceId,
  CardDefinitionId,
  PhaseState,
  DraftPlayerState,
  CharacterDeckDraftPlayerState,
} from '@meccg/shared';
import { UNKNOWN_CARD, UNKNOWN_SITE, getPlayerIndex, Phase } from '@meccg/shared';
import { computeLegalActions } from '@meccg/shared';

/** Convert a pile of card instances to view cards (structurally identical). */
function toViewCards(pile: readonly CardInstance[]): ViewCard[] {
  return pile.map(c => ({ instanceId: c.instanceId, definitionId: c.definitionId }));
}

/** Redacts a pile of card instances: keeps real instance IDs, replaces definition with UNKNOWN_CARD. */
function hiddenCardPile(pile: readonly { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId }[]): readonly ViewCard[] {
  return pile.map(c => ({ instanceId: c.instanceId, definitionId: UNKNOWN_CARD }));
}

/** Redacts a pile of site instances: keeps real instance IDs, replaces definition with UNKNOWN_SITE. */
function hiddenSitePile(pile: readonly CardInstance[]): readonly ViewCard[] {
  return pile.map(c => ({ instanceId: c.instanceId, definitionId: UNKNOWN_SITE }));
}

/**
 * Builds the "self" portion of a player's view. The player can see their
 * own hand contents (resolved to definition IDs), discard pile, site deck,
 * sideboard, companies, and characters — but only the *size* of their play
 * deck (not its order).
 */
function buildSelfView(_state: GameState, player: PlayerState): SelfView {
  // Redact on-guard card identities — the resource player must not see
  // what the hazard player placed face-down at their companies.
  // Revealed cards keep their identity; unrevealed cards are hidden.
  const companies = player.companies.map(c =>
    c.onGuardCards.length > 0
      ? { ...c, onGuardCards: c.onGuardCards.map(og => og.revealed ? og : { ...og, definitionId: UNKNOWN_CARD }) }
      : c,
  );
  return {
    id: player.id,
    name: player.name,
    alignment: player.alignment,
    wizard: player.wizard,
    hand: toViewCards(player.hand),
    playDeck: hiddenCardPile(player.playDeck),
    discardPile: toViewCards(player.discardPile),
    siteDeck: toViewCards(player.siteDeck),
    siteDiscardPile: toViewCards(player.siteDiscardPile),
    sideboard: toViewCards(player.sideboard),
    killPile: toViewCards(player.killPile),
    eliminatedPile: toViewCards(player.eliminatedPile),
    storedItems: toViewCards(player.storedItems),
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
 * Builds the "opponent" portion of a player's view. Hides the opponent's
 * hand contents, play deck, site deck, and sideboard (represented as arrays
 * of {@link UNKNOWN_INSTANCE}), and redacts planned movement destinations
 * to a boolean `hasPlannedMovement` flag.
 * Public information — characters in play, company locations, discard piles —
 * is passed through.
 */
function buildOpponentView(_state: GameState, player: PlayerState): OpponentView {
  const companies: OpponentCompanyView[] = player.companies.map(c => ({
    id: c.id,
    characters: c.characters,
    currentSite: c.currentSite,
    siteCardOwned: c.siteCardOwned,
    hasPlannedMovement: c.destinationSite !== null,
    revealedDestinationSite: null,
    moved: c.moved,
    onGuardCards: c.onGuardCards.map(og =>
      og.revealed
        ? { instanceId: og.instanceId, definitionId: og.definitionId, revealed: true }
        : { instanceId: og.instanceId, definitionId: UNKNOWN_CARD },
    ),
  }));

  return {
    id: player.id,
    name: player.name,
    alignment: player.alignment,
    wizard: player.wizard,
    hand: hiddenCardPile(player.hand),
    playDeck: hiddenCardPile(player.playDeck),
    siteDeck: hiddenSitePile(player.siteDeck),
    discardPile: hiddenCardPile(player.discardPile),
    siteDiscardPile: toViewCards(player.siteDiscardPile),
    killPile: toViewCards(player.killPile),
    eliminatedPile: toViewCards(player.eliminatedPile),
    storedItems: toViewCards(player.storedItems),
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

  const _self = buildOpponentView(state, p1);
  const opponent = buildOpponentView(state, p2);

  return {
    self: {
      id: p1.id,
      name: p1.name,
      alignment: p1.alignment,
      wizard: p1.wizard,
      hand: [],
      playDeck: hiddenCardPile(p1.playDeck),
      discardPile: [],
      siteDeck: [],
      siteDiscardPile: [],
      sideboard: [],
      killPile: [],
      eliminatedPile: [],
      storedItems: [],
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
    chain: state.chain,
    pendingEffects: state.pendingEffects,
    turnNumber: state.turnNumber,
    selfIndex: 0,
    startingPlayer: state.startingPlayer,
    stateSeq: state.stateSeq,
    legalActions: [],
    activeConstraints: state.activeConstraints,
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
      pool: hiddenCardPile(oppPool),
      // Show that opponent has picked (face-down) without revealing what
      currentPick: step.draftState[opponentIndex].currentPick !== null ? { instanceId: step.draftState[opponentIndex].currentPick.instanceId, definitionId: UNKNOWN_CARD } : null,
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
      remainingPool: hiddenCardPile(step.deckDraftState[opponentIndex].remainingPool),
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
    pool: hiddenCardPile(d.pool),
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
  let opponent = buildOpponentView(state, opponentPlayer);

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

  // The hazard player (non-active) can see on-guard cards they placed on
  // the opponent's companies. Reveal full identities in the opponent view.
  if (state.activePlayer !== playerId) {
    const hasOnGuard = opponentPlayer.companies.some(c => c.onGuardCards.length > 0);
    if (hasOnGuard) {
      opponent = {
        ...opponent,
        companies: opponent.companies.map((c, i) => ({
          ...c,
          onGuardCards: opponentPlayer.companies[i].onGuardCards.map(og => ({ instanceId: og.instanceId, definitionId: og.definitionId, revealed: og.revealed })),
        })),
      };
    }
  }

  const legalActions = computeLegalActions(state, playerId);
  const redactedPhase = redactPhaseForPlayer(state.phaseState, selfIndex);

  return {
    self,
    opponent,
    activePlayer: state.activePlayer,
    phaseState: redactedPhase,
    combat: state.combat,
    chain: state.chain,
    pendingEffects: state.pendingEffects,
    turnNumber: state.turnNumber,
    selfIndex,
    startingPlayer: state.startingPlayer,
    stateSeq: state.stateSeq,
    legalActions,
    activeConstraints: state.activeConstraints,
  };
}
