/**
 * @module ai/h2/modules/hazards/hazards
 *
 * The `hazards` module — spending the hazard limit against a moving company.
 *
 * §3.4 argues that hazard play does not fit the per-action evaluation seam, and
 * this module is the concession to that argument rather than a denial of it.
 * Three properties force the shape:
 *
 * - **The objective is denial, not damage** — priced in `denial.ts`, capped by
 *   what the opponent could actually have done with the characters.
 * - **Value is supermodular** — so a bundle is resolved as one sequence of
 *   attacks against a degrading roster (`services/strike/sequence`), never as a
 *   sum of independent scores.
 * - **The budget is the hazard limit** — a knapsack, searched with a beam whose
 *   width is a stated tunable and whose truncation is reported.
 *
 * **Where this departs from the plan, and why.** §3.4 asks for a plan committed
 * to the module context and recomputed only on deviation. This module re-plans
 * on every action instead. The reason is that it turned out not to need the
 * cache: attacks resolve one at a time against the company, so the roster read
 * from the view *already* carries the damage the earlier hazards did, and the
 * marginal value of the next creature is therefore correct without remembering
 * anything. Caching would buy speed and cost the ability to say that. The
 * dribbling failure the plan worried about is still prevented, by the other
 * half of the design: an action is scored by the value of the best *bundle*
 * that starts with it, so a first creature that looks weak alone is still
 * played when the pair is worth it — and once it is played, supermodularity
 * makes the second one look better, not worse, so the plan is not abandoned
 * halfway.
 *
 * **What it does not do yet.** Hazard *events* — Doors of Night, the company
 * restrictions, everything that is not a creature attack — are declined, so a
 * decision containing them is only partly covered and the registry says so.
 * Modelling them means modelling their effects, which is the DSL's job and a
 * separate piece of work.
 */

import { CardStatus, Phase } from '@meccg/shared';
import type { CardDefinition, GameAction, OpponentCompanyView, PlayerView } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Rationale } from '../../core/types.js';
import { leaf, node } from '../../core/rationale.js';
import { memoizeOnFirst } from '../../core/memo.js';
import { computeBeliefs } from '../../services/beliefs.js';
import { computeExposure } from '../../services/exposure.js';
import { rosterOf } from '../../services/strike/prowess.js';
import type { StrikeTarget } from '../../services/strike/prowess.js';
import type { AttackProfile } from '../../services/strike/sequence.js';
import type { Bundle, BundleSearch, Candidate } from './bundle.js';
import { bestBundleStartingWith, planBundles } from './bundle.js';
import { denialContext, denialPricer } from '../../services/denial.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['play-hazard', 'place-on-guard', 'pass'] as const;

/** Assumptions every hazard evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'attacks are assumed non-detainment and free of card-specific combat effects: the creature\'s '
  + 'printed strikes, prowess and body are modelled, its text is not',
  'the defender is assumed to answer each strike with its best available parrier and to spend no '
  + 'cards from hand — every strike event, dodge or cancel they hold makes the bundle worth less '
  + 'than this says',
  'the defender is assumed to tap to fight every strike, which is the common choice but not the '
  + 'only one: a character who stays untapped at -3 prowess denies this bundle the tap it counts',
  'the bundle is priced against the company as it stands now; a hazard the opponent answers by '
  + 'cancelling the attack outright is not modelled',
  'on-guard placement is priced as a discounted version of playing the same card at the company, '
  + 'not as a distinct decision about the site it guards',
];

/** Whether the acting player is the hazard player in a live play-hazards step. */
function inHazardWindow(view: PlayerView): boolean {
  if (view.phaseState.phase !== Phase.MovementHazard) return false;
  const state = view.phaseState as unknown as { step?: string };
  return state.step === 'play-hazards';
}

/** The company whose movement/hazard phase is being resolved, from the hazard seat. */
function activeCompany(view: PlayerView): OpponentCompanyView | null {
  const state = view.phaseState as unknown as { activeCompanyIndex?: number };
  const index = state.activeCompanyIndex ?? 0;
  return view.opponent.companies[index] ?? view.opponent.companies[0] ?? null;
}

