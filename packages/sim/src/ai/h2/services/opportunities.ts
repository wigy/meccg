/**
 * @module ai/h2/services/opportunities
 *
 * The shared enumeration of what the hand could be played for, and where.
 *
 * `resources.proposePlans` and `factions.proposePlans` each privately computed
 * (card × candidate site) → playability, net payoff and route probability,
 * with the site enumeration and the harm netting duplicated between them. A
 * third consumer — `services/organization`, which needs the same answer to
 * price company shape — forces the extraction: after it, there is only one
 * answer in the codebase to "what is this card worth at that site", which is
 * the point. The organization potential's "resources to play for all" gate
 * must not be a second, private resource model.
 *
 * Everything here is the proposers' own arithmetic moved, not changed: the
 * candidate sites are where the company stands, where it is headed, and
 * everything still in the site deck (the first two matter because they are
 * precisely the sites that are *not* in the deck); playability is the
 * engine's own `resourcePlayableAt`; the payoff is marginal through
 * `standing` and net of the site's automatic attacks; and the route
 * probability is graded by the engine's own region distance. The proposers'
 * proposals are pinned byte-identical across the refactor by their tests and
 * a golden comparison.
 */

import type { CardDefinition, CardInstanceId, CompanyId, PlayerView } from '@meccg/shared';
import { memoizeOnFirst } from '../core/memo.js';
import type { Standing } from '../core/types.js';
import type { Tunables } from '../core/tunables.js';
import type { MpSource } from '../core/tsd.js';
import { reachProbability } from '../core/plan.js';
import { automaticAttacksOf, computeDefence } from './defence.js';
import type { Reach } from './reach.js';
import { computeReach } from './reach.js';
import { rosterOf } from './strike/prowess.js';
import { resourcePlayableAt } from '../../evaluators/common.js';

/** Site card types across every alignment — the site deck holds only these. */
const SITE_CARD_TYPES = new Set([
  'hero-site', 'minion-site', 'fallen-wizard-site', 'balrog-site',
]);

/** Whether a definition from the site deck is really a site. */
function isSiteDefinition(def: CardDefinition): boolean {
  return SITE_CARD_TYPES.has((def as unknown as { cardType?: string }).cardType ?? '');
}

/** A site's printed name, for plan labels and rationales. */
export function siteNameOf(def: CardDefinition): string {
  return (def as unknown as { name?: string }).name ?? 'an unnamed site';
}

/** The slice of a company the route arithmetic reads. */
export interface RoutedCompany {
  readonly currentSite?: { readonly definitionId: string } | null;
  readonly destinationSite?: { readonly definitionId: string } | null;
}

/** How a company relates to a site, and the chance it ever gets there. */
export interface RouteEstimate {
  /** The company is standing on the site right now. */
  readonly here: boolean;
  /** The company's committed movement already names the site. */
  readonly heading: boolean;
  /** Inclusive region distance, or null when the map does not join them. */
  readonly distance: number | null;
  /** Probability the company ever ends up at the site. */
  readonly routeProbability: number;
}

/**
 * The chance a company ends up at a site, graded by distance.
 *
 * The proposers' own rule, shared: certainty when the company is already
 * there or already headed there; otherwise `planUnroutedReachProbability`
 * per region still to cross; and the flat prior when the map does not join
 * the two sites, because an unreachable-looking site is far more often a gap
 * in the map than a real island.
 */
export function routeProbabilityFor(
  company: RoutedCompany,
  siteDefinitionId: string,
  reach: Reach,
  tunables: Tunables,
): RouteEstimate {
  const standingAt = company.currentSite?.definitionId;
  const here = standingAt === siteDefinitionId;
  const heading = company.destinationSite?.definitionId === siteDefinitionId;
  const from = company.destinationSite?.definitionId ?? standingAt;
  const distance = from === undefined ? null : reach.between(from, siteDefinitionId);
  const routeProbability = heading || here
    ? 1
    : distance === null
      ? tunables.planUnroutedReachProbability
      : reachProbability(distance, tunables.planUnroutedReachProbability);
  return { here, heading, distance, routeProbability };
}

/**
 * One playable, positive-net-worth (company, card, site) triple.
 *
 * Everything a proposer needs to turn it into a plan, and everything the
 * organization potential needs to treat it as a candidate goal.
 */
