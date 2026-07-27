/**
 * @module search/determinize-null
 *
 * Deck-list-free determinizer: widens a {@link PlayerView} into a
 * `GameState` the real engine can step, **without** knowing either deck
 * list. Where `search/determinize` samples every hidden card from the
 * owner's known deck list, this one leaves hidden cards hidden: each keeps
 * its instance id and the `UNKNOWN_CARD` sentinel definition, and callers
 * treat it as playable only face-down on-guard (see `search/rollout`).
 *
 * Why it exists: `determinize` documents its own assumption — "deck lists
 * are treated as known — challenge decks are public in tournament play;
 * hidden-decklist opponents would sample from a wider prior instead". A
 * lobby opponent's deck is not public, so a search agent that must work
 * against an arbitrary human needs a determinizer that assumes nothing.
 *
 * Two deliberate departures from a literal "everything unknown is inert":
 *
 * - **Sites are sampled, not inerted.** The map is public information and
 *   a site card is revealed the moment it is played, so treating the
 *   opponent's site deck as unplayable would freeze their companies in
 *   place for the whole rollout and make every simulated future look
 *   far better than it is. Unknown sites are therefore filled from the
 *   card pool's sites matching the owner's alignment — no deck list
 *   required, since any player may hold any site of their alignment.
 * - **The `unknown-card` sentinel gets a real definition** injected into
 *   the state's card pool. Legal-action generators resolve definitions for
 *   every card in hand, and an absent definition crashes them. The
 *   injected stand-in is a `region` card: regions are never playable from
 *   hand, so every generator's type guard skips it, and an isolated node
 *   in the region graph is unreachable from any site.
 *
 * As with `determinize`, the sampled state is FOR SEARCH ONLY: engine
 * internals the view does not carry are synthesized, and views mid-chain,
 * in combat, or with pending effects are out of scope.
 */

import { createRng, loadCardPool, Alignment, RegionType, isSiteCard } from '@meccg/shared';
import type {
  CardDefinition,
  CardDefinitionId,
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  PlayerState,
  PlayerView,
  RegionCard,
  ViewCard,
} from '@meccg/shared';
import { UNKNOWN_CARD, UNKNOWN_SITE } from '@meccg/shared';
import { createRandomStream } from '../random-stream.js';

/** Options for {@link determinizeNull}. */
export interface DetermizeNullOptions {
  /** The searching player's view — the only observation source. */
  readonly view: PlayerView;
  /** Seed for site sampling and the synthesized engine RNG. */
  readonly seed: number;
  /** Card pool override (loaded once by default). */
  readonly cardPool?: Readonly<Record<string, CardDefinition>>;
  /**
   * How to treat hidden **site** cards. `'sample'` (default) draws a site
   * of the owner's alignment from the card pool so companies can still
   * move; `'inert'` leaves them unknown and therefore unplayable, which
   * pins every company to its current site for the whole rollout.
   */
  readonly unknownSites?: 'sample' | 'inert';
}

/** A determinized world plus the identities the searcher does not know. */
export interface NullWorld {
  /** The widened state, safe to pass to `computeLegalActions` / `reduce`. */
  readonly state: GameState;
  /**
   * Instance ids whose definition is the `unknown-card` stand-in. Cards
   * drawn from a hidden play deck during a rollout are already in this set,
   * because the deck was filled with sentinels up front.
   */
  readonly unknownInstances: ReadonlySet<CardInstanceId>;
}

/**
 * Stand-in definition for a card whose identity the searcher does not know.
 *
 * Typed as a `region` for a specific reason: every legal-action generator
 * narrows a hand card with a type guard (`isItemCard`, `isCharacterCard`,
 * `isResourceEventCard`, …) before offering anything, and a region matches
 * none of them, so an unknown card silently produces no play options. The
 * one action that does not consult the definition is on-guard placement,
 * which offers *any* hand card — exactly the single capability an unknown
 * card is meant to keep.
 */
export const UNKNOWN_CARD_DEFINITION: RegionCard = {
  cardType: 'region',
  id: UNKNOWN_CARD,
  name: 'Unknown Card',
  image: '',
  regionType: RegionType.Wilderness,
  // No adjacencies: an isolated node in the region graph that no site
  // references, so it can never appear on a movement path.
  adjacentRegions: [],
  text: 'A card whose identity is hidden from the searching player.',
};

/** True when a view card's identity is hidden. */
function isHidden(card: ViewCard): boolean {
  return card.definitionId === UNKNOWN_CARD || card.definitionId === UNKNOWN_SITE;
}

/** Site `cardType` that a player of the given alignment plays. */
function siteTypeFor(alignment: Alignment): string {
  switch (alignment) {
    case Alignment.Ringwraith: return 'minion-site';
    case Alignment.FallenWizard: return 'fallen-wizard-site';
    case Alignment.Balrog: return 'balrog-site';
    default: return 'hero-site';
  }
}

