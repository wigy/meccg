/**
 * @module ai/h2/services/deck-reach
 *
 * Where the deck can still score — the half of a destination the hand cannot
 * see.
 *
 * `travel` prices a destination by the cards in hand playable there, plus a
 * flat value per card drawn. Neither notices that the rest of the deck is
 * *built around a place*. A tournament deck puts its marshalling-point cards
 * at sites one movement apart — within the rules' four regions of each other —
 * so that a company standing anywhere in that cluster is one move from any of
 * them. A company that leaves the cluster (a haven on the far side of the map,
 * chosen because it heals or draws) is one move from none of them, and every
 * card it draws afterwards is a card it cannot play without walking back. The
 * destination score could not see that: with nothing in hand for the cluster,
 * the far haven and the near one priced the same, and the agent ran between
 * havens that its own deck gave it no reason to be at.
 *
 * The player knows exactly what is left to draw. The play deck is face down in
 * the view, but its contents are the deck list minus every card the view shows
 * its owner — hand, discard, piles, sideboard, and everything in play. That is
 * the owner's knowledge, not a peek.
 *
 * **Coverage** of a site is the share of the marshalling-point value still
 * available to the player — hand plus unseen deck, each card priced marginally
 * through `standing` so a capped source counts for nothing — that has a
 * playable site within one movement of it. "Within one movement" is the
 * engine's own limit, `BASE_MAX_REGION_DISTANCE`, measured by `reach` (which
 * also knows starter movement's haven hops). The candidate sites are those the
 * player can actually move to: its site deck and the sites its companies hold.
 */

import { BASE_MAX_REGION_DISTANCE } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, PlayerView, ViewCard } from '@meccg/shared';
import { memoizeOnFirst } from '../core/memo.js';
import type { Standing } from '../core/types.js';
import type { MpSource } from '../core/tsd.js';
import type { OwnDeckList } from '../../../types.js';
import { resourcePlayableAt } from '../../evaluators/common.js';
import { companyMayPlay } from './named-target.js';
import { computeReach } from './reach.js';

/** Site card types across every alignment. */
const SITE_CARD_TYPES = new Set([
  'hero-site', 'minion-site', 'fallen-wizard-site', 'balrog-site',
]);

/** One marshalling-point card still available to the player. */
export interface ScoringCard {
  readonly definitionId: string;
  readonly name: string;
  /** Held now, or still somewhere in the face-down play deck. */
  readonly where: 'hand' | 'deck';
  /** Marginal TSD of its points at the current standing. */
  readonly tsd: number;
  /** Definition IDs of the candidate sites it is playable at. */
  readonly sites: readonly string[];
}

/** The answer for one position. */
export interface DeckReach {
  /** Every MP card still to play, with where it can be played. */
  readonly cards: readonly ScoringCard[];
  /** Their summed marginal value — the denominator of `coverage`. */
  readonly totalTsd: number;
  /**
   * Share of `totalTsd` (0..1) playable at some candidate site within one
   * movement of `siteDefinitionId`. Zero when nothing is left to score.
   */
  coverage(siteDefinitionId: string): number;
}

/**
 * The definition IDs of the play deck still face down: the deck list minus
 * every card the owner can see. A copy seen twice is removed twice, so two
 * copies in the list and one in hand leaves one unseen.
 */
export function unseenDeckCards(view: PlayerView, ownDeck: OwnDeckList): string[] {
  const remaining = new Map<string, number>();
  for (const id of [...ownDeck.playDeck, ...ownDeck.draftPool]) {
    remaining.set(id, (remaining.get(id) ?? 0) + 1);
  }
  const s = view.self;
  const seen: ViewCard[] = [
    ...s.hand, ...s.discardPile, ...s.sideboard, ...s.killPile, ...s.outOfPlayPile, ...s.cardsInPlay,
  ];
  for (const ch of Object.values(s.characters)) {
    seen.push({ instanceId: ch.instanceId, definitionId: ch.definitionId }, ...ch.items, ...ch.allies);
  }
  for (const card of seen) {
    const left = remaining.get(card.definitionId as string);
    if (left !== undefined) remaining.set(card.definitionId as string, left - 1);
  }
  const unseen: string[] = [];
  for (const [id, count] of remaining) {
    for (let i = 0; i < count; i++) unseen.push(id);
  }
  return unseen;
}

/** Candidate sites the player can move to, deduplicated and sorted. */
function candidateSites(view: PlayerView): string[] {
  const ids = new Set<string>();
  for (const company of view.self.companies) {
    for (const site of [company.currentSite, company.destinationSite]) {
      if (site) ids.add(site.definitionId as string);
    }
  }
  for (const site of view.self.siteDeck) ids.add(site.definitionId as string);
  return [...ids].sort();
}

function buildDeckReach(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  standing: Standing,
  ownDeck: OwnDeckList | undefined,
): DeckReach {
  const reach = computeReach(cardPool);
  const sites = candidateSites(view).filter(id => {
    const def = cardPool[id] as unknown as { cardType?: string } | undefined;
    return def !== undefined && SITE_CARD_TYPES.has(def.cardType ?? '');
  });
  const everyone = Object.keys(view.self.characters) as CardInstanceId[];

  const pending: { definitionId: string; where: 'hand' | 'deck' }[] = [
    ...view.self.hand.map(c => ({ definitionId: c.definitionId as string, where: 'hand' as const })),
    ...(ownDeck ? unseenDeckCards(view, ownDeck) : []).map(id => ({ definitionId: id, where: 'deck' as const })),
  ];

  const cards: ScoringCard[] = [];
  for (const { definitionId, where } of pending) {
    const def = cardPool[definitionId];
    if (!def) continue;
    const fields = def as unknown as { name?: string; marshallingPoints?: number; marshallingCategory?: string };
    const mp = fields.marshallingPoints ?? 0;
    if (mp <= 0) continue;
    const source = (fields.marshallingCategory ?? 'misc') as MpSource;
    const tsd = standing.tsdAfter({ [source]: mp }) - standing.tsd;
    if (tsd <= 0) continue;
    // A card restricted to a character nobody has is no reason to be anywhere.
    // Checked against everyone in play rather than one company: a company's
    // roster changes at the next organization phase, the deck's shape does not.
    if (!companyMayPlay(def, everyone, null, view, cardPool)) continue;
    const playableSites = sites.filter(id => resourcePlayableAt(def, cardPool[id] as never, view.self.alignment));
    // A card with no site at all (a non-site resource event) is not the
    // travel module's business; leaving it in would dilute every coverage.
    if (playableSites.length === 0) continue;
    cards.push({ definitionId, name: fields.name ?? definitionId, where, tsd, sites: playableSites });
  }
  const totalTsd = cards.reduce((sum, c) => sum + c.tsd, 0);

  const cache = new Map<string, number>();
  return {
    cards,
    totalTsd,
    coverage(siteDefinitionId: string): number {
      if (totalTsd <= 0) return 0;
      let share = cache.get(siteDefinitionId);
      if (share !== undefined) return share;
      let covered = 0;
      for (const card of cards) {
        const inReach = card.sites.some(target => {
          if (target === siteDefinitionId) return true;
          const distance = reach.between(siteDefinitionId, target);
          return distance !== null && distance <= BASE_MAX_REGION_DISTANCE;
        });
        if (inReach) covered += card.tsd;
      }
      share = covered / totalTsd;
      cache.set(siteDefinitionId, share);
      return share;
    },
  };
}

/** Build the deck-reach answer, once per position. See `core/memo`. */
export const computeDeckReach = memoizeOnFirst(buildDeckReach);
