/**
 * @module ai/h2/modules/factions/factions
 *
 * The `factions` module — whether to attempt an influence check.
 *
 * Plan §3.2 calls this the clearest example of the whole design, and it is,
 * because the two halves pull in opposite directions and only one of them is
 * visible to Heuristics 1.
 *
 * The dice half is exact and free: the engine publishes the fully-modified 2d6
 * target on the `influence-attempt` action it offers. `legal-actions/site.ts`
 * folds the influencing character's *free* direct influence into that modifier
 * (`infModifier += freeDI`) along with region restrictions, site-bound cards,
 * game-wide effects and agent bonuses, so `pAtLeast(need)` is the probability
 * of success with nothing reimplemented and nothing to drift.
 *
 * The other half is what the points are worth, and that is where H1 goes
 * wrong. It scores a faction at `marshallingPoints * 20` — a linear weight.
 * Under CoE §10.3 a faction point is worth 2 when the opponent has none and
 * ours double, 1 ordinarily, and **0** once the faction source already sits at
 * the half-total diversity cap. When it is 0, the correct play is to not
 * attempt: the check taps a character who could have done something else, and
 * a failed attempt discards the card for nothing. H1 will spend the turn.
 *
 * That is the case this module exists to get right, and `explain` shows the
 * marginal value it used.
 */

import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import { netTsdDelta } from '../../core/tsd.js';
import { pAtLeast } from '../../core/dice.js';
import { leaf, node } from '../../core/rationale.js';
import { computeBudget } from '../../services/budget.js';
import { automaticAttacksOf, computeDefence } from '../../services/defence.js';
import { computeReach } from '../../services/reach.js';
import { rosterOf } from '../../services/strike/prowess.js';
import { resourcePlayableAt } from '../../../evaluators/common.js';
import type { Plan } from '../../core/plan.js';
import { CARD_STEP, CARRIER_STEP, CHECK_STEP, ROUTE_STEP, reachProbability } from '../../core/plan.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['influence-attempt'] as const;

/** Card types whose play is an influence attempt. */
const FACTION_CARD_TYPES = new Set(['hero-resource-faction', 'minion-resource-faction']);

/** Site card types across every alignment — the site deck holds only these. */
const SITE_CARD_TYPES = new Set([
  'hero-site', 'minion-site', 'fallen-wizard-site', 'balrog-site',
]);

/**
 * Target assumed for a faction whose definition does not print one.
 *
 * Not a tunable: it is a stand-in for missing card data rather than a
 * modelling choice, and a sweep over it would be sweeping over how many
 * factions this build happens to be missing a field for. Factions that do
 * print a target — which is nearly all of them — never reach it.
 */
const DEFAULT_INFLUENCE_TARGET = 8;

/** Whether a definition from the site deck is really a site. */
function isSiteDefinition(def: CardDefinition): boolean {
  return SITE_CARD_TYPES.has((def as unknown as { cardType?: string }).cardType ?? '');
}


/**
 * Every site a company's plan could name: where it stands, where it is headed,
 * and everything still in the deck.
 *
 * The first two matter because they are precisely the sites that are *not* in
 * the deck. A proposer that scanned only the deck withdrew each plan the turn
 * its site was reached — the portfolio saw the proposal disappear and dropped
 * the commitment one decision before the `enter-site` that would have paid it
 * off. Deduplicated by definition, because a site can be both current and
 * still listed if the deck holds another copy.
 */