/** All site definition ids in the pool playable by the given alignment. */
function sitePoolFor(
  cardPool: Readonly<Record<string, CardDefinition>>,
  alignment: Alignment,
): CardDefinitionId[] {
  const wanted = siteTypeFor(alignment);
  const ids: CardDefinitionId[] = [];
  for (const card of Object.values(cardPool)) {
    if (isSiteCard(card) && card.cardType === wanted) ids.push(card.id);
  }
  return ids;
}

/**
 * Widens one zone into card instances, recording every hidden slot. Hidden
 * non-site cards keep the `unknown-card` sentinel; hidden sites are drawn
 * from `sitePool` when site sampling is enabled.
 */
function fillZone(
  zone: readonly ViewCard[],
  unknown: Set<CardInstanceId>,
  sitePool: readonly CardDefinitionId[] | null,
  random: () => number,
): CardInstance[] {
  return zone.map(card => {
    if (!isHidden(card)) return { instanceId: card.instanceId, definitionId: card.definitionId };
    if (card.definitionId === UNKNOWN_SITE && sitePool !== null && sitePool.length > 0) {
      const definitionId = sitePool[Math.floor(random() * sitePool.length)];
      return { instanceId: card.instanceId, definitionId };
    }
    unknown.add(card.instanceId);
    return { instanceId: card.instanceId, definitionId: UNKNOWN_CARD };
  });
}

/** Widens a fully visible zone (no hidden slots expected). */
function toInstances(zone: readonly ViewCard[]): CardInstance[] {
  return zone.map(card => ({ instanceId: card.instanceId, definitionId: card.definitionId }));
}

/**
 * Builds a `GameState` from the view without consulting any deck list.
 * Deterministic for a given `(view, seed)`.
 */
export function determinizeNull(options: DetermizeNullOptions): NullWorld {
  const { view } = options;
  const basePool = options.cardPool ?? loadCardPool();
  const random = createRandomStream(options.seed ^ 0x4e1177);
  const unknown = new Set<CardInstanceId>();
  const s = view.self;
  const o = view.opponent;

  // The sentinel must resolve, or every generator that reads a hand card's
  // definition throws before it can decide the card is unplayable.
  const cardPool: Record<string, CardDefinition> = {
    ...basePool,
    [UNKNOWN_CARD as string]: UNKNOWN_CARD_DEFINITION,
  };

  const sampleSites = (options.unknownSites ?? 'sample') === 'sample';
  const selfSites = sampleSites ? sitePoolFor(basePool, s.alignment) : null;
  const oppSites = sampleSites ? sitePoolFor(basePool, o.alignment) : null;

  const selfState: PlayerState = {
    id: s.id,
    name: s.name,
    alignment: s.alignment,
    wizard: s.wizard,
    hand: toInstances(s.hand),
    playDeck: fillZone(s.playDeck, unknown, null, random),
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

  // Opponent companies: the redacted view must be widened back to a full
  // Company. An unrevealed destination stays null — the searcher cannot
  // know it, and guessing one would invent information.
  const oppCompanies = o.companies.map(c => ({
    id: c.id,
    characters: c.characters,
    currentSite: c.currentSite,
    siteCardOwned: c.siteCardOwned,
    destinationSite: c.revealedDestinationSite,
    movementPath: [] as readonly CardInstanceId[],
    moved: c.moved,
    siteOfOrigin: null,
    onGuardCards: c.onGuardCards.map(og => {
      if (!isHidden(og)) {
        return { instanceId: og.instanceId, definitionId: og.definitionId, revealed: true };
      }
      unknown.add(og.instanceId);
      return { instanceId: og.instanceId, definitionId: UNKNOWN_CARD, revealed: false };
    }),
    hazards: [],
  }));

  const oppState: PlayerState = {
    id: o.id,
    name: o.name,
    alignment: o.alignment,
    wizard: o.wizard,
    hand: fillZone(o.hand, unknown, null, random),
    playDeck: fillZone(o.playDeck, unknown, null, random),
    discardPile: toInstances(o.discardPile),
    siteDeck: fillZone(o.siteDeck, unknown, oppSites, random),
    siteDiscardPile: toInstances(o.siteDiscardPile),
    sideboard: fillZone(o.sideboard, unknown, null, random),
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

  // `selfSites` is unused when the searcher's own site deck is fully
  // visible, which it always is — referenced here so the sampling policy
  // stays symmetrical if a future view ever redacts it.
  void selfSites;

  const players: [PlayerState, PlayerState] =
    view.selfIndex === 0 ? [selfState, oppState] : [oppState, selfState];

  const state = {
    gameId: `null-determinized-${options.seed}`,
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

  return { state, unknownInstances: unknown };
}

/** Re-export for callers building search agents on top. */
export type { PlayerView, GameState, PlayerId };
