/**
 * @module ai/h2/services/exposure
 *
 * The `exposure` service — how much hazard a company is opening itself to.
 *
 * Plan §3.1 gives this service two halves. This is the first: **how much** —
 * site-path length, the region types crossed, the hazard limit, and how many
 * cards the opponent is holding to spend against it. The second half, a belief
 * distribution over the *identity* of hidden cards, is a separate piece of work
 * with its own validation (§3.6, scored by log-loss against actually-revealed
 * on-guard cards) and is not here.
 *
 * Everything reported is a fact read off the view or the card. That line is
 * deliberate and it is where H1 went wrong: `evaluators/common.ts` carries a
 * `REGION_DANGER` table — wilderness 2, shadow-land 4, dark-domain 5 — which
 * is a *valuation* dressed as a lookup, tuned by hand and invisible to anyone
 * reading the destination score. Here the regions crossed are reported, and
 * what crossing them is worth belongs to `travel`, in TSD, in its rationale.
 *
 * The hazard limit is the number that matters most: it is the budget the
 * opponent gets to spend on the company, so it bounds everything the `hazards`
 * module can eventually do (§3.4) and it is the reason a long site path is
 * expensive rather than merely slow.
 */

import { effectiveHazardLimit } from '@meccg/shared';
import { memoizeOnFirst } from '../core/memo.js';
import { Phase } from '@meccg/shared';
import type {
  CardDefinition, Company, CompanyId, PlayerView, RegionType, SiteType,
} from '@meccg/shared';

/** What a company faces where it stands, or would face at a destination. */
export interface SiteExposure {
  /** The site's printed name. */
  readonly name: string;
  /** Its type — haven, border-hold, ruins-and-lairs, dark-hold, … */
  readonly siteType: SiteType;
  /** The regions crossed to reach it, in order. */
  readonly sitePath: readonly RegionType[];
  /**
   * How many regions are crossed. Each is a chance for the opponent to play
   * hazards keyed to that region, so this is the length of the exposure, not
   * merely the distance.
   */
  readonly pathLength: number;
  /** Resource cards drawn on arrival, printed on the site. */
  readonly resourceDraws: number;
}

/** How much hazard the opposing player can bring to bear. */
export interface Exposure {
  /** Cards in the opponent's hand — the ceiling on what they can spend. */
  readonly opponentHandSize: number;
  /** Cards in the opponent's discard pile: what they have already spent. */
  readonly opponentDiscardSize: number;
  /**
   * The live hazard limit for a company, or null outside the movement/hazard
   * phase where the notion does not apply.
   *
   * The engine snapshots this when the company reveals its movement and
   * accumulates post-reveal modifiers on top, so before the reveal it reads 0
   * — which means "not yet fixed", not "the opponent may spend nothing".
   * Consumers that care about the difference must check the phase step; this
   * service reports the engine's number rather than guessing at intent.
   */
  hazardLimit(companyId: CompanyId): number | null;
  /** The exposure of a site definition, if it is one. */
  siteExposure(definitionId: string): SiteExposure | null;
  /** Where the company stands now. */
  currentSite(companyId: CompanyId): SiteExposure | null;
  /** Where it is headed this turn, if anywhere. */
  destination(companyId: CompanyId): SiteExposure | null;
}

/** Site card types across every alignment. */
const SITE_CARD_TYPES = new Set([
  'hero-site', 'minion-site', 'fallen-wizard-site', 'balrog-site',
]);

/** The site fields this service reports, when the definition is a site. */
function readSite(def: CardDefinition | undefined): SiteExposure | null {
  if (!def || !SITE_CARD_TYPES.has(def.cardType)) return null;
  const site = def as unknown as {
    name?: string;
    siteType: SiteType;
    sitePath?: readonly RegionType[];
    resourceDraws?: number;
  };
  const sitePath = site.sitePath ?? [];
  return {
    name: site.name ?? '(unnamed site)',
    siteType: site.siteType,
    sitePath,
    pathLength: sitePath.length,
    resourceDraws: site.resourceDraws ?? 0,
  };
}

/**
 * Build the exposure service from a player view.
 *
 * The hazard limit is read through the engine's own `effectiveHazardLimit`,
 * which is the structural overload written for exactly this: it takes the
 * active constraints, the reveal snapshot and the pre-reveal constraint IDs,
 * all of which the view exposes. Recomputing it here would mean re-deriving
 * how a Dragon's "At Home" discard raises the limit mid-phase, and getting it
 * subtly wrong.
 */
function buildComputeExposure(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): Exposure {
  const companyOf = (companyId: CompanyId): Company | undefined =>
    view.self.companies.find(c => c.id === companyId);

  return {
    opponentHandSize: view.opponent.hand.length,
    opponentDiscardSize: view.opponent.discardPile.length,

    hazardLimit(companyId: CompanyId): number | null {
      if (view.phaseState.phase !== Phase.MovementHazard) return null;
      const mh = view.phaseState as unknown as {
        hazardLimitAtReveal?: number;
        preRevealHazardLimitConstraintIds?: readonly string[];
      };
      if (typeof mh.hazardLimitAtReveal !== 'number') return null;
      return effectiveHazardLimit(
        view.activeConstraints,
        mh.hazardLimitAtReveal,
        mh.preRevealHazardLimitConstraintIds ?? [],
        companyId,
      );
    },

    siteExposure(definitionId: string): SiteExposure | null {
      return readSite(cardPool[definitionId]);
    },

    currentSite(companyId: CompanyId): SiteExposure | null {
      const site = companyOf(companyId)?.currentSite;
      return site ? readSite(cardPool[site.definitionId]) : null;
    },

    destination(companyId: CompanyId): SiteExposure | null {
      const site = companyOf(companyId)?.destinationSite;
      return site ? readSite(cardPool[site.definitionId]) : null;
    },
  };
}

/**
 * Build the service, once per position.
 *
 * The registry asks every module about every candidate on a decision and hands
 * them all the same view, so this would otherwise be rebuilt once per
 * candidate for an answer that cannot differ. See `core/memo`.
 */
export const computeExposure = memoizeOnFirst(buildComputeExposure);