function sitesFor(
  company: { currentSite?: { definitionId: string } | null; destinationSite?: { definitionId: string } | null },
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

/** A site's printed name, for the plan's label. */
function siteNameOf(def: CardDefinition): string {
  return (def as unknown as { name?: string }).name ?? 'an unnamed site';
}

/** The faction card an attempt is aimed at. */
function factionOf(
  context: ModuleContext,
  action: GameAction,
): { name: string; marshallingPoints: number } | null {
  const instanceId = (action as unknown as { factionInstanceId?: CardInstanceId }).factionInstanceId;
  if (!instanceId) return null;
  const card = context.view.self.hand.find(c => c.instanceId === instanceId);
  const def: CardDefinition | undefined = card ? context.cardPool[card.definitionId] : undefined;
  if (!def) return null;
  const record = def as unknown as { name?: string; marshallingPoints?: number };
  return {
    name: record.name ?? (instanceId as string),
    marshallingPoints: record.marshallingPoints ?? 0,
  };
}

/** Assumptions every influence evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'the opponent plays nothing into the check — a cancelling hazard would waste the attempt entirely',
  'a failed attempt is assumed to cost the card; boost options that could be spent to raise the '
  + 'target are scored as separate actions, not folded into this one',
  'the tapped character\'s other uses are priced by a flat tunable, not by what it was needed for',
];

/**
 * The influence-attempt module. Its context gate is trivially true — an
 * `influence-attempt` is always a faction decision — so ownership is decided
 * by the action type alone.
 */
export const factionsModule: H2Module = {
  name: 'factions',
  ownedActionTypes: OWNED_ACTION_TYPES,

  /**
   * The second proposer: *influence this faction at that site*.
   *
   * The same shape as `resources`, and for the same measured reason — over six
   * games `faction-influence-roll` was offered **zero** times and
   * `influence-attempt` eleven, against a human-corpus median of 5 faction MP
   * a game. A faction is only attemptable at a site it is playable at, and
   * nothing was routing a company to one.
   *
   * Four steps, and the fourth is the interesting one. Getting there is
   * `travel`'s; keeping the card is `hand`'s; having someone able to make the
   * attempt is `characters`'. The check itself is a real 2d6 that **no action
   * moves**, and it is included anyway: leaving it out would price every
   * faction plan as though the roll were free, and the portfolio's abandon
   * rule reads that number. It is the one static step in the layer, and it is
   * static because that is the truth about a die, not because a model is
   * missing.
   *
   * The check probability here is an approximation and says so. The engine
   * publishes the fully-modified target on an `influence-attempt` it actually
   * offers — which is what `evaluate` uses and why that half of the module is
   * exact — but a plan is made turns before any such action exists, so this
   * uses the printed target against the best free direct influence the company
   * can currently muster.
   */
  proposePlans(context: ModuleContext) {
    const { view, cardPool, standing, tunables } = context;
    const budget = computeBudget(view, cardPool);
    const defence = computeDefence(view, cardPool, standing, tunables);
    const reach = computeReach(cardPool);
    const plans: Plan[] = [];

    for (const company of view.self.companies) {
      const standingAt = company.currentSite?.definitionId;
      const best = budget.bestInfluencerIn(company.id);
      const untapped = budget.untappedIn(company.id).length;
      // See `resources`: a site in play has left the site deck, and scanning
      // the deck alone withdraws a plan the turn it arrives.
      const candidateSites = sitesFor(company, view.self.siteDeck);
      const roster = rosterOf(company, view.self.characters, cardPool);

      for (const card of view.self.hand) {
        const def = cardPool[card.definitionId];
        if (!def) continue;
        const fields = def as unknown as {
          name?: string;
          cardType?: string;
          marshallingPoints?: number;
          influenceTarget?: number;
        };
        if (!FACTION_CARD_TYPES.has(fields.cardType ?? '')) continue;
        const mp = fields.marshallingPoints ?? 0;
        if (mp <= 0) continue;
        const grossPayoffTsd = standing.tsdAfter({ faction: mp }) - standing.tsd;
        // Zero at the half-total cap (CoE 10.3), and a plan chasing points
        // that cap straight back off is not a plan.
        if (grossPayoffTsd <= 0) continue;

        // The printed target, reduced by the influence the company can bring.
        // `evaluate` gets the engine's exact modifier; a plan cannot.
        const need = Math.max(2, (fields.influenceTarget ?? DEFAULT_INFLUENCE_TARGET)
          - (best?.freeDirectInfluence ?? 0));
        const pCheck = pAtLeast(need);
        if (pCheck <= 0) continue;

        for (const site of candidateSites) {
          const siteDef = cardPool[site.definitionId];
          if (!siteDef || !isSiteDefinition(siteDef)) continue;
          if (!resourcePlayableAt(def, siteDef as never)) continue;

          // Standing on the site is deliberately *not* routed. Entry is a
          // separate decision with the site's automatic attacks behind it, and
          // counting arrival as certainty is what made `enter-site` worth
          // nothing to the plan it was about to complete.
          // What the journey costs. A plan that never asked whether the
          // company survives is how the agent came to walk confidently into
          // sites it cannot live through: measured at n=20 the layer doubled
          // the rate of entering sites and moved no marshalling-point category
          // at all, while `kill` — the passive one — was the only number that
          // rose. Netted off the payoff rather than expressed as a probability,
          // because `defence` reports harm in TSD and a harm-to-probability
          // conversion would be a second model of the same thing.
          const harmTsd = defence.harmFrom(roster, automaticAttacksOf(cardPool, site.definitionId));
          const netPayoffTsd = grossPayoffTsd - harmTsd;
          // A goal worth less than the trip is not a goal. The filter that
          // already dropped points capped to zero now also drops the ones the
          // site would take back.
          if (netPayoffTsd <= 0) continue;

          // Graded by distance rather than by a yes/no. A binary step could
          // only be moved by a candidate that lands exactly on the plan's
          // site, and the engine offers those only when the site is already
          // within one turn's movement — so a commitment to anywhere further
          // credited no move at all, and the agent stood still.
          const here = standingAt === site.definitionId;
          const heading = company.destinationSite?.definitionId === site.definitionId;
          const from = company.destinationSite?.definitionId ?? standingAt;
          const distance = from === undefined ? null : reach.between(from, site.definitionId);
          const routeProbability = heading || here
            ? 1
            : distance === null
              // The map does not join them. Treated as the old flat prior
              // rather than as impossible: an unreachable-looking site is far
              // more often a gap in the map than a real island.
              ? tunables.planUnroutedReachProbability
              : reachProbability(distance, tunables.planUnroutedReachProbability);
          plans.push({
            id: `factions/${card.instanceId as string}@${site.definitionId}`,
            module: 'factions',
            goal: {
              label: `influence ${fields.name ?? card.definitionId} at ${siteNameOf(siteDef)}`,
              source: 'faction',
              mp,
              cardInstanceId: card.instanceId,
              siteDefinitionId: site.definitionId,
            },
            payoffTsd: netPayoffTsd,
            deadline: view.turnNumber + tunables.planHorizonTurns,
            requirements: [{
              kind: 'company-at-site',
              companyId: company.id,
              siteDefinitionId: site.definitionId,
              byTurn: view.turnNumber + tunables.planHorizonTurns,
            }],
            steps: [
              {
                label: `route to ${siteNameOf(siteDef)}`,
                p: routeProbability,
                owner: 'travel',
                tag: ROUTE_STEP,
                source: heading || here
                  ? 'already there or already headed there'
                  : `${distance ?? '?'} region(s) away, at planUnroutedReachProbability per region`,
              },
              {
                label: `still hold ${fields.name ?? card.definitionId}`,
                p: 1,
                owner: 'hand',
                tag: CARD_STEP,
              },
              {
                label: 'someone left untapped to attempt it',
                // Present tense, and only where the play is imminent. Asked
                // three turns out it is not a probability at all: an untap
                // phase stands between here and the goal, and reading "everyone
                // is tapped right now" as "this plan is impossible" abandoned
                // every commitment during the site phase — which is exactly
                // when the companies are tapped.
                p: !here || untapped > 0 ? 1 : 0,
                owner: 'characters',
                tag: CARRIER_STEP,
              },
              {
                label: `pass the check (${need}+ on 2d6)`,
                p: pCheck,
                owner: 'factions',
                tag: CHECK_STEP,
                source: 'printed target less the company\'s free direct influence',
              },
            ],
          });
        }
      }
    }
    return plans;
  },

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (action.type !== 'influence-attempt') return null;
    const need = (action as unknown as { need?: number }).need;
    if (typeof need !== 'number') return null;
    const faction = factionOf(context, action);
    if (!faction) return null;

    const { standing, tunables } = context;
    // `need <= 0` is the engine's automatic-influence case: no roll at all.
    const pSuccess = need <= 0 ? 1 : pAtLeast(need);

    // What the points are actually worth here — 2, 1, or 0 — rather than a
    // multiple of the printed number.
    const gain = faction.marshallingPoints > 0
      ? standing.tsdAfter({ faction: faction.marshallingPoints }) - standing.tsd
      : 0;

    const influencerId = (action as unknown as { influencingCharacterId?: CardInstanceId }).influencingCharacterId;
    const budget = computeBudget(context.view, context.cardPool);
    const influencer = influencerId ? budget.characters[influencerId as string] : undefined;

    // The attempt taps the character whether or not it succeeds, and a failed
    // attempt loses the card. Both are charged against every outcome that
    // incurs them rather than only the bad one.
    const tapCost = tunables.tapTempoCost;
    const outcomes: Outcome[] = [];
    if (pSuccess > 0) {
      outcomes.push({
        p: pSuccess,
        label: `${faction.name} influenced — ${faction.marshallingPoints} faction MP`,
        dtsd: netTsdDelta({ realized: gain, tempo: tapCost }, tunables),
      });
    }
    if (pSuccess < 1) {
      outcomes.push({
        p: 1 - pSuccess,
        label: `the check fails — ${faction.name} discarded, character tapped for nothing`,
        dtsd: netTsdDelta({ realized: 0, tempo: tapCost + tunables.provisionalCardPrice }, tunables),
      });
    }

    const scored = standing.score(outcomes);
    const detail: Rationale[] = [
      leaf('need on 2d6', need, {
        note: need <= 0
          ? 'automatic — no roll'
          : 'published by the engine, free direct influence and every modifier already folded in',
      }),
      leaf('P(success)', pSuccess, { unit: 'p' }),
      leaf('faction marshalling points', faction.marshallingPoints, { unit: 'mp' }),
      leaf('worth of one faction point here', standing.marginal.faction, {
        unit: 'tsd',
        note: standing.marginal.faction === 0
          ? 'zero — the faction source is already at the half-total cap (CoE 10.3), so the '
            + 'attempt cannot pay however well it rolls'
          : 'CoE 10.3, after doubling and the diversity cap',
      }),
      leaf('gain if it succeeds', gain, { unit: 'tsd' }),
      leaf('character tapped', influencer ? influencer.name : 'unknown', {
        note: influencer ? `${influencer.freeDirectInfluence} free direct influence` : undefined,
      }),
      leaf('tap tempo', tapCost, { unit: 'tsd', tunable: 'tapTempoCost' }),
      leaf('card lost on failure', tunables.provisionalCardPrice, {
        unit: 'tsd', tunable: 'provisionalCardPrice',
      }),
    ];

    return {
      action,
      module: 'factions',
      outcomes,
      expectedTsd: scored.expectedTsd,
      sigmaTsd: scored.sigmaTsd,
      utility: scored.utility,
      method: scored.method,
      rationale: node(`influence ${faction.name}`, scored.utility, [
        node('attempt', need, detail),
        scored.rationale,
      ], { unit: 'winprob' }),
      assumptions: ASSUMPTIONS,
    };
  },
};
