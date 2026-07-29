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

import { loadCardPool, Alignment, RegionType, isSiteCard } from '@meccg/shared';
import type {
  CardDefinition,
  CardDefinitionId,
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  PlayerView,
  RegionCard,
  ViewCard,
} from '@meccg/shared';
import { UNKNOWN_CARD, UNKNOWN_SITE } from '@meccg/shared';
import { createRandomStream } from '../random-stream.js';
import { isHidden, widenView, type WidenedOnGuardCard } from './widen-view.js';

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

/**
 * Builds a `GameState` from the view without consulting any deck list.
 * Deterministic for a given `(view, seed)`.
 */
export function determinizeNull(options: DetermizeNullOptions): NullWorld {
  const { view } = options;
  const basePool = options.cardPool ?? loadCardPool();
  const random = createRandomStream(options.seed ^ 0x4e1177);
  const unknown = new Set<CardInstanceId>();
  const o = view.opponent;

  // The sentinel must resolve, or every generator that reads a hand card's
  // definition throws before it can decide the card is unplayable.
  const cardPool: Record<string, CardDefinition> = {
    ...basePool,
    [UNKNOWN_CARD as string]: UNKNOWN_CARD_DEFINITION,
  };

  const sampleSites = (options.unknownSites ?? 'sample') === 'sample';
  const oppSites = sampleSites ? sitePoolFor(basePool, o.alignment) : null;

  // A revealed on-guard card keeps its identity; an unrevealed one stays a
  // sentinel — guessing it would invent information the searcher lacks.
  const fillOnGuard = (og: ViewCard): WidenedOnGuardCard => {
    if (!isHidden(og)) {
      return { instanceId: og.instanceId, definitionId: og.definitionId, revealed: true };
    }
    unknown.add(og.instanceId);
    return { instanceId: og.instanceId, definitionId: UNKNOWN_CARD, revealed: false };
  };

  const state = widenView(view, {
    gameId: `null-determinized-${options.seed}`,
    cardPool,
    seed: options.seed,
    fillers: {
      selfPlayDeck: zone => fillZone(zone, unknown, null, random),
      opponentPlayZone: zone => fillZone(zone, unknown, null, random),
      opponentSiteDeck: zone => fillZone(zone, unknown, oppSites, random),
      opponentOnGuard: fillOnGuard,
    },
  });

  return { state, unknownInstances: unknown };
}

/** Re-export for callers building search agents on top. */
export type { PlayerView, GameState, PlayerId };
