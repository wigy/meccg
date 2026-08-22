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
  OpponentAgentView,
  ViewCard,
  PlayerId,
  CardInstance,
  CardInstanceId,
  CardDefinitionId,
  PhaseState,
  DraftPlayerState,
  CharacterDeckDraftPlayerState,
} from '@meccg/shared';
import { UNKNOWN_CARD, UNKNOWN_SITE, getPlayerIndex, Phase, effectiveGeneralInfluence, PALLANDO, THE_GREAT_HUNT } from '@meccg/shared';
import { computeLegalActions, stampActionIds } from '@meccg/shared';
import type { EvaluatedAction } from '@meccg/shared';

/** Convert a pile of card instances to view cards (structurally identical). */
function toViewCards(pile: readonly CardInstance[]): ViewCard[] {
  return pile.map(c => ({ instanceId: c.instanceId, definitionId: c.definitionId }));
}

/** Redacts a pile of card instances: keeps real instance IDs, replaces definition with UNKNOWN_CARD. */
function hiddenCardPile(pile: readonly { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId }[]): readonly ViewCard[] {
  return pile.map(c => ({ instanceId: c.instanceId, definitionId: UNKNOWN_CARD }));
}

/**
 * Redacts a pile like {@link hiddenCardPile}, but keeps the true identity of
 * any instance whose identity is already public per
 * {@link GameState.handRevealedInstances}. Used for the opponent's hand and
 * play deck so that a card a reveal effect has made public (e.g. Rolled down
 * to the Sea, wh-29, which forces the opponent to reveal his whole hand)
 * stays visible to the player who saw it, while freshly drawn cards the
 * opponent picked up afterwards remain hidden. Deliberately narrower than
 * {@link GameState.revealedInstances}: a card merely passing through an
 * unrelated public zone (e.g. a character played into a company, later
 * returned to hand by a general-influence overflow) must not leak here.
 */
function revealedCardPile(
  pile: readonly { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId }[],
  revealed: GameState['handRevealedInstances'] | undefined,
): readonly ViewCard[] {
  return pile.map(c =>
    revealed?.[c.instanceId] !== undefined
      ? { instanceId: c.instanceId, definitionId: c.definitionId }
      : { instanceId: c.instanceId, definitionId: UNKNOWN_CARD },
  );
}

/**
 * Unmasks the play-deck instances a player's own `fetch-from-pile` legal
 * actions currently target with `source: 'deck'`.
 *
 * {@link buildSelfView}'s play-deck redaction only unmasks identities already
 * recorded in {@link GameState.revealedInstances} (e.g. Revealed to all
 * Watchers, dm-85). A grant-action fetch that can pull from the play deck
 * (Mistress Lobelia dm-178, Palantír of Amon Sûl tw-296, etc. — any
 * `enqueue-pending-fetch` apply with `deck` among its sources) never records
 * that reveal, so the candidate stayed masked: the pile browser then rendered
 * an undifferentiated stack of card backs with no way to see, or click,
 * the one legal pick — reported as "can't figure out how to use it, the
 * only way out is to decline". Since `legalActions` is already computed by
 * the time `buildSelfView` runs, unmask exactly the instances the player's
 * own viable `fetch-from-pile` actions reference in their own play deck —
 * no persisted state change, so it never leaks to the opponent or outlives
 * the fetch itself.
 */
function unmaskOwnDeckFetchCandidates(
  playDeckView: readonly ViewCard[],
  realPlayDeck: readonly CardInstance[],
  legalActions: readonly EvaluatedAction[],
): readonly ViewCard[] {
  const candidateIds = new Set(
    legalActions
      .filter((ea): ea is EvaluatedAction & { action: { type: 'fetch-from-pile'; source: string; cardInstanceId: CardInstanceId } } =>
        ea.viable && ea.action.type === 'fetch-from-pile' && (ea.action as { source: string }).source === 'deck')
      .map(ea => ea.action.cardInstanceId as string),
  );
  if (candidateIds.size === 0) return playDeckView;
  const realDefById = new Map(realPlayDeck.map(c => [c.instanceId as string, c.definitionId]));
  return playDeckView.map(c =>
    candidateIds.has(c.instanceId as string)
      ? { instanceId: c.instanceId, definitionId: realDefById.get(c.instanceId as string) ?? c.definitionId }
      : c,
  );
}