export interface Opportunity {
  /** The company the route and the harm were computed for. */
  readonly companyId: CompanyId;
  /** The card in hand. */
  readonly cardInstanceId: CardInstanceId;
  readonly cardDefinitionId: string;
  /** Printed name, falling back to the definition ID. */
  readonly cardName: string;
  /** The definition's card type, for consumers that filter by it. */
  readonly cardType: string;
  /** Which marshalling-point source the payoff lands in. */
  readonly source: MpSource;
  /** Raw marshalling points the play awards. */
  readonly mp: number;
  /** Printed influence target, when the definition carries one. */
  readonly influenceTarget?: number;
  /** Where the play would happen. */
  readonly siteDefinitionId: string;
  readonly siteName: string;
  /** Marginal TSD of the points through `standing` — never nominal MP. */
  readonly grossPayoffTsd: number;
  /** What the site's automatic attacks are expected to take back. */
  readonly harmTsd: number;
  /** `grossPayoffTsd − harmTsd`, always positive here. */
  readonly netPayoffTsd: number;
  /** How the company relates to the site. */
  readonly route: RouteEstimate;
}

/**
 * Every site a company's plan could name: where it stands, where it is
 * headed, and everything still in the deck. Deduplicated by definition,
 * because a site can be both current and still listed if the deck holds
 * another copy.
 */
function sitesFor(
  company: RoutedCompany,
  siteDeck: readonly { definitionId: string }[],
): { definitionId: string }[] {
  const seen = new Set<string>();
  const sites: { definitionId: string }[] = [];
  for (const site of [company.currentSite, company.destinationSite, ...siteDeck]) {
    if (!site || seen.has(site.definitionId)) continue;
    seen.add(site.definitionId);
    sites.push({ definitionId: site.definitionId });
  }
  return sites;
}

/**
 * Enumerate the opportunities of a position, in a deterministic order:
 * companies in view order, then hand cards in hand order, then candidate
 * sites in `sitesFor` order. The proposers preserve their old proposal order
 * by filtering this list.
 */
function buildEnumerateOpportunities(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  standing: Standing,
  tunables: Tunables,
): readonly Opportunity[] {
  const defence = computeDefence(view, cardPool, standing, tunables);
  const reach = computeReach(cardPool);
  const opportunities: Opportunity[] = [];

  for (const company of view.self.companies) {
    const candidateSites = sitesFor(company, view.self.siteDeck);
    const roster = rosterOf(company, view.self.characters, cardPool);
    // The site's toll is a property of (company, site) and not of the card,
    // so it is computed once per site rather than once per card.
    const harmAt = new Map<string, number>();
    const harmFor = (siteDefinitionId: string): number => {
      let harm = harmAt.get(siteDefinitionId);
      if (harm === undefined) {
        harm = defence.harmFrom(roster, automaticAttacksOf(cardPool, siteDefinitionId));
        harmAt.set(siteDefinitionId, harm);
      }
      return harm;
    };

    for (const card of view.self.hand) {
      const def = cardPool[card.definitionId];
      if (!def) continue;
      const fields = def as unknown as {
        name?: string;
        cardType?: string;
        marshallingPoints?: number;
        marshallingCategory?: string;
        influenceTarget?: number;
      };
      const mp = fields.marshallingPoints ?? 0;
      // A card worth no points is not a goal. It may still be worth playing
      // when the company is already standing there, and the modules' own
      // `evaluate` is where that is decided.
      if (mp <= 0) continue;
      const source = (fields.marshallingCategory ?? 'misc') as MpSource;
      // What the points are worth *here*, which is zero at the half-total
      // cap (CoE 10.3) — the whole reason this is marginal and not `mp * 20`.
      const grossPayoffTsd = standing.tsdAfter({ [source]: mp }) - standing.tsd;
      if (grossPayoffTsd <= 0) continue;

      for (const site of candidateSites) {
        const siteDef = cardPool[site.definitionId];
        if (!siteDef || !isSiteDefinition(siteDef)) continue;
        // Playability is the engine's own rule, reused rather than restated.
        if (!resourcePlayableAt(def, siteDef as never)) continue;

        // A goal worth less than the trip is not a goal: the filter that
        // already dropped points capped to zero also drops the ones the
        // site's automatic attacks would take back.
        const harmTsd = harmFor(site.definitionId);
        const netPayoffTsd = grossPayoffTsd - harmTsd;
        if (netPayoffTsd <= 0) continue;

        opportunities.push({
          companyId: company.id,
          cardInstanceId: card.instanceId,
          cardDefinitionId: card.definitionId,
          cardName: fields.name ?? card.definitionId,
          cardType: fields.cardType ?? '',
          source,
          mp,
          influenceTarget: fields.influenceTarget,
          siteDefinitionId: site.definitionId,
          siteName: siteNameOf(siteDef),
          grossPayoffTsd,
          harmTsd,
          netPayoffTsd,
          route: routeProbabilityFor(company, site.definitionId, reach, tunables),
        });
      }
    }
  }
  return opportunities;
}

/**
 * Build the enumeration, once per position.
 *
 * Two proposers and the organization potential all read it on the same
 * decision, and the answer cannot differ between them. See `core/memo`.
 */
export const enumerateOpportunities = memoizeOnFirst(buildEnumerateOpportunities);
