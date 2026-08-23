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
  loadCardPool,
  Phase,
  UNKNOWN_CARD,
} from '@meccg/shared';
import type {
  CardDefinition,
  CardDefinitionId,
  GameState,
  PlayerId,
  PlayerView,
  CardInstance,
  ViewCard,
} from '@meccg/shared';
import type { LoadedDeck } from '../decks.js';
import { createRandomStream } from '../random-stream.js';
import { UNKNOWN_CARD_DEFINITION } from './determinize-null.js';
import { isHidden, widenView, type WidenedOnGuardCard } from './widen-view.js';

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
function fillZone(zone: readonly ViewCard[], pool: CardDefinitionId[]): CardInstance[] {
  return zone.map(card => {
    if (!isHidden(card)) return { instanceId: card.instanceId, definitionId: card.definitionId };
    if (pool.length === 0) {
      // Unseen pool exhausted (deck-list accounting drift, e.g. drafted
      // characters): keep the sentinel — resolveInstanceId still succeeds
      // and the card stays untargetable, which is the conservative choice.
      return { instanceId: card.instanceId, definitionId: card.definitionId };
    }
    return { instanceId: card.instanceId, definitionId: pool.pop() as CardDefinitionId };
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
  // The sentinel definition must resolve: pool exhaustion (deck-list
  // accounting drift, e.g. cards moved into the sideboard mid-game) leaves
  // `unknown-card` instances in the state, and without a definition every
  // legal-action generator that reads one throws instead of deciding the
  // card is unplayable — the same backstop determinize-null installs.
  const cardPool: Record<string, CardDefinition> = {
    ...(options.cardPool ?? loadCardPool()),
    [UNKNOWN_CARD as string]: UNKNOWN_CARD_DEFINITION,
  };
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
  // Revealed cards in the hand and among the on-guard slots are observations
  // too: without deducting them the same copy could be sampled a second time
  // into another hidden slot.
  const oppOnGuardCards = o.companies.flatMap(c => c.onGuardCards);
  const oppPool = unseenPool(oppPlayIds, [
    o.hand, oppOnGuardCards, o.discardPile, o.killPile, o.outOfPlayPile,
    o.cardsInPlay, oppCharacterCards,
  ], random);
  // The hidden sideboard is its own zone with its own known composition —
  // the deck list's sideboard. It used to be filled from `oppPool`, whose
  // identities (play deck + draft pool) and size never accounted for it:
  // by the time widenView reached the sideboard the pool was exhausted and
  // all ~20 cards kept the `unknown-card` sentinel.
  const oppSideboardPool = shuffle([...options.opponentDeck.sideboard], random);
  const oppSiteIds = [...options.opponentDeck.siteDeck];
  const oppSitePool = unseenPool(oppSiteIds, [
    o.siteDiscardPile,
    o.companies.flatMap(c => (c.currentSite ? [{ instanceId: c.currentSite.instanceId, definitionId: c.currentSite.definitionId }] : [])),
  ], random);

  // Unrevealed on-guard cards are sampled from the same opponent pool as
  // their hand; a revealed one keeps whatever the view already shows.
  const fillOnGuard = (og: ViewCard): WidenedOnGuardCard => ({
    instanceId: og.instanceId,
    definitionId: isHidden(og) ? (oppPool.pop() ?? og.definitionId) : og.definitionId,
    revealed: (og as { revealed?: boolean }).revealed ?? false,
  });

  return widenView(view, {
    gameId: `determinized-${options.seed}`,
    cardPool,
    seed: options.seed,
    fillers: {
      selfPlayDeck: zone => fillZone(zone, ownPool),
      opponentPlayZone: zone => fillZone(zone, oppPool),
      opponentSideboard: zone => fillZone(zone, oppSideboardPool),
      opponentSiteDeck: zone => fillZone(zone, oppSitePool),
      opponentOnGuard: fillOnGuard,
    },
  });
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
