/**
 * @module search/widen-view
 *
 * Shared plumbing for the determinizers. Turning a {@link PlayerView} back
 * into a `GameState` the engine can step is mostly mechanical: copy the
 * visible zones across, synthesize the engine internals the view does not
 * carry (fresh seeded RNG, empty history/undo fields), and widen the
 * redacted opponent companies back into full `Company` records.
 *
 * The *only* thing that distinguishes one determinizer from another is what
 * it puts in the hidden slots — `search/determinize` samples them from the
 * owner's known deck list, `search/determinize-null` leaves them as the
 * `unknown-card` sentinel. That decision is passed in as {@link ZoneFillers};
 * everything else lives here so the two determinizers cannot drift apart.
 *
 * As with both callers, the produced state is FOR SEARCH ONLY.
 */

import { createRng } from '@meccg/shared';
import type {
  CardDefinition,
  CardInstance,
  CardInstanceId,
  GameState,
  OpponentView,
  PlayerState,
  PlayerView,
  SelfView,
  ViewCard,
} from '@meccg/shared';
import { UNKNOWN_CARD, UNKNOWN_SITE } from '@meccg/shared';

/** An on-guard card as a full `Company` carries it. */
export interface WidenedOnGuardCard extends CardInstance {
  readonly revealed: boolean;
}

/**
 * How a determinizer fills the slots the view redacts. Each filler receives
 * one zone (or one on-guard card) and returns the widened instances; the
 * zones passed in are exactly those a `PlayerView` may hide.
 */
export interface ZoneFillers {
  /** The searching player's own play deck — hidden even from its owner. */
  readonly selfPlayDeck: (zone: readonly ViewCard[]) => CardInstance[];
  /** Opponent hand, play deck and sideboard: same identity pool for all three. */
  readonly opponentPlayZone: (zone: readonly ViewCard[]) => CardInstance[];
  /** Opponent site deck — drawn from sites, not from the play-card pool. */
  readonly opponentSiteDeck: (zone: readonly ViewCard[]) => CardInstance[];
  /** One opponent on-guard card, revealed or not. */
  readonly opponentOnGuard: (card: ViewCard) => WidenedOnGuardCard;
}

/** Everything {@link widenView} needs beyond the fillers. */
export interface WidenOptions {
  /** Synthetic game id, so a determinized state is recognizable in logs. */
  readonly gameId: string;
  /** Card pool the state should carry. */
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  /** Seed for the synthesized engine RNG. */
  readonly seed: number;
  /** Hidden-slot policy. */
  readonly fillers: ZoneFillers;
}

/** True when a view card's identity is hidden. */
export function isHidden(card: ViewCard): boolean {
  return card.definitionId === UNKNOWN_CARD || card.definitionId === UNKNOWN_SITE;
}

/** Widens a fully visible zone: instance ids and definitions pass straight through. */
export function toInstances(zone: readonly ViewCard[]): CardInstance[] {
  return zone.map(card => ({ instanceId: card.instanceId, definitionId: card.definitionId }));
}

/**
 * The engine fields a `PlayerView` does not carry, and the values a search
 * state gives them. Split out so both player sides agree on the defaults.
 */
const SYNTHESIZED_PLAYER_FIELDS = {
  generalInfluenceBonus: 0,
  generalInfluenceControlPenalty: 0,
  freeCouncilCalled: false,
  sideboardAccessedDuringUntap: false,
  deckExhaustPending: false,
  deckExhaustExchangeCount: 0,
  reservedCreatures: [],
} as const;

