/**
 * @module ai/h2/modules/resources/resources
 *
 * The `resources` module — playing a card at the site for marshalling points.
 *
 * The plan splits acquisition three ways (`items`, `allies`, `misc`) because
 * §10.3 doubles and caps *per source*, so each source has its own marginal
 * value curve. That split is real and it is preserved here — but it lives in
 * the valuation, not in the module boundary, because the engine offers all of
 * them through one action type (`play-hero-resource`). A module that owned
 * only "items" could not cover the decision, and under collective coverage an
 * uncovered candidate sends the whole site phase to Heuristics 1.
 *
 * So one module owns the action and asks `standing` what a point in *that
 * card's* source is worth: 2 when the opponent has none and ours double, 1
 * ordinarily, 0 at the half-total cap. The per-source curve is exactly what
 * decides between playing the item and playing the ally, and it is the thing
 * H1's flat `mp * 20` cannot express.
 *
 * The strategic half of the plan's acquisition layer — which sources are worth
 * chasing across the whole game, and which targets — is not here. This values
 * a card that can be played *now*, at the site the company is standing on.
 */

import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import type { Plan } from '../../core/plan.js';
import { CARD_STEP, CARRIER_STEP, ROUTE_STEP, reachProbability } from '../../core/plan.js';
import type { MpSource } from '../../core/tsd.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { computeCharacterValue } from '../../services/character-value.js';
import { computeBudget } from '../../services/budget.js';
import { automaticAttacksOf, computeDefence } from '../../services/defence.js';
import { computeReach } from '../../services/reach.js';
import { rosterOf } from '../../services/strike/prowess.js';
import { resourcePlayableAt } from '../../../evaluators/common.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['play-hero-resource', 'play-minor-item'] as const;

/** Site card types across every alignment — the site deck holds only these. */
const SITE_CARD_TYPES = new Set([
  'hero-site', 'minion-site', 'fallen-wizard-site', 'balrog-site',
]);

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

/** The card a play action names, with the source its points count against. */
function cardOf(
  context: ModuleContext,
  action: GameAction,
): { name: string; source: MpSource; marshallingPoints: number; corruption: number } | null {
  const record = action as unknown as { cardInstanceId?: CardInstanceId; itemInstanceId?: CardInstanceId };
  const instanceId = record.cardInstanceId ?? record.itemInstanceId;
  if (!instanceId) return null;
  const card = context.view.self.hand.find(c => c.instanceId === instanceId);
  const def: CardDefinition | undefined = card ? context.cardPool[card.definitionId] : undefined;
  if (!def) return null;
  const fields = def as unknown as {
    name?: string;
    marshallingPoints?: number;
    marshallingCategory?: string;
    corruptionPoints?: number;
  };
  return {
    name: fields.name ?? (instanceId as string),
    source: (fields.marshallingCategory ?? 'misc') as MpSource,
    marshallingPoints: fields.marshallingPoints ?? 0,
    corruption: fields.corruptionPoints ?? 0,
  };
}

/** Assumptions every resource evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'the play is assumed to tap the bearer; a card that does not tap is over-charged by one tap',
  'the corruption a card brings is priced as one future check: the rise in the failing band '
  + 'times what failing costs. A character who faces several checks is under-charged, and one '
  + 'who never faces any is over-charged',
  'only what the card is worth now is counted; whether this source is worth chasing across the '
  + 'game is the acquisition layer\'s strategic half, which does not exist yet',
];

/**
 * The resource-play module. No context gate: a `play-hero-resource` is always
 * a resource decision, so the action type alone decides ownership.
 */
