/**
 * @module ai/h2/modules/travel/travel
 *
 * The `travel` module — where a company should go.
 *
 * Plan §3.3 describes this as a recommendation engine over the site deck whose
 * destination value is *assembled from the acquisition modules*: `travel` asks
 * what `items` / `factions` / `allies` would pay to be standing somewhere, and
 * subtracts the cost of getting there. None of those modules exist yet, so
 * this version computes the part it can compute honestly and declares the rest
 * missing rather than inventing it.
 *
 * What it can compute honestly is the half that matters most and that H1 gets
 * wrong. H1 scores a destination by `max(10, mp * 20)` per playable hand card
 * — a linear weight in marshalling points. H2 values the same card through
 * `standing`, which knows what a point in that *source* is actually worth
 * right now: 2 if the opponent has none and ours double, 1 ordinarily, and
 * **0** if the source already sits at the half-total cap. A faction worth
 * nothing is worth nothing, and that is invisible to a linear weight — it is
 * the single clearest case in the whole design (§2.1).
 *
 * What is missing is stated on every evaluation: hazards en route are not
 * modelled, because doing so needs the belief half of `exposure` (§3.6) that
 * has not been built, and the acquisition modules' strategic view is absent so
 * only cards already in hand count toward a destination's worth.
 */

import type { CardInstanceId, GameAction, PlayerView } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import type { MpSource } from '../../core/tsd.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { computeBudget } from '../../services/budget.js';
import { computeExposure } from '../../services/exposure.js';
import type { SiteExposure } from '../../services/exposure.js';
import { resourcePlayableAt } from '../../../evaluators/common.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['plan-movement', 'pass'] as const;

/** What a hand card would be worth if the company stood at a destination. */
interface PlayableCard {
  readonly name: string;
  readonly source: MpSource;
  readonly marshallingPoints: number;
  /** TSD the card would add, valued through the standing rather than linearly. */
  readonly tsd: number;
}

/** Everything the module needs about one candidate destination. */
interface Destination {
  readonly action: GameAction;
  readonly site: SiteExposure;
  readonly playable: readonly PlayableCard[];
  /** Untapped characters available to tap for those plays. */
  readonly tapsAvailable: number;
}

/** Cards in hand that could be played at a site, valued through the standing. */
function playableAt(
  context: ModuleContext,
  siteDefinitionId: string,
): PlayableCard[] {
  const { view, cardPool, standing } = context;
  const siteDef = cardPool[siteDefinitionId];
  if (!siteDef) return [];
  const cards: PlayableCard[] = [];
  for (const card of view.self.hand) {
    const def = cardPool[card.definitionId];
    if (!def) continue;
    // Playability is the engine's rule, not a heuristic: reuse the predicate
    // rather than restate which site types accept which item classes.
    if (!resourcePlayableAt(def, siteDef as never)) continue;
    const record = def as unknown as { name?: string; marshallingPoints?: number; marshallingCategory?: string };
    const source = (record.marshallingCategory ?? 'misc') as MpSource;
    const points = record.marshallingPoints ?? 0;
    cards.push({
      name: record.name ?? (card.definitionId as string),
      source,
      marshallingPoints: points,
      // The whole point: a point in this source, priced by the tournament
      // scorer at the current standing, not by a constant.
      tsd: points > 0 ? standing.tsdAfter({ [source]: points }) - standing.tsd : 0,
    });
  }
  return cards;
}

/**
 * The site a `plan-movement` action would send the company to.
 *
 * The instance is looked up directly for its definition ID rather than
 * resolving a definition object and scanning the card pool for its identity —
 * that scan was O(pool) per candidate and, worse, silently returned null
 * whenever the definition did not come from the same pool object, which made
 * the whole module decline every movement it was offered.
 */
function destinationOf(view: PlayerView, action: GameAction): { definitionId: string } | null {
  const siteInstanceId = (action as unknown as { destinationSite?: CardInstanceId }).destinationSite;
  if (!siteInstanceId) return null;
  const fromDeck = view.self.siteDeck.find(c => c.instanceId === siteInstanceId);
  if (fromDeck) return { definitionId: fromDeck.definitionId };
  for (const company of view.self.companies) {
    for (const site of [company.currentSite, company.destinationSite]) {
      if (site && site.instanceId === siteInstanceId) return { definitionId: site.definitionId };
    }
  }
  return null;
}

