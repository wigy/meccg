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
import type { MpSource } from '../../core/tsd.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { computeCharacterValue } from '../../services/character-value.js';
import { computeBudget } from '../../services/budget.js';
import { enumerateOpportunities, opportunityPlan } from '../../services/opportunities.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['play-hero-resource', 'play-minor-item'] as const;

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
    const plans: Plan[] = [];

    // The enumeration — candidate sites, playability, the marginal payoff net
    // of the site's automatic attacks, the distance-graded route probability —
    // and the plan skeleton are the shared service's. This proposer's own
    // judgement is only the wording it stamps on top: "play" the card, with
    // no steps beyond the shared three.
    for (const opportunity of enumerateOpportunities(view, cardPool, standing, tunables)) {
      const untappedInCompany = budget.untappedIn(opportunity.companyId).length;
      plans.push(opportunityPlan(opportunity, {
        module: 'resources',
        goalVerb: 'play',
        goalSource: opportunity.source,
        carrierVerb: 'play',
        untappedInCompany,
        turnNumber: view.turnNumber,
        planHorizonTurns: tunables.planHorizonTurns,
      }));
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