export const resourcesModule: H2Module = {
  name: 'resources',
  ownedActionTypes: OWNED_ACTION_TYPES,

  /**
   * The first proposer of the plan layer: *play this card at that site*.
   *
   * This is the strategic half the module docstring above says is missing, in
   * its narrowest possible form. `evaluate` prices a card that can be played
   * **now**, at the site the company is already standing on — and the measured
   * consequence is that `play-hero-resource` reaches the candidate list four
   * times in six games, because nothing ever routes a company to a site where a
   * card in hand is playable. The module was never declining to score; it was
   * never asked.
   *
   * So the goal is the card, and the site comes from the *site deck* rather
   * than from where the company happens to stand.
   *
   * Three steps, and `resources` owns none of them. Getting there is
   * `travel`'s, because the probability of reaching a site is a movement
   * question. Keeping the card is `hand`'s, because `hand` is what discards.
   * Having someone able to make the play is `characters`', because every
   * action that changes who stands in a company is one of its. A proposer
   * naming a step it cannot move would be a constant pretending to be a
   * probability; naming one another module owns is the whole coupling
   * mechanism.
   */
  proposePlans(context: ModuleContext) {
    const { view, cardPool, standing, tunables } = context;
    const budget = computeBudget(view, cardPool);
    const defence = computeDefence(view, cardPool, standing, tunables);
    const reach = computeReach(cardPool);
    const plans: Plan[] = [];

    for (const company of view.self.companies) {
      const standingAt = company.currentSite?.definitionId;
      const untappedInCompany = budget.untappedIn(company.id).length;
      // The site deck is not the whole world. A site the company is standing
      // on, or already headed to, has *left* the deck — so scanning the deck
      // alone withdrew every plan at the exact moment it was about to pay off,
      // and the portfolio dropped it as `withdrawn` one decision before the
      // `enter-site` that would have completed it.
      const candidateSites = sitesFor(company, view.self.siteDeck);
      const roster = rosterOf(company, view.self.characters, cardPool);
      for (const card of view.self.hand) {
        const def = cardPool[card.definitionId];
        if (!def) continue;
        const fields = def as unknown as {
          name?: string;
          marshallingPoints?: number;
          marshallingCategory?: string;
        };
        const mp = fields.marshallingPoints ?? 0;
        // A card worth no points is not a commitment. It may still be worth
        // playing when the company is already standing there, and `evaluate`
        // is where that is decided.
        if (mp <= 0) continue;
        const source = (fields.marshallingCategory ?? 'misc') as MpSource;
        // What the points are worth *here*, which is zero at the half-total
        // cap — the whole reason this is a marginal figure and not `mp * 20`.
        const grossPayoffTsd = standing.tsdAfter({ [source]: mp }) - standing.tsd;
        if (grossPayoffTsd <= 0) continue;

        for (const site of candidateSites) {
          const siteDef = cardPool[site.definitionId];
          if (!siteDef || !isSiteDefinition(siteDef)) continue;
          // Playability is the engine's own rule, reused rather than restated:
          // guessing which site types accept which item classes is how the
          // agent ends up entering a site for an item it is then refused.
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
            // Stable across turns: the card and the site are what the
            // commitment is about, and the portfolio recognises an incumbent
            // by this string alone.
            id: `resources/${card.instanceId as string}@${site.definitionId}`,
            module: 'resources',
            goal: {
              label: `play ${fields.name ?? card.definitionId} at ${siteNameOf(siteDef)}`,
              source,
              mp,
              cardInstanceId: card.instanceId,
              siteDefinitionId: site.definitionId,
            },
            payoffTsd: netPayoffTsd,
            // The site deck is walked in order and a site is spent when it is
            // reached, so a plan that has not happened within the horizon has
            // been overtaken by the game rather than merely delayed.
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
                label: 'someone left untapped to play it',
                // Present tense, and only where the play is imminent — see
                // the note in `factions`: three turns out an untap phase
                // stands between here and the goal.
                p: !here || untappedInCompany > 0 ? 1 : 0,
                owner: 'characters',
                tag: CARRIER_STEP,
              },
            ],
          });
        }
      }
    }
    return plans;
  },

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    const card = cardOf(context, action);
    if (!card) return null;
    const { standing, tunables } = context;

    // The point of the whole design: what a point in *this* source is worth
    // right now, from the tournament scorer, not a constant per MP.
    const gain = card.marshallingPoints > 0
      ? standing.tsdAfter({ [card.source]: card.marshallingPoints }) - standing.tsd
      : 0;
    // Carrying corruption widens the band on every later check, and that is a
    // cost of playing the card whether or not a check ever comes. Priced
    // through the shared service so `corruption` and this module cannot
    // disagree about what a failure is worth.
    const bearerId = (action as unknown as { attachToCharacterId?: CardInstanceId; characterId?: CardInstanceId })
      .attachToCharacterId ?? (action as unknown as { characterId?: CardInstanceId }).characterId;
    const risk = card.corruption === 0
      ? { tsd: 0, reason: 'the card carries no corruption' }
      : bearerId
        ? computeCharacterValue(context.view, context.cardPool, standing, tunables)
          .corruptionRisk(bearerId, card.corruption)
        : { tsd: 0, reason: `carries ${card.corruption} corruption, but the action names no bearer to charge it to` };

    const dtsd = netTsdDelta({ realized: gain, tempo: tunables.tapTempoCost + risk.tsd }, tunables);

    const outcomes: Outcome[] = [{
      p: 1,
      label: card.marshallingPoints > 0
        ? `play ${card.name} — ${card.marshallingPoints} ${card.source} MP`
        : `play ${card.name} — no marshalling points`,
      dtsd,
    }];
    const scored = standing.score(outcomes);

    const detail: Rationale[] = [
      leaf('card', card.name),
      leaf('marshalling points', card.marshallingPoints, { unit: 'mp', note: `${card.source} source` }),
      leaf(`worth of one ${card.source} point here`, standing.marginal[card.source], {
        unit: 'tsd',
        note: standing.marginal[card.source] === 0
          ? 'zero — that source is already at the half-total cap (CoE 10.3), so these points '
            + 'would be capped straight back off'
          : 'CoE 10.3, after doubling and the diversity cap',
      }),
      leaf('gain', gain, { unit: 'tsd' }),
      leaf('tap tempo', tunables.tapTempoCost, { unit: 'tsd', tunable: 'tapTempoCost' }),
    ];
    if (card.corruption > 0) {
      detail.push(leaf('corruption risk', risk.tsd, { unit: 'tsd', note: risk.reason }));
    }

    return {
      action,
      module: 'resources',
      outcomes,
      expectedTsd: scored.expectedTsd,
      sigmaTsd: scored.sigmaTsd,
      utility: scored.utility,
      method: scored.method,
      rationale: node(`play ${card.name}`, scored.utility, [
        node('resource', card.marshallingPoints, detail),
        scored.rationale,
      ], { unit: 'winprob' }),
      assumptions: ASSUMPTIONS,
    };
  },
};