/** Assumptions every travel evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'hazards en route are not modelled — that needs the belief half of `exposure` (§3.6), '
  + 'so a long site path is charged for its length but not for what is likely to be waiting on it',
  'only cards already in hand count toward a destination\'s worth; the acquisition modules\' '
  + 'strategic view (which sources are worth chasing at all) does not exist yet',
  'a resource play is assumed to need one tap, and no card is assumed to be playable twice',
];

/** Build the evaluation for one destination. */
function evaluateDestination(context: ModuleContext, destination: Destination): Evaluation {
  const { tunables, standing } = context;
  const { site, playable } = destination;

  // Cards that can actually be played are bounded by taps available: a company
  // standing on a pile of playable cards with everyone tapped scores none of
  // them. `budget` supplies the constraint rather than the module guessing it.
  const playableNow = playable.slice(0, Math.max(0, destination.tapsAvailable));
  const realized = playableNow.reduce((sum, c) => sum + c.tsd, 0);
  const beyondTaps = playable.length - playableNow.length;
  // Cards that fit the site but not this turn's taps are unlocked, not banked.
  const potential = playable.slice(playableNow.length).reduce((sum, c) => sum + c.tsd, 0);
  const tempo = site.pathLength * tunables.regionCrossingCost;

  const dtsd = netTsdDelta({ realized, potential, tempo }, tunables);
  const outcomes: Outcome[] = [{
    p: 1,
    label: playableNow.length > 0
      ? `arrive at ${site.name} and play ${playableNow.map(c => c.name).join(', ')}`
      : `arrive at ${site.name} with nothing to play`,
    dtsd,
  }];
  const scored = standing.score(outcomes);

  const detail: Rationale[] = [
    leaf('site', `${site.name} (${site.siteType})`),
    leaf('regions crossed', site.pathLength, {
      note: site.pathLength > 0 ? site.sitePath.join(' → ') : 'already here',
    }),
    leaf('travel tempo', tempo, { unit: 'tsd', tunable: 'regionCrossingCost' }),
    leaf('taps available', destination.tapsAvailable),
  ];
  for (const card of playableNow) {
    detail.push(leaf(card.name, card.tsd, {
      unit: 'tsd',
      note: `${card.marshallingPoints} ${card.source} MP, priced at the current standing`,
    }));
  }
  if (beyondTaps > 0) {
    detail.push(leaf(`${beyondTaps} more playable but no tap left`, potential, {
      unit: 'tsd',
      tunable: 'potentialDiscount',
      note: 'unlocked, not banked',
    }));
  }
  detail.push(leaf('acquisition modules', 0, {
    unit: 'tsd',
    note: 'items / factions / allies do not exist yet — a destination worth chasing for '
      + 'a card still in the deck scores nothing here',
  }));

  return {
    action: destination.action,
    module: 'travel',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(`travel to ${site.name}`, scored.utility, [
      node('destination', playable.length, detail),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: ASSUMPTIONS,
  };
}

/**
 * The travel module. Claims a decision only when every candidate is a movement
 * plan or the option to make none — which is the organization-phase movement
 * window and nothing else.
 */
export const travelModule: H2Module = {
  name: 'travel',
  ownedActionTypes: OWNED_ACTION_TYPES,

  claims(context: ModuleContext): boolean {
    // A context gate, not a coverage check. Requiring the module to own every
    // candidate was the all-or-nothing rule restated inside the module, and it
    // silenced `travel` on every real organization phase — where movement is
    // always offered alongside transfers and influence changes.
    //
    // What it does gate on: a `pass` here means "decline to move", which is
    // only an opinion worth having when there is somewhere to go.
    return context.legalActions.some(a => a.type === 'plan-movement');
  },

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    const budget = computeBudget(context.view, context.cardPool);
    const exposure = computeExposure(context.view, context.cardPool);

    if (action.type === 'pass') {
      // Staying put banks nothing and costs nothing — the baseline every
      // destination is measured against.
      const outcomes: Outcome[] = [{ p: 1, label: 'stay where the company stands', dtsd: 0 }];
      const scored = context.standing.score(outcomes);
      return {
        action,
        module: 'travel',
        outcomes,
        expectedTsd: scored.expectedTsd,
        sigmaTsd: scored.sigmaTsd,
        utility: scored.utility,
        method: scored.method,
        rationale: node('stay put', scored.utility, [
          leaf('moved', 0, { note: 'no travel tempo spent, nothing unlocked' }),
          scored.rationale,
        ], { unit: 'winprob' }),
        assumptions: ASSUMPTIONS,
      };
    }

    const destination = destinationOf(context.view, action);
    if (!destination) return null;
    const site = exposure.siteExposure(destination.definitionId);
    if (!site) return null;

    const companyId = (action as unknown as { companyId?: string }).companyId;
    const taps = companyId
      ? budget.untappedIn(companyId as never).length
      : budget.tapsAvailable;

    return evaluateDestination(context, {
      action,
      site,
      playable: playableAt(context, destination.definitionId),
      tapsAvailable: taps,
    });
  },
};
