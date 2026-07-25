/**
 * @module search/determinize
 *
 * Determinizer (P5): samples a full `GameState` consistent with a
 * {@link PlayerView} so a search agent can run the real engine
 * (`computeLegalActions` / `reduce`) on hypothetical worlds without ever
 * seeing true hidden information. Every hidden card slot in the view
 * (own play deck, opponent hand / play deck / sideboard / site deck,
 * unrevealed on-guard cards) keeps its instance id but is assigned a
 * definition sampled without replacement from the owner's *unseen pool*:
 * the player's known deck list minus every identity already observed in
 * the view. Deck lists are treated as known — challenge decks are public
 * in tournament play; hidden-decklist opponents would sample from a wider
 * prior instead (future work).
 *
 * The sampled state is for SEARCH ONLY: engine internals that the view
 * does not carry are synthesized (fresh seeded RNG — re-seeding per
 * determinization is exactly how chance nodes are marginalized — empty
 * history/undo fields). States mid-chain or with pending effects are out
 * of scope for v1; callers should fall back to policy-only play there.
 * The load-bearing correctness property, exercised by the tests: the
 * searching player's own legal actions computed on the sampled state are
 * identical to the ones in the original view.
 */

import {
  createRng,
  loadCardPool,
  Phase,
} from '@meccg/shared';
import type {
  CardDefinition,
  CardDefinitionId,
  CardInstanceId,
  GameState,
  PlayerId,
  PlayerView,
  PlayerState,
  CardInstance,
  ViewCard,
} from '@meccg/shared';
import { UNKNOWN_CARD, UNKNOWN_SITE } from '@meccg/shared';
import type { LoadedDeck } from '../decks.js';
import { createRandomStream } from '../random-stream.js';

/** Options for {@link determinize}. */
export interface DeterminizeOptions {
  /** The searching player's view — the only observation source. */
  readonly view: PlayerView;
  /** The searching player's own deck (for the hidden own play deck). */
  readonly ownDeck: LoadedDeck;
  /** The opponent's deck list (public for challenge decks). */
  readonly opponentDeck: LoadedDeck;
  /** Sampling seed — same seed, same world; different seeds marginalize chance. */
  readonly seed: number;
  /** Card pool override (loaded once by default). */
  readonly cardPool?: Readonly<Record<string, CardDefinition>>;
}

/** True when a view card's identity is hidden. */
function isHidden(card: ViewCard): boolean {
  return card.definitionId === UNKNOWN_CARD || card.definitionId === UNKNOWN_SITE;
}

/** Multiset remove: deletes one occurrence of `id` from `pool` if present. */
function removeOne(pool: CardDefinitionId[], id: CardDefinitionId): void {
  const index = pool.indexOf(id);
  if (index >= 0) pool.splice(index, 1);
}

/** Fisher-Yates shuffle driven by a uniform stream. */
function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Assigns sampled definitions to the hidden cards of one zone list,
 * consuming the owner's unseen pool. Visible cards pass through.
 */
function fillZone(
  zone: readonly ViewCard[],
  pool: CardDefinitionId[],
  fallback: CardDefinitionId | null,
): CardInstance[] {
  return zone.map(card => {
    if (!isHidden(card)) return { instanceId: card.instanceId, definitionId: card.definitionId };
    const definitionId = pool.length > 0 ? pool.pop() as CardDefinitionId : fallback;
    if (definitionId === null) {
      // Unseen pool exhausted (deck-list accounting drift, e.g. drafted
      // characters): keep the sentinel — resolveInstanceId still succeeds
      // and the card stays untargetable, which is the conservative choice.
      return { instanceId: card.instanceId, definitionId: card.definitionId };
    }
    return { instanceId: card.instanceId, definitionId };
  });
}

/**
 * Builds the owner's unseen pool: the deck list expanded, minus one copy
 * per identity already visible anywhere in the given zones.
 */
function unseenPool(
  deckIds: readonly CardDefinitionId[],
  visibleZones: readonly (readonly ViewCard[])[],
  random: () => number,
): CardDefinitionId[] {
  const pool = [...deckIds];
  for (const zone of visibleZones) {
    for (const card of zone) {
      if (!isHidden(card)) removeOne(pool, card.definitionId);
    }
  }
  return shuffle(pool, random);
}

/**
 * Samples a full `GameState` consistent with the view. Deterministic for
 * a given (view, decks, seed).
 */