/** The creature card behind a `play-hazard`, or null when it is not a creature. */
function creatureProfile(
  cardPool: Readonly<Record<string, CardDefinition>>,
  definitionId: string,
): { profile: Omit<AttackProfile, 'killTsd' | 'killLabel'>; killMp: number; name: string } | null {
  const def = cardPool[definitionId] as unknown as {
    cardType?: string;
    name?: string;
    strikes?: number;
    prowess?: number;
    body?: number | null;
    killMarshallingPoints?: number;
  } | undefined;
  if (!def || def.cardType !== 'hazard-creature') return null;
  return {
    name: def.name ?? definitionId,
    killMp: def.killMarshallingPoints ?? 0,
    profile: {
      strikeProwess: def.prowess ?? 0,
      strikes: def.strikes ?? 1,
      creatureBody: def.body ?? null,
      // Detainment is derived by the engine from race and company type, and is
      // not a field on the card. Assuming a normal attack overstates the harm
      // of the creatures that are in fact detainment; it is declared above.
      detainment: false,
      bodyCheckModifier: 0,
      name: def.name ?? definitionId,
    },
  };
}

/** Every creature in hand the engine is currently offering against a company. */
function candidatesFor(
  context: ModuleContext,
  companyId: string,
  killTsdOf: (killMp: number) => number,
): Candidate[] {
  const { view, cardPool } = context;
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const action of context.legalActions) {
    if (action.type !== 'play-hazard') continue;
    const play = action as unknown as { cardInstanceId: string; targetCompanyId: string };
    if (play.targetCompanyId !== companyId) continue;
    if (seen.has(play.cardInstanceId)) continue;
    const card = view.self.hand.find(c => (c.instanceId as string) === play.cardInstanceId);
    if (!card) continue;
    const creature = creatureProfile(cardPool, card.definitionId as string);
    if (!creature) continue;
    seen.add(play.cardInstanceId);
    candidates.push({
      instanceId: play.cardInstanceId,
      name: creature.name,
      killMp: creature.killMp,
      profile: {
        ...creature.profile,
        killTsd: killTsdOf(creature.killMp),
        killLabel: `${creature.name} beaten — ${creature.killMp} kill MP to the defender`,
      },
    });
  }
  return candidates;
}

/** Everything the module needs to price any action at this decision. */
interface Plan {
  readonly company: OpponentCompanyView;
  readonly roster: readonly StrikeTarget[];
  readonly search: BundleSearch;
  readonly detail: readonly Rationale[];
}

/** Build the plan: roster, denial context, ranked bundles. */
function planFor(context: ModuleContext, company: OpponentCompanyView): Plan {
  const { view, cardPool, standing, tunables } = context;
  const beliefs = computeBeliefs(view, cardPool);
  const exposure = computeExposure(view, cardPool);
  const denial = denialContext(view, company, beliefs, standing, tunables);
  const roster = rosterOf(company, view.opponent.characters, cardPool);
  const price = denialPricer(cardPool, standing, tunables, denial);

  // Kill MP goes to the *defender*, so it is a loss to us — which is why the
  // sign is flipped here and nowhere else. `standing` reports it as zero when
  // their kill source is already capped, in which case a creature they can beat
  // costs nothing but the card.
  const killTsdOf = (killMp: number): number =>
    (killMp > 0 ? standing.tsdAfter({}, { kill: killMp }) - standing.tsd : 0);

  const candidates = candidatesFor(context, company.id as string, killTsdOf);
  const limit = exposure.hazardLimit(company.id);
  const played = (view.phaseState as unknown as { hazardsPlayedThisCompany?: number })
    .hazardsPlayedThisCompany ?? 0;
  const slots = Math.max(0, (limit ?? 0) - played);
  const search = planBundles(candidates, roster, cardPool, price, standing, tunables, slots);

  const detail: Rationale[] = [
    leaf('company', company.characters.length, {
      note: `${denial.untapped} untapped of ${company.characters.length}`,
    }),
    leaf('hazard limit', slots, {
      note: limit === null ? 'no limit published outside movement' : `${limit} at reveal, ${played} spent`,
    }),
    leaf('resource plays they are believed to hold', denial.believedPlays, {
      note: `${(beliefs.confidence * 100).toFixed(0)}% confidence, ${beliefs.observed} cards seen`,
    }),
    leaf('worth denying one resource play', denial.fullPlay, {
      unit: 'tsd',
      tunable: 'deniedPlayMp',
      note: denial.tapUtilisation >= 1
        ? 'every tap denies one — they hold a play for every character standing'
        : `only the last ${denial.believedPlays.toFixed(1)} taps deny one — they hold fewer `
          + `plays than the ${denial.untapped} characters standing`,
    }),
    leaf('bundles considered', search.bundles.length, {
      tunable: 'hazardBeamWidth',
      note: search.truncated ? 'beam truncated — the space was not searched exhaustively' : 'exhaustive',
    }),
  ];
  return { company, roster, search, detail };
}

