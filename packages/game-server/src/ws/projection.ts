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
  CardInstanceId,
  CardDefinitionId,
  PhaseState,
  DraftPlayerState,
  CharacterDeckDraftPlayerState,
} from '@meccg/shared';
import { UNKNOWN_INSTANCE, UNKNOWN_CARD, UNKNOWN_SITE, getPlayerIndex, Phase, SetupStep } from '@meccg/shared';
import { computeLegalActions } from '@meccg/shared';

/**
 * Builds a flat map of all instance IDs the player is allowed to see,
 * resolved to their definition IDs. This covers piles, characters, items,
 * phase-state cards (draft pools, site selections, combat, chain, etc.)
 * so the client can resolve any instance ID referenced by legal actions.
 */
function buildVisibleInstanceMap(
  state: GameState,
  selfIndex: number,
  redactedPhase: PhaseState,
): Record<string, CardDefinitionId> {
  const map: Record<string, CardDefinitionId> = {};

  const addInst = (id: CardInstanceId) => {
    if (id === UNKNOWN_INSTANCE || map[id as string]) return;
    const inst = state.instanceMap[id as string];
    if (inst) map[id as string] = inst.definitionId;
  };

  const addPile = (ids: readonly CardInstanceId[]) => {
    for (const id of ids) addInst(id);
  };

  // Both players' piles, characters, items, companies
  for (const player of state.players) {
    addPile(player.hand);
    addPile(player.playDeck);
    addPile(player.discardPile);
    addPile(player.siteDeck);
    addPile(player.siteDiscardPile);
    addPile(player.sideboard);
    addPile(player.killPile);
    addPile(player.eliminatedPile);
    for (const char of Object.values(player.characters)) {
      addInst(char.instanceId);
      for (const item of char.items) addInst(item.instanceId);
      for (const ally of char.allies) addInst(ally.instanceId);
      addPile(char.corruptionCards);
    }
    for (const c of player.companies) {
      if (c.currentSite) addInst(c.currentSite.instanceId);
      if (c.destinationSite) addInst(c.destinationSite);
      addPile(c.movementPath);
      addPile(c.onGuardCards);
      if (c.siteOfOrigin) addInst(c.siteOfOrigin);
    }
    for (const c of player.cardsInPlay) addInst(c.instanceId);
  }

  // Phase-state instance IDs (uses the redacted phase so hidden IDs stay hidden)
  if (redactedPhase.phase === 'setup') {
    const step = redactedPhase.setupStep;
    if (step.step === SetupStep.CharacterDraft) {
      for (const ds of step.draftState) {
        addPile(ds.pool);
        addPile(ds.drafted);
        if (ds.currentPick) addInst(ds.currentPick);
      }
      addPile(step.setAside);
    } else if (step.step === SetupStep.ItemDraft) {
      for (const ds of step.itemDraftState) addPile(ds.unassignedItems);
      for (const rp of step.remainingPool) addPile(rp);
    } else if (step.step === SetupStep.CharacterDeckDraft) {
      for (const ds of step.deckDraftState) addPile(ds.remainingPool);
    } else if (step.step === SetupStep.StartingSiteSelection) {
      for (const ss of step.siteSelectionState) addPile(ss.selectedSites);
    }
  }

  // Combat state
  if (state.combat) {
    if (state.combat.attackSource.type === 'creature') addInst(state.combat.attackSource.instanceId);
    if (state.combat.attackSource.type === 'agent') addInst(state.combat.attackSource.instanceId);
    if (state.combat.attackSource.type === 'automatic-attack') addInst(state.combat.attackSource.siteInstanceId);
    for (const sa of state.combat.strikeAssignments) addInst(sa.characterId);
  }

  // Chain state
  if (state.chain) {
    for (const entry of state.chain.entries) {
      if (entry.cardInstanceId) addInst(entry.cardInstanceId);
      if (entry.payload.type === 'short-event' && entry.payload.targetInstanceId) {
        addInst(entry.payload.targetInstanceId);
      }
    }
  }

  // Events in play
  for (const e of state.eventsInPlay) addInst(e.instanceId);

  return map;
}