/**
 * Redacts a discard pile like {@link hiddenCardPile}, but keeps the true
 * identity of the top (most recently discarded) card. Used when the viewing
 * player controls Pallando (tw-175): CRF 22 rules that Pallando "can only see
 * the top card of an opponent's discard pile" — not the whole pile.
 */
function hiddenPileRevealTop(pile: readonly { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId }[]): readonly ViewCard[] {
  return pile.map((c, i) =>
    i === pile.length - 1
      ? { instanceId: c.instanceId, definitionId: c.definitionId }
      : { instanceId: c.instanceId, definitionId: UNKNOWN_CARD },
  );
}

/**
 * Site instance IDs in `playerIndex`'s site deck whose identity is currently
 * public to everyone, even though the card still lives in that otherwise-hidden
 * deck. During the character draft a Hidden Haven (wh-75) paired to a Ruins &
 * Lairs "brings out" that site when revealed (CRF 22: "you must bring out your
 * starting site when you reveal Hidden Haven"), so the opponent may see which
 * site it names. Empty in every other phase, so site decks stay fully hidden.
 */
function publicSiteInstanceIds(state: GameState, playerIndex: number): ReadonlySet<string> {
  const ids = new Set<string>();
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'character-draft') {
    for (const pairing of state.phaseState.setupStep.draftState[playerIndex].stageResourceSites ?? []) {
      ids.add(pairing.siteInstanceId as string);
    }
  }
  return ids;
}

/** Redacts a site pile to UNKNOWN_SITE but keeps the identity of sites listed in `publicIds`. */
function redactSitePile(pile: readonly CardInstance[], publicIds: ReadonlySet<string>): readonly ViewCard[] {
  return pile.map(c => publicIds.has(c.instanceId as string)
    ? { instanceId: c.instanceId, definitionId: c.definitionId }
    : { instanceId: c.instanceId, definitionId: UNKNOWN_SITE });
}

/**
 * The view fields that are identical across the self, opponent, and
 * spectator-self projections: public per-player metadata plus the derived
 * general influence (the single call site for `effectiveGeneralInfluence`).
 * The fields that differ between views — the redacted piles, companies, and
 * agents — stay in each builder's own literal.
 */
function commonViewFields(state: GameState, player: PlayerState) {
  return {
    id: player.id,
    name: player.name,
    alignment: player.alignment,
    wizard: player.wizard,
    characters: player.characters,
    cardsInPlay: player.cardsInPlay,
    marshallingPoints: player.marshallingPoints,
    callableMarshallingPoints: player.callableMarshallingPoints,
    generalInfluenceUsed: player.generalInfluenceUsed,
    generalInfluence: effectiveGeneralInfluence(state, player.id),
    stagePoints: player.stagePoints,
    deckExhaustionCount: player.deckExhaustionCount,
    lastDiceRoll: player.lastDiceRoll,
  };
}

/**
 * Builds the "self" portion of a player's view. The player can see their
 * own hand contents (resolved to definition IDs), discard pile, site deck,
 * sideboard, companies, and characters — but only the *size* of their play
 * deck (not its order), except for any instance already made public per
 * {@link GameState.revealedInstances} (e.g. a card a reveal effect placed
 * back on top of the deck, such as Revealed to all Watchers, dm-85's
 * set-aside cards — the player must still be able to tell those apart to
 * choose their order).
 */