/**
 * The plan for a company, built once per position rather than per candidate.
 *
 * The beam search does not depend on which card the caller is asking about —
 * `bestBundleStartingWith` reads the answer out of it — so planning inside
 * every `evaluate` meant one beam search per candidate for an identical result.
 * Keyed on the view, so the next decision replans; see `core/memo`.
 */
const buildPlan = memoizeOnFirst(
  (_view: PlayerView, context: ModuleContext, company: OpponentCompanyView): Plan =>
    planFor(context, company),
);

/** Turn a scored bundle into an evaluation of the action that opens it. */
function evaluateBundle(
  action: GameAction,
  plan: Plan,
  bundle: Bundle,
  context: ModuleContext,
  discount: number,
  headline: string,
): Evaluation {
  const { standing } = context;
  const outcomes = discount === 1
    ? bundle.outcomes
    : bundle.outcomes.map(o => ({ ...o, dtsd: o.dtsd * discount }));
  const scored = standing.score(outcomes);
  const plannedWith = bundle.cards.slice(1);

  const detail: Rationale[] = [...plan.detail];
  detail.push(leaf('this card', bundle.cards[0].name, {
    note: `${bundle.cards[0].profile.strikes} strike(s) at prowess ${bundle.cards[0].profile.strikeProwess}`
      + `, ${bundle.cards[0].killMp} kill MP if beaten`,
  }));
  if (plannedWith.length > 0) {
    detail.push(leaf('planned to follow with', plannedWith.map(c => c.name).join(', '), {
      note: 'scored as one sequence against a company that degrades between attacks',
    }));
  } else {
    detail.push(leaf('planned to follow with', 'nothing', {
      note: 'this card alone is the best use of the remaining hazard limit',
    }));
  }
  if (discount !== 1) {
    detail.push(leaf('on-guard discount', discount, {
      tunable: 'onGuardDiscount',
      note: 'costs no hazard limit, but may never fire',
    }));
  }

  return {
    action,
    module: 'hazards',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(headline, scored.utility, [
      node('bundle', bundle.cards.map(c => c.name).join(' + '), detail),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: bundle.merged
      ? [...ASSUMPTIONS, 'the strike enumeration merged states to stay inside its cap, so the '
        + 'outcome list is a summary of the distribution rather than the whole of it']
      : ASSUMPTIONS,
  };
}

/**
 * The hazards module.
 *
 * It claims the play-hazards window and nothing else. Outside it, `pass` and
 * `play-hazard` mean different things and belong to other owners — which is
 * why the gate is on the phase step rather than on the action type.
 */
export const hazardsModule: H2Module = {
  name: 'hazards',
  ownedActionTypes: OWNED_ACTION_TYPES,

  claims(context: ModuleContext): boolean {
    if (!inHazardWindow(context.view)) return false;
    return activeCompany(context.view) !== null;
  },

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (!inHazardWindow(context.view)) return null;

    if (action.type === 'pass') {
      // The baseline every bundle is measured against: stop, keep the cards,
      // let the company arrive as it stands.
      return {
        action,
        module: 'hazards',
        outcomes: [{ p: 1, label: 'play nothing further into this company', dtsd: 0 }],
        expectedTsd: 0,
        sigmaTsd: 0,
        utility: 0,
        method: 'integrated',
        rationale: node('stop playing hazards', 0, [
          leaf('cards kept', context.view.self.hand.length, {
            note: 'the baseline — a hazard is only worth playing if it beats this',
          }),
        ], { unit: 'winprob' }),
        assumptions: ASSUMPTIONS,
      };
    }

    if (action.type === 'play-hazard') {
      const play = action as unknown as { cardInstanceId: string; targetCompanyId: string };
      const company = context.view.opponent.companies.find(c => (c.id as string) === play.targetCompanyId);
      if (!company) return null;
      const plan = buildPlan(context.view, context, company);
      const bundle = bestBundleStartingWith(plan.search, play.cardInstanceId);
      // Not a creature, or no slot left for it: this module has nothing to say,
      // and saying nothing is what leaves the decision honestly uncovered.
      if (!bundle) return null;
      return evaluateBundle(action, plan, bundle, context, 1, `play ${bundle.cards[0].name}`);
    }

    if (action.type === 'place-on-guard') {
      const place = action as unknown as { cardInstanceId: string };
      const company = activeCompany(context.view);
      if (!company) return null;
      const card = context.view.self.hand.find(c => (c.instanceId as string) === place.cardInstanceId);
      if (!card) return null;
      if (!creatureProfile(context.cardPool, card.definitionId as string)) return null;
      const plan = buildPlan(context.view, context, company);
      // On-guard placement is outside the hazard limit, so a card with no slot
      // left can still be placed — the single-card bundle is scored even when
      // `slots` is zero.
      const single = plan.search.bundles.find(
        b => b.cards.length === 1 && b.cards[0].instanceId === place.cardInstanceId,
      ) ?? placeOnly(context, plan, place.cardInstanceId);
      if (!single) return null;
      return evaluateBundle(
        action, plan, single, context, context.tunables.onGuardDiscount,
        `place ${single.cards[0].name} on guard`,
      );
    }

    return null;
  },
};

/** Score a lone card for on-guard when the hazard limit left no slot to plan it. */
function placeOnly(context: ModuleContext, plan: Plan, instanceId: string): Bundle | null {
  const { view, cardPool, standing, tunables } = context;
  const beliefs = computeBeliefs(view, cardPool);
  const denial = denialContext(view, plan.company, beliefs, standing, tunables);
  const price = denialPricer(cardPool, standing, tunables, denial);
  const killTsdOf = (killMp: number): number =>
    (killMp > 0 ? standing.tsdAfter({}, { kill: killMp }) - standing.tsd : 0);
  const card = view.self.hand.find(c => (c.instanceId as string) === instanceId);
  if (!card) return null;
  const creature = creatureProfile(cardPool, card.definitionId as string);
  if (!creature) return null;
  const candidate: Candidate = {
    instanceId,
    name: creature.name,
    killMp: creature.killMp,
    profile: {
      ...creature.profile,
      killTsd: killTsdOf(creature.killMp),
      killLabel: `${creature.name} beaten — ${creature.killMp} kill MP to the defender`,
    },
  };
  const search = planBundles([candidate], plan.roster, cardPool, price, standing, tunables, 1);
  return search.bundles[0] ?? null;
}

/** Untapped characters in a company, exported for the module's own tests. */
export function untappedCount(view: PlayerView, company: OpponentCompanyView): number {
  let count = 0;
  for (const id of company.characters) {
    if (view.opponent.characters[id]?.status === CardStatus.Untapped) count++;
  }
  return count;
}