/**
 * Resolves a card instance to a {@link ViewCard} containing both the
 * instance ID and its underlying definition ID. Used for cards the
 * requesting player is allowed to see (e.g. their own hand).
 */
function resolveCard(state: GameState, instanceId: CardInstanceId): ViewCard {
  const inst = state.instanceMap[instanceId as string];
  return {
    instanceId,
    definitionId: inst?.definitionId ?? ('' as CardDefinitionId),
  };
}

/** Resolve an entire pile of card instances to view cards. */
function resolvePile(state: GameState, ids: readonly CardInstanceId[]): ViewCard[] {
  return ids.map(id => resolveCard(state, id));
}

/** Creates a hidden card pile of the given length using the `UNKNOWN_CARD` sentinel. */
function hiddenCardPile(length: number): readonly ViewCard[] {
  return Array.from({ length }, () => ({ instanceId: UNKNOWN_INSTANCE, definitionId: UNKNOWN_CARD }));
}

/** Creates a hidden site pile of the given length using the `UNKNOWN_SITE` sentinel. */
function hiddenSitePile(length: number): readonly ViewCard[] {
  return Array.from({ length }, () => ({ instanceId: UNKNOWN_INSTANCE, definitionId: UNKNOWN_SITE }));
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
    playDeck: hiddenCardPile(player.playDeck.length),
    discardPile: resolvePile(state, player.discardPile),
    siteDeck: resolvePile(state, player.siteDeck),
    siteDiscardPile: resolvePile(state, player.siteDiscardPile),
    sideboard: resolvePile(state, player.sideboard),
    killPile: resolvePile(state, player.killPile),
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
 * hand contents, play deck, site deck, and sideboard (represented as arrays
 * of {@link UNKNOWN_INSTANCE}), and redacts planned movement destinations
 * to a boolean `hasPlannedMovement` flag.
 * Public information — characters in play, company locations, discard piles —
 * is passed through.
 */
function buildOpponentView(state: GameState, player: PlayerState): OpponentView {
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
    hand: hiddenCardPile(player.hand.length),
    playDeck: hiddenCardPile(player.playDeck.length),
    siteDeck: hiddenSitePile(player.siteDeck.length),
    discardPile: resolvePile(state, player.discardPile),
    siteDiscardPile: resolvePile(state, player.siteDiscardPile),
    killPile: resolvePile(state, player.killPile),
    eliminatedPile: resolvePile(state, player.eliminatedPile),
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
      playDeck: hiddenCardPile(p1.playDeck.length),
      discardPile: [],
      siteDeck: [],
      siteDiscardPile: [],
      sideboard: [],
      killPile: [],
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
    chain: state.chain,
    eventsInPlay: state.eventsInPlay,
    turnNumber: state.turnNumber,
    startingPlayer: state.startingPlayer,
    stateSeq: state.stateSeq,
    legalActions: [],
    instanceMap: {},
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
      pool: oppPool.map(() => UNKNOWN_INSTANCE),
      // Show that opponent has picked (face-down) without revealing what
      currentPick: step.draftState[opponentIndex].currentPick !== null ? UNKNOWN_INSTANCE : null,
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
      remainingPool: step.deckDraftState[opponentIndex].remainingPool.map(() => UNKNOWN_INSTANCE),
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
    pool: d.pool.map(() => UNKNOWN_INSTANCE),
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

  const legalActions = computeLegalActions(state, playerId);
  const redactedPhase = redactPhaseForPlayer(state.phaseState, selfIndex);
  const instanceMap = buildVisibleInstanceMap(state, selfIndex, redactedPhase);

  return {
    self,
    opponent,
    activePlayer: state.activePlayer,
    phaseState: redactedPhase,
    combat: state.combat,
    chain: state.chain,
    eventsInPlay: state.eventsInPlay,
    turnNumber: state.turnNumber,
    startingPlayer: state.startingPlayer,
    stateSeq: state.stateSeq,
    legalActions,
    instanceMap,
  };
}