function buildSelfView(state: GameState, player: PlayerState): SelfView {
  // Redact on-guard card identities — the resource player must not see
  // what the hazard player placed face-down at their companies.
  // Revealed cards keep their identity; unrevealed cards are hidden.
  const companies = player.companies.map(c =>
    c.onGuardCards.length > 0
      ? { ...c, onGuardCards: c.onGuardCards.map(og => og.revealed ? og : { ...og, definitionId: UNKNOWN_CARD }) }
      : c,
  );
  return {
    ...commonViewFields(state, player),
    hand: toViewCards(player.hand),
    playDeck: revealedCardPile(player.playDeck, state.revealedInstances),
    discardPile: toViewCards(player.discardPile),
    siteDeck: toViewCards(player.siteDeck),
    siteDiscardPile: toViewCards(player.siteDiscardPile),
    sideboard: toViewCards(player.sideboard),
    killPile: toViewCards(player.killPile),
    outOfPlayPile: toViewCards(player.outOfPlayPile),
    companies,
    agents: player.agents,
  };
}

/**
 * Builds the "opponent" portion of a player's view. Hides the opponent's
 * hand contents, play deck, site deck, sideboard, and discard pile
 * (represented as arrays of {@link UNKNOWN_INSTANCE} / {@link UNKNOWN_CARD}
 * — cards are discarded face-down per the CoE glossary), except for any
 * discard-pile instance already made public per
 * {@link GameState.handRevealedInstances} (e.g. Aware of their Ways, dm-46,
 * which reveals a random subset of the opponent's discard pile so the
 * card-player may choose one to remove from the game — without this, the
 * chosen instances stayed `UNKNOWN_CARD` in the card-player's own view,
 * so the pile browser rendered them as an anonymous face-down stack with no
 * click targets), and redacts planned movement destinations to a boolean
 * `hasPlannedMovement` flag.
 * Public information — characters in play, company locations — is passed
 * through. {@link projectPlayerView} layers on top of this for exceptions
 * that depend on the *viewing* player's own state, such as Pallando's
 * top-of-discard-pile visibility.
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
    onGuardCards: c.onGuardCards.map(og =>
      og.revealed
        ? { instanceId: og.instanceId, definitionId: og.definitionId, revealed: true }
        : { instanceId: og.instanceId, definitionId: UNKNOWN_CARD },
    ),
  }));

  // Redact agent identity when face-down: resource player sees only that
  // an agent exists and how many sites it has accumulated.
  const agents: OpponentAgentView[] = player.agents.map(a => ({
    id: a.id,
    characterInstanceId: a.revealed ? a.character.instanceId : null,
    characterDefinitionId: a.revealed ? a.character.definitionId : null,
    revealed: a.revealed,
    siteStackSize: a.siteStack.length,
    actedThisTurn: a.remainingActions <= 0,
  }));

  return {
    ...commonViewFields(state, player),
    hand: revealedCardPile(player.hand, state.handRevealedInstances),
    playDeck: revealedCardPile(player.playDeck, state.handRevealedInstances),
    siteDeck: redactSitePile(player.siteDeck, publicSiteInstanceIds(state, getPlayerIndex(state, player.id))),
    discardPile: revealedCardPile(player.discardPile, state.handRevealedInstances),
    siteDiscardPile: toViewCards(player.siteDiscardPile),
    killPile: toViewCards(player.killPile),
    outOfPlayPile: toViewCards(player.outOfPlayPile),
    sideboard: hiddenCardPile(player.sideboard),
    companies,
    agents,
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

  // The bottom player's companies are shown raw below (public info: sites,
  // characters, planned movement), but their on-guard cards are the OPPONENT's
  // face-down hazards — hidden information no one but that opponent may see.
  // buildSelfView redacts these; the spectator "self" slot must too, or a
  // watcher sees the face-down bluffs on p1's companies.
  const p1Companies = p1.companies.map(c =>
    c.onGuardCards.length > 0
      ? { ...c, onGuardCards: c.onGuardCards.map(og => (og.revealed ? og : { ...og, definitionId: UNKNOWN_CARD })) }
      : c,
  );

  const _self = buildOpponentView(state, p1);
  // Reveal the opponent-side player's planned movement to spectators. The
  // bottom player (p1, projected as "self" from raw companies) already carries
  // its own destinationSite, so spectators see both planned region paths — just
  // as each player sees their own during the Organization phase.
  const opponentBase = buildOpponentView(state, p2);
  const opponent: OpponentView = {
    ...opponentBase,
    companies: opponentBase.companies.map((c, i) => ({
      ...c,
      revealedDestinationSite: p2.companies[i]?.destinationSite ?? null,
    })),
  };

  return {
    self: {
      ...commonViewFields(state, p1),
      // Spectators see that the bottom player holds a hand (as face-down backs)
      // but never its card identities — hands stay hidden information.
      hand: hiddenCardPile(p1.hand),
      playDeck: hiddenCardPile(p1.playDeck),
      discardPile: [],
      // Only sites whose identity is currently public (a brought-out Hidden
      // Haven site during the draft); the rest of p1's site deck stays hidden.
      siteDeck: redactSitePile(p1.siteDeck, publicSiteInstanceIds(state, 0))
        .filter(c => c.definitionId !== UNKNOWN_SITE),
      siteDiscardPile: [],
      sideboard: [],
      killPile: [],
      outOfPlayPile: [],
      companies: p1Companies,
      agents: p1.agents,
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
    gameId: state.gameId,
    stateSeq: state.stateSeq,
    legalActions: [],
    activeConstraints: state.activeConstraints,
    cheated: state.cheated,
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
      // Which characters the opponent's deck is built around is their plan, not
      // public information — and their pool is hidden here anyway.
      favourites: undefined,
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

/**
 * Shared body of {@link projectPlayerView} and {@link projectReplayView}: the
 * full seat projection with its per-card redactions, parameterised only by the
 * legal-action list to attach. Splitting it out lets the replay viewer reuse
 * the exact redaction rules a live player saw without paying for a legal-action
 * computation it would never offer.
 */
