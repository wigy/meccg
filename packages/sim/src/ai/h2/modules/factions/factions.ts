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
import { enumerateOpportunities, opportunityPlan } from '../../services/opportunities.js';
import type { Plan } from '../../core/plan.js';
import { CHECK_STEP } from '../../core/plan.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['influence-attempt'] as const;

/** Card types whose play is an influence attempt. */
const FACTION_CARD_TYPES = new Set(['hero-resource-faction', 'minion-resource-faction']);

/**
 * Target assumed for a faction whose definition does not print one.
 *
 * Not a tunable: it is a stand-in for missing card data rather than a
 * modelling choice, and a sweep over it would be sweeping over how many
 * factions this build happens to be missing a field for. Factions that do
 * print a target — which is nearly all of them — never reach it.
 */
const DEFAULT_INFLUENCE_TARGET = 8;

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
    const plans: Plan[] = [];

    // The enumeration — candidate sites, playability, the marginal payoff net
    // of the site's automatic attacks, the distance-graded route probability —
    // is the shared service's. What is this module's own is the check: the
    // printed target against the best free direct influence the company can
    // currently muster, because `evaluate` gets the engine's exact modifier
    // and a plan cannot.
    for (const opportunity of enumerateOpportunities(view, cardPool, standing, tunables)) {
      if (!FACTION_CARD_TYPES.has(opportunity.cardType)) continue;
      const best = budget.bestInfluencerIn(opportunity.companyId);
      const untapped = budget.untappedIn(opportunity.companyId).length;
      const need = Math.max(2, (opportunity.influenceTarget ?? DEFAULT_INFLUENCE_TARGET)
        - (best?.freeDirectInfluence ?? 0));
      const pCheck = pAtLeast(need);
      if (pCheck <= 0) continue;

      plans.push(opportunityPlan(opportunity, {
        module: 'factions',
        goalVerb: 'influence',
        goalSource: 'faction',
        carrierVerb: 'attempt',
        untappedInCompany: untapped,
        turnNumber: view.turnNumber,
        planHorizonTurns: tunables.planHorizonTurns,
        extraSteps: [{
          label: `pass the check (${need}+ on 2d6)`,
          p: pCheck,
          owner: 'factions',
          tag: CHECK_STEP,
          source: 'printed target less the company\'s free direct influence',
        }],
      }));
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