/** Widens the searching player's own side; only the play deck is hidden. */
function widenSelf(s: SelfView, fillers: ZoneFillers): PlayerState {
  return {
    id: s.id,
    name: s.name,
    alignment: s.alignment,
    wizard: s.wizard,
    hand: toInstances(s.hand),
    playDeck: fillers.selfPlayDeck(s.playDeck),
    discardPile: toInstances(s.discardPile),
    siteDeck: toInstances(s.siteDeck),
    siteDiscardPile: toInstances(s.siteDiscardPile),
    sideboard: toInstances(s.sideboard),
    killPile: toInstances(s.killPile),
    outOfPlayPile: toInstances(s.outOfPlayPile),
    companies: s.companies,
    agents: s.agents,
    characters: s.characters,
    cardsInPlay: s.cardsInPlay,
    marshallingPoints: s.marshallingPoints,
    callableMarshallingPoints: s.marshallingPoints,
    stagePoints: s.stagePoints,
    generalInfluenceUsed: s.generalInfluenceUsed,
    deckExhaustionCount: s.deckExhaustionCount,
    lastDiceRoll: s.lastDiceRoll,
    ...SYNTHESIZED_PLAYER_FIELDS,
  } as unknown as PlayerState;
}

/**
 * Widens the opponent's redacted companies back into full `Company` records.
 * An unrevealed destination stays null — the searcher cannot know it, and
 * guessing one would invent information.
 */
function widenOpponentCompanies(o: OpponentView, fillers: ZoneFillers): PlayerState['companies'] {
  return o.companies.map(c => ({
    id: c.id,
    characters: c.characters,
    currentSite: c.currentSite,
    siteCardOwned: c.siteCardOwned,
    destinationSite: c.revealedDestinationSite,
    movementPath: [] as readonly CardInstanceId[],
    moved: c.moved,
    siteOfOrigin: null,
    onGuardCards: c.onGuardCards.map(og => fillers.opponentOnGuard(og)),
    hazards: [],
  })) as unknown as PlayerState['companies'];
}

/** Widens the opponent's side: hand, play deck, sideboard and site deck are hidden. */
function widenOpponent(o: OpponentView, fillers: ZoneFillers): PlayerState {
  // Companies first: a filler that draws from a shared sampling pool sees the
  // on-guard cards before the hand, which is the order the determinizers have
  // always used.
  const companies = widenOpponentCompanies(o, fillers);
  return {
    id: o.id,
    name: o.name,
    alignment: o.alignment,
    wizard: o.wizard,
    hand: fillers.opponentPlayZone(o.hand),
    playDeck: fillers.opponentPlayZone(o.playDeck),
    discardPile: toInstances(o.discardPile),
    siteDeck: fillers.opponentSiteDeck(o.siteDeck),
    siteDiscardPile: toInstances(o.siteDiscardPile),
    sideboard: fillers.opponentPlayZone(o.sideboard),
    killPile: toInstances(o.killPile),
    outOfPlayPile: toInstances(o.outOfPlayPile),
    companies,
    agents: [],
    characters: o.characters,
    cardsInPlay: o.cardsInPlay,
    marshallingPoints: o.marshallingPoints,
    callableMarshallingPoints: o.marshallingPoints,
    stagePoints: o.stagePoints,
    generalInfluenceUsed: o.generalInfluenceUsed,
    deckExhaustionCount: o.deckExhaustionCount,
    lastDiceRoll: o.lastDiceRoll,
    ...SYNTHESIZED_PLAYER_FIELDS,
  } as unknown as PlayerState;
}

/**
 * Builds the `GameState` a determinizer returns: both sides widened in the
 * view's seat order, plus the synthesized engine internals.
 */
export function widenView(view: PlayerView, options: WidenOptions): GameState {
  const selfState = widenSelf(view.self, options.fillers);
  const oppState = widenOpponent(view.opponent, options.fillers);
  const players: [PlayerState, PlayerState] =
    view.selfIndex === 0 ? [selfState, oppState] : [oppState, selfState];

  return {
    gameId: options.gameId,
    players,
    activePlayer: view.activePlayer,
    phaseState: view.phaseState,
    combat: view.combat,
    chain: view.chain,
    cardPool: options.cardPool as GameState['cardPool'],
    turnNumber: view.turnNumber,
    startingPlayer: view.startingPlayer,
    pendingEffects: view.pendingEffects,
    pendingResolutions: [],
    activeConstraints: view.activeConstraints,
    hazardHosts: [],
    rng: createRng(options.seed),
    stateSeq: view.stateSeq,
    reverseActions: [],
    lastTurnFor: null,
    cheatRollTotal: null,
    revealedInstances: {},
  } as unknown as GameState;
}