function buildPlayerView(
  state: GameState,
  playerId: PlayerId,
  legalActions: PlayerView['legalActions'],
): PlayerView {
  const selfIndex = getPlayerIndex(state, playerId);
  const opponentIndex = 1 - selfIndex;

  const selfPlayer = state.players[selfIndex];
  const opponentPlayer = state.players[opponentIndex];

  let self = buildSelfView(state, selfPlayer);
  self = { ...self, playDeck: unmaskOwnDeckFetchCandidates(self.playDeck, selfPlayer.playDeck, legalActions) };
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

  // The Great Hunt (wh-91) forces the opponent to discard face-up for as long
  // as it is in play: the engine reveals every newly discarded card via
  // {@link sweepGreatHuntDiscards} (growing `handRevealedInstances`), which
  // `buildOpponentView`'s discard-pile redaction already consults — so a
  // later discard landing on top does not re-hide an earlier one, with no
  // extra handling needed here.
  if (!selfPlayer.cardsInPlay.some(c => c.definitionId === THE_GREAT_HUNT)
    && Object.values(selfPlayer.characters).some(c => c.definitionId === PALLANDO)) {
    // Pallando (tw-175, CRF 22): the controlling player can see only the top
    // card of the opponent's discard pile (discards happen one at a time, so
    // this lets them see each card as it is discarded).
    opponent = { ...opponent, discardPile: hiddenPileRevealTop(opponentPlayer.discardPile) };
  }

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
    gameId: state.gameId,
    stateSeq: state.stateSeq,
    legalActions,
    activeConstraints: state.activeConstraints,
    cheated: state.cheated,
  };
}

export function projectPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  return buildPlayerView(state, playerId, stampActionIds(computeLegalActions(state, playerId)));
}

/**
 * Projects a recorded state for the replay viewer, from `playerId`'s seat.
 *
 * Identical redaction to {@link projectPlayerView} — a replay shows what that
 * seat could actually see at the time, not the omniscient state — but with an
 * empty legal-action list: a replay is read-only, so recomputing the actions
 * would only cost time and risk surfacing clickable buttons that cannot act.
 */
export function projectReplayView(state: GameState, playerId: PlayerId): PlayerView {
  return buildPlayerView(state, playerId, []);
}