export function determinize(options: DeterminizeOptions): GameState {
  const { view } = options;
  const cardPool = options.cardPool ?? loadCardPool();
  const random = createRandomStream(options.seed ^ 0x51ac3d);
  const s = view.self;
  const o = view.opponent;

  // Own hidden play deck: sampled from the own deck list minus everything
  // the self view already shows.
  // Drafted characters from the draft pool may have entered the play deck
  // at setup, so the unseen universe is playDeck + draftPool.
  const ownPlayIds = [...options.ownDeck.playDeck, ...options.ownDeck.draftPool];
  const ownCharacterCards: ViewCard[] = Object.values(s.characters).flatMap(ch => [
    { instanceId: ch.instanceId, definitionId: ch.definitionId },
    ...ch.items.map(i => ({ instanceId: i.instanceId, definitionId: i.definitionId })),
    ...ch.allies.map(a => ({ instanceId: a.instanceId, definitionId: a.definitionId })),
  ]);
  const ownPool = unseenPool(ownPlayIds, [
    s.hand, s.discardPile, s.sideboard, s.killPile, s.outOfPlayPile,
    s.cardsInPlay, ownCharacterCards,
  ], random);

  // Opponent hidden zones: hand, play deck, sideboard from their play-deck
  // list; site deck from their site list.
  const oppPlayIds = [...options.opponentDeck.playDeck, ...options.opponentDeck.draftPool];
  const oppCharacterCards: ViewCard[] = Object.values(o.characters).flatMap(ch => [
    { instanceId: ch.instanceId, definitionId: ch.definitionId },
    ...ch.items.map(i => ({ instanceId: i.instanceId, definitionId: i.definitionId })),
    ...ch.allies.map(a => ({ instanceId: a.instanceId, definitionId: a.definitionId })),
  ]);
  const oppPool = unseenPool(oppPlayIds, [
    o.discardPile, o.killPile, o.outOfPlayPile, o.cardsInPlay, oppCharacterCards,
  ], random);
  const oppSiteIds = [...options.opponentDeck.siteDeck];
  const oppSitePool = unseenPool(oppSiteIds, [
    o.siteDiscardPile,
    o.companies.flatMap(c => (c.currentSite ? [{ instanceId: c.currentSite.instanceId, definitionId: c.currentSite.definitionId }] : [])),
  ], random);

  const toInstances = (zone: readonly ViewCard[]): CardInstance[] =>
    zone.map(card => ({ instanceId: card.instanceId, definitionId: card.definitionId }));

  const selfState: PlayerState = {
    id: s.id,
    name: s.name,
    alignment: s.alignment,
    wizard: s.wizard,
    hand: toInstances(s.hand),
    playDeck: fillZone(s.playDeck, ownPool, null),
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
    generalInfluenceBonus: 0,
    generalInfluenceControlPenalty: 0,
    deckExhaustionCount: s.deckExhaustionCount,
    freeCouncilCalled: false,
    lastDiceRoll: s.lastDiceRoll,
    sideboardAccessedDuringUntap: false,
    deckExhaustPending: false,
    deckExhaustExchangeCount: 0,
    reservedCreatures: [],
  } as unknown as PlayerState;

  // Opponent companies: the redacted OpponentCompanyView must be widened
  // back to a full Company. Destination is hidden until revealed — use the
  // revealed destination when present, else model "has planned movement"
  // with a null destination (conservative: the searcher cannot know it).
  const oppCompanies = o.companies.map(c => ({
    id: c.id,
    characters: c.characters,
    currentSite: c.currentSite,
    siteCardOwned: c.siteCardOwned,
    destinationSite: c.revealedDestinationSite,
    movementPath: [] as readonly CardInstanceId[],
    moved: c.moved,
    siteOfOrigin: null,
    onGuardCards: c.onGuardCards.map(og => ({
      instanceId: og.instanceId,
      definitionId: isHidden(og)
        ? (oppPool.pop() ?? og.definitionId)
        : og.definitionId,
      revealed: (og as { revealed?: boolean }).revealed ?? false,
    })),
    hazards: [],
  }));

  const oppState: PlayerState = {
    id: o.id,
    name: o.name,
    alignment: o.alignment,
    wizard: o.wizard,
    hand: fillZone(o.hand, oppPool, null),
    playDeck: fillZone(o.playDeck, oppPool, null),
    discardPile: toInstances(o.discardPile),
    siteDeck: fillZone(o.siteDeck, oppSitePool, null),
    siteDiscardPile: toInstances(o.siteDiscardPile),
    sideboard: fillZone(o.sideboard, oppPool, null),
    killPile: toInstances(o.killPile),
    outOfPlayPile: toInstances(o.outOfPlayPile),
    companies: oppCompanies as PlayerState['companies'],
    agents: [],
    characters: o.characters,
    cardsInPlay: o.cardsInPlay,
    marshallingPoints: o.marshallingPoints,
    callableMarshallingPoints: o.marshallingPoints,
    stagePoints: o.stagePoints,
    generalInfluenceUsed: o.generalInfluenceUsed,
    generalInfluenceBonus: 0,
    generalInfluenceControlPenalty: 0,
    deckExhaustionCount: o.deckExhaustionCount,
    freeCouncilCalled: false,
    lastDiceRoll: o.lastDiceRoll,
    sideboardAccessedDuringUntap: false,
    deckExhaustPending: false,
    deckExhaustExchangeCount: 0,
    reservedCreatures: [],
  } as unknown as PlayerState;

  const players: [PlayerState, PlayerState] =
    view.selfIndex === 0 ? [selfState, oppState] : [oppState, selfState];

  return {
    gameId: `determinized-${options.seed}`,
    players,
    activePlayer: view.activePlayer,
    phaseState: view.phaseState,
    combat: view.combat,
    chain: view.chain,
    cardPool: cardPool as GameState['cardPool'],
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

/**
 * True when the view is a "quiet" decision point the v1 determinizer
 * supports: no chain, no combat, no pending effects, and one of the
 * phases whose legality depends only on view-visible state.
 */
export function isDeterminizableView(view: PlayerView): boolean {
  if (view.chain !== null || view.combat !== null) return false;
  if (view.pendingEffects.length > 0) return false;
  return view.phaseState.phase === Phase.Organization
    || view.phaseState.phase === Phase.Site
    || view.phaseState.phase === Phase.MovementHazard
    || view.phaseState.phase === Phase.LongEvent;
}

/** Re-export for callers building search agents on top. */
export type { PlayerView, GameState, PlayerId };
