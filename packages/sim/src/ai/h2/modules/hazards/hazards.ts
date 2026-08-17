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
 * **It also owns one moment inside combat.** Excess strikes are assigned by the
 * *attacking* player (CoE 3.iv), so the hazard seat is asked which enemy
 * character eats the extra strike. `combat` cannot answer that — every price it
 * knows has the wrong sign, because harm to that company is the thing being
 * aimed for — and this module already has the model: it is a denial choice like
 * any other, and the answer is whoever it hurts them most to lose.
 *
 * **The board's own modifiers are part of every plan.** Minions Stir gives every
 * Orc attack +1 strike and +1 prowess, and the modifier is declared against the
 * same two numbers the strike enumeration runs on. A long event lasts the turn
 * and a permanent one the game, so once it is out those are simply the numbers —
 * `planFor` resolves every bundle with the modifiers the hazard events in play
 * declare. Reading them only at the moment such a card is *played* priced that
 * play correctly and then went on under-valuing every creature behind it.
 *
 * **So a support event is priced by one counterfactual: the board with it.** The
 * baseline is the plan as it stands; the other arm is the plan as it would be if
 * this card were in play, which picks up its own modifiers *and* every condition
 * on the board that names it. The event is worth the difference between the two
 * best bundles, and worth nothing when the hand holds no attack the modifier
 * would reach — the answer that keeps it out of an empty plan.
 *
 * That second half is the whole of Doors of Night. It does nothing to an attack
 * itself; what it does is satisfy `inPlay: "Doors of Night"` on the Minions Stir
 * already out, turning +1 of each into +2. Pricing it by its own declared
 * effects finds nothing and declines; pricing the board with and without it
 * finds the upgrade.
 *
 * **What it still does not do.** Hazard events outside the families above —
 * the company restrictions, the cancels, everything whose value is "the opponent
 * may not do X" — are declined, so a decision containing them is only partly
 * covered and the registry says so. A non-creature placed *on guard* is a
 * different case and is scored: placement is free, so zero is its floor rather
 * than a guess.
 */

import { CardStatus, Phase } from '@meccg/shared';
import type {
  CardDefinition, CombatState, CreatureKeyingMatch, GameAction, OpponentCompanyView, PlayerView,
} from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { memoizeOnFirst } from '../../core/memo.js';
import { computeBeliefs } from '../../services/beliefs.js';
import { computeExposure } from '../../services/exposure.js';
import { computeHazardPlan } from '../../services/hazard-plan.js';
import { attackIsDetainment } from '../../../detainment.js';
import { bodyOf, effectiveStrikeProwess, needAgainst, rosterOf } from '../../services/strike/prowess.js';
import { strikeOutcomes } from '../../services/strike/strike-model.js';
import type { StrikeTarget } from '../../services/strike/prowess.js';
import type { AttackProfile } from '../../services/strike/sequence.js';
import type { Bundle, BundleSearch, Candidate } from './bundle.js';
import { bestBundleStartingWith, planBundles } from './bundle.js';
import { denialContext, denialPricer } from '../../services/denial.js';
import {
  ALL_RACES, attackBoostOf, boostFor, boostInPlay, facedRacesFromHistory, mergeBoosts, nameOfDefinition,
  sameBoost, selfFacedRaceBoostOf,
} from '../../services/attack-modifiers.js';
import type { AttackBoost } from '../../services/attack-modifiers.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['play-hazard', 'place-on-guard', 'assign-strike', 'pass'] as const;

/** Assumptions every hazard evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'attacks are assumed free of card-specific combat effects: the creature\'s printed strikes, '
  + 'prowess and body are modelled, its text is not — except detainment (CoE §3.II), which is '
  + 'predicted with the engine\'s own rule and so taps rather than wounds and offers no kill MP',
  'two boards can turn a predicted detainment attack back into a normal one and are not visible '
  + 'from this seat — a defender converting detainment attacks (Alatar wh-1) and a company\'s '
  + 'keyed-attacks-normal constraint (as-110) — so such an attack is under-valued, never over-',
  'the defender is assumed to answer each strike with its best available parrier and to spend no '
  + 'cards from hand — every strike event, dodge or cancel they hold makes the bundle worth less '
  + 'than this says',
  'the defender is assumed to tap to fight every strike, which is the common choice but not the '
  + 'only one: a character who stays untapped at -3 prowess denies this bundle the tap it counts',
  'the bundle is priced against the company as it stands now; a hazard the opponent answers by '
  + 'cancelling the attack outright is not modelled',
  'on-guard placement is priced as the option it is — the card returns to hand unless revealed — '
  + 'discounted for the company never arriving, and not as a decision about the site it guards',
];

/**
 * The combat we are the *attacker* in, if this is one.
 *
 * Recognised by the company under attack not being ours: the defender's own
 * module gates on the opposite test, so the two windows cannot both be claimed.
 */
function attackingCombat(view: PlayerView): CombatState | null {
  const combat = view.combat;
  if (!combat) return null;
  if (view.self.companies.some(company => company.id === combat.companyId)) return null;
  return view.opponent.companies.some(company => company.id === combat.companyId) ? combat : null;
}

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

/**
 * Names of creature-sourced attacks already resolved this M/H sub-phase, the
 * same public history `deriveFacedRaces` (`reducer-utils.ts`) reads on the
 * engine side — public because both seats need to know which creatures key
 * off it (Wolf-riders td-86's `followsAttackRaces`).
 */
function hazardsEncounteredThisSubPhase(view: PlayerView): readonly string[] {
  return (view.phaseState as unknown as { hazardsEncountered?: readonly string[] }).hazardsEncountered ?? [];
}

/**
 * The creature card behind a `play-hazard`, or null when it is not a creature.
 *
 * `detainment` is not a field on the card — it falls out of the rule in §3.II
 * from the creature's keying, its race and who is defending, so it is predicted
 * per target company by `services/detainment` and passed in. It changes two
 * things here: the attack taps instead of wounding (the sequence enumeration's
 * business), and the kill marshalling points it puts on offer are zero (§3.II.3)
 * — a detainment creature is the one attack that cannot pay the defender for
 * beating it.
 */
function creatureProfile(
  cardPool: Readonly<Record<string, CardDefinition>>,
  definitionId: string,
  detainment: boolean,
): {
    profile: Omit<AttackProfile, 'killTsd' | 'killLabel'>;
    killMp: number;
    detainment: boolean;
    name: string;
    race?: string;
    selfFacedRaceBoost: ReturnType<typeof selfFacedRaceBoostOf>;
  } | null {
  const def = cardPool[definitionId] as unknown as {
    cardType?: string;
    name?: string;
    strikes?: number;
    prowess?: number;
    body?: number | null;
    killMarshallingPoints?: number;
    race?: string;
  } | undefined;
  if (!def || def.cardType !== 'hazard-creature') return null;
  return {
    name: def.name ?? definitionId,
    killMp: detainment ? 0 : def.killMarshallingPoints ?? 0,
    detainment,
    race: def.race,
    selfFacedRaceBoost: selfFacedRaceBoostOf(cardPool[definitionId]),
    profile: {
      strikeProwess: def.prowess ?? 0,
      strikes: def.strikes ?? 1,
      creatureBody: def.body ?? null,
      detainment,
      bodyCheckModifier: 0,
      name: def.name ?? definitionId,
    },
  };
}

/** How a defeated attack is described, which detainment changes (§3.II.3). */
function killLabelFor(name: string, killMp: number, detainment: boolean): string {
  return detainment
    ? `${name} beaten — a detainment attack, so no kill MP to the defender`
    : `${name} beaten — ${killMp} kill MP to the defender`;
}

/** Every creature in hand the engine is currently offering against a company. */

function candidatesFor(
  context: ModuleContext,
  company: OpponentCompanyView,
  killTsdOf: (killMp: number) => number,
  boost?: AttackBoost,
): Candidate[] {
  const { view, cardPool } = context;
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const action of context.legalActions) {
    if (action.type !== 'play-hazard') continue;
    const play = action as unknown as {
      cardInstanceId: string; targetCompanyId: string; keyedBy?: CreatureKeyingMatch;
    };
    if (play.targetCompanyId !== (company.id as string)) continue;
    if (seen.has(play.cardInstanceId)) continue;
    const card = view.self.hand.find(c => (c.instanceId as string) === play.cardInstanceId);
    if (!card) continue;
    // The keying the engine offered this play under decides the §3.II.2 branch,
    // so it is read off the action rather than off the card: a creature keyed to
    // a Ruins & Lairs *and* to a Dark-hold is only detainment when the play used
    // the Dark-hold. One candidate is built per card, so a card offered under
    // several keyings is predicted from the first the engine listed — the
    // variants score alike either way, and which one is played is settled by the
    // tie-break rather than here.
    const detainment = attackIsDetainment(
      view, cardPool, company, card.definitionId as string, play.keyedBy,
    );
    const creature = creatureProfile(cardPool, card.definitionId as string, detainment);
    if (!creature) continue;
    seen.add(play.cardInstanceId);
    const added = boostFor(boost, cardPool, card.definitionId as string);
    candidates.push({
      instanceId: play.cardInstanceId,
      name: creature.name,
      killMp: creature.killMp,
      race: creature.race,
      selfFacedRaceBoost: creature.selfFacedRaceBoost,
      profile: {
        ...creature.profile,
        strikeProwess: creature.profile.strikeProwess + added.prowess,
        strikes: creature.profile.strikes + added.strikes,
        killTsd: killTsdOf(creature.killMp),
        killLabel: killLabelFor(creature.name, creature.killMp, creature.detainment),
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

/**
 * Build the plan: roster, denial context, ranked bundles.
 *
 * Every attack is resolved with the modifiers the hazard events **already in
 * play** declare, because those are the numbers the engine will use. `boost`
 * replaces that with the counterfactual arm — the board as it would be if one
 * more card were played — so an event that makes the other hazards better is
 * priced by the difference between the two.
 */
function planFor(
  context: ModuleContext,
  company: OpponentCompanyView,
  boost?: AttackBoost | null,
  /**
   * Slots already spoken for beyond what the phase state records — one, when the
   * caller is pricing the *play* of a support event, because playing it spends a
   * slot of the same hazard limit the attacks behind it need (the engine counts
   * every hazard played against a company, events included).
   */
  reserved = 0,
): Plan {
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

  const candidates = candidatesFor(
    context, company, killTsdOf, boost ?? boostInPlay(context.view, context.cardPool) ?? undefined,
  );
  const limit = exposure.hazardLimit(company.id);
  const played = (view.phaseState as unknown as { hazardsPlayedThisCompany?: number })
    .hazardsPlayedThisCompany ?? 0;
  const slots = Math.max(0, (limit ?? 0) - played - reserved);
  const initialFacedRaces = facedRacesFromHistory(hazardsEncounteredThisSubPhase(view), cardPool);
  const search = planBundles(candidates, roster, cardPool, price, standing, tunables, slots, initialFacedRaces);

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
  forgoneTsd = 0,
): Evaluation {
  const { standing } = context;
  const scaled = discount === 1
    ? bundle.outcomes
    : bundle.outcomes.map(o => ({ ...o, dtsd: o.dtsd * discount }));
  // A deterministic cost shifts every outcome equally, which is what keeps σ
  // — and so the risk posture's grip on the action — intact.
  const outcomes = forgoneTsd === 0
    ? scaled
    : scaled.map(o => ({ ...o, dtsd: o.dtsd - forgoneTsd }));
  const scored = standing.score(outcomes);
  const plannedWith = bundle.cards.slice(1);

  const detail: Rationale[] = [...plan.detail];
  detail.push(leaf('this card', bundle.cards[0].name, {
    note: `${bundle.cards[0].profile.strikes} strike(s) at prowess ${bundle.cards[0].profile.strikeProwess}`
      + (bundle.cards[0].profile.detainment
        ? ', a detainment attack — it taps rather than wounds, and no kill MP if beaten'
        : `, ${bundle.cards[0].killMp} kill MP if beaten`),
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
  if (forgoneTsd !== 0) {
    detail.push(leaf('the hazard it is not', forgoneTsd, {
      unit: 'tsd',
      note: 'what this card would have denied played against a company still to move',
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
    if (attackingCombat(context.view) !== null) return true;
    if (!inHazardWindow(context.view)) return false;
    return activeCompany(context.view) !== null;
  },

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    const attacking = attackingCombat(context.view);
    if (attacking !== null) {
      return action.type === 'assign-strike'
        ? evaluateAssignStrike(action, context, attacking)
        : action.type === 'pass'
          ? passEvaluation(action, context)
          : null;
    }
    if (!inHazardWindow(context.view)) return null;

    if (action.type === 'pass') return passEvaluation(action, context);

    if (action.type === 'play-hazard') {
      const play = action as unknown as { cardInstanceId: string; targetCompanyId: string };
      const company = context.view.opponent.companies.find(c => (c.id as string) === play.targetCompanyId);
      if (!company) return null;
      const plan = buildPlan(context.view, context, company);
      const bundle = bestBundleStartingWith(plan.search, play.cardInstanceId);
      // Not a creature: it may still be an event this module can price, and if
      // it is not, saying nothing is what leaves the decision honestly
      // uncovered.
      if (!bundle) return evaluateHazardEvent(action, context, company);
      return evaluateBundle(action, plan, bundle, context, 1, `play ${bundle.cards[0].name}`);
    }

    if (action.type === 'place-on-guard') return evaluateOnGuard(action, context);

    return null;
  },
};

/** The do-nothing baseline, shared by both windows this module claims. */
function passEvaluation(action: GameAction, context: ModuleContext): Evaluation {
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

/**
 * Score giving one strike to one of *their* characters.
 *
 * The attacking player assigns excess strikes, so this is the hazard seat
 * choosing where the extra damage lands. It is the same denial question the
 * bundle planner answers, one strike at a time: the strike is going to happen,
 * and all that is being chosen is who faces it, so the whole evaluation is what
 * harming that particular character denies them.
 */
function evaluateAssignStrike(
  action: GameAction,
  context: ModuleContext,
  combat: CombatState,
): Evaluation | null {
  const { view, cardPool, standing, tunables } = context;
  const characterId = (action as unknown as { characterId?: string }).characterId;
  const company = view.opponent.companies.find(c => c.id === combat.companyId);
  if (!characterId || !company) return null;

  const roster = rosterOf(company, view.opponent.characters, cardPool);
  const target = roster.find(t => (t.instanceId as string) === characterId);
  if (!target) return null;

  const beliefs = computeBeliefs(view, cardPool);
  const denial = denialContext(view, company, beliefs, standing, tunables);
  const price = denialPricer(cardPool, standing, tunables, denial);
  const untappedBefore = roster.filter(
    t => !t.isAlly && t.status === CardStatus.Untapped,
  ).length;

  const excess = (action as unknown as { excess?: boolean }).excess === true;
  const need = needAgainst(target, cardPool, effectiveStrikeProwess(combat), {
    excessStrikes: excess ? 1 : 0,
  });
  const outcomes: Outcome[] = strikeOutcomes(
    { need, tapMode: 'always', bestOfTwo: false, bodyPenalty: 0 },
    {
      creatureBody: combat.creatureBody,
      detainment: combat.detainment,
      characterBody: bodyOf(target, cardPool),
      alreadyWounded: target.status === CardStatus.Inverted,
      bodyCheckModifier: combat.bodyCheckModifier ?? 0,
    },
  ).map(outcome => ({
    p: outcome.p,
    label: `${target.name}: ${outcome.strike} / ${outcome.character}`,
    dtsd: price(outcome, target, { untappedBefore }),
  }));
  const scored = standing.score(outcomes);

  return {
    action,
    module: 'hazards',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(`strike ${target.name}`, scored.utility, [
      node('what harming him denies', scored.expectedTsd, [
        leaf('facing', target.name, { note: excess ? 'an excess strike, at -1 prowess' : 'an assigned strike' }),
        leaf('their roll needs', need, { unit: 'p', note: 'predicted, not published — the strike is not reached yet' }),
        leaf('characters still standing', untappedBefore, {
          note: `they hold about ${denial.believedPlays.toFixed(1)} resource play(s)`,
        }),
      ], { unit: 'tsd' }),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: [
      'the strike is going to happen; only who faces it is being chosen, so nothing here prices '
      + 'the attack as a whole',
      'the defender is assumed to tap to fight and to spend no cards answering it',
      ...ASSUMPTIONS,
    ],
  };
}


/**
 * What an event is worth for the numbers it changes, or null when it changes none.
 *
 * One counterfactual answers both halves of this. The baseline is the plan as
 * the board stands, with the modifiers the hazard events already in play
 * declare; the other arm is the plan as it would be **if this card were in
 * play** — which picks up its own modifiers *and* every condition on the board
 * that names it.
 *
 * That second half is the whole of Doors of Night. It does nothing to an attack
 * itself; what it does is satisfy `inPlay: "Doors of Night"` on the Minions Stir
 * already out, turning +1 prowess and +1 strike into +2 of each. Pricing it by
 * its own declared effects finds nothing and declines; pricing the board with
 * and without it finds the upgrade.
 *
 * The counterfactual arm is not memoised: it is one extra beam search, run for
 * the one candidate that asks, where the baseline is shared by every candidate
 * on the decision.
 */
function boostGain(
  def: CardDefinition | undefined,
  definitionId: string,
  context: ModuleContext,
  company: OpponentCompanyView,
): { tsd: number; reason: string } | null {
  const name = nameOfDefinition(def, definitionId);
  const current = boostInPlay(context.view, context.cardPool);
  const hypothetical = mergeBoosts(
    boostInPlay(context.view, context.cardPool, { hypothetical: name }),
    attackBoostOf(def, context.view, context.cardPool, name),
  );
  // Nothing about the attacks changes, so this is not the family. Saying so
  // lets the removal and recovery families have their turn.
  if (sameBoost(current, hypothetical)) return null;

  const before = buildPlan(context.view, context, company).search.bundles[0]?.expectedTsd ?? 0;
  // The counterfactual arm reserves the slot this card would spend. Without
  // that it priced the boosted bundle as if the event were free, which is worst
  // exactly where it matters most: with one slot left, "play the boost" was
  // credited with the attack the boost would have had no room for.
  const after = planFor(context, company, hypothetical, 1).search.bundles[0]?.expectedTsd ?? 0;
  const describe = (boost: AttackBoost | null): string => [...(boost?.entries() ?? [])]
    .map(([race, added]) => `${race === ALL_RACES ? 'every' : race} attack `
      + `${added.prowess >= 0 ? '+' : ''}${added.prowess} prowess, `
      + `${added.strikes >= 0 ? '+' : ''}${added.strikes} strike(s)`)
    .join('; ') || 'no modifier at all';
  const shift = current === null
    ? describe(hypothetical)
    : `${describe(current)} becomes ${describe(hypothetical)}`;
  return {
    // The value of playing this now is the *whole* boosted plan it unlocks —
    // the same total a bundle starting with the creature it boosts would
    // report, not the marginal sliver left after subtracting that plan's
    // unboosted value. Comparing the sliver against a creature's full bundle
    // total is why the event always lost that comparison and got played
    // second, after the attack it was supposed to improve had already
    // resolved. `Math.max(before, ...)` is the same beam-noise guard as
    // before: a boost never makes the plan worse, so `after` dipping under
    // `before` is search noise, not a real loss.
    tsd: Math.max(before, after),
    reason: after - before > 0
      ? `${shift} — the best bundle against this company goes from ${before.toFixed(1)} to `
        + `${after.toFixed(1)}`
      : `${shift} — but the plan has no attack left it would improve`,
  };
}

/**
 * Score a hazard *event* — the half of hazard play that is not an attack.
 *
 * Two families can be priced, and they come from different places.
 *
 * **What the action targets.** Muster Disperses declares nothing but
 * `play-target: faction`; the dispersal is the card's own semantics, so there
 * is no effect to read. But the *action* names the faction, and a faction in
 * play has printed marshalling points — so what the play is worth is exactly
 * what those points are worth to the opponent, through `standing`, which
 * correctly says zero when their faction source is already capped.
 *
 * **What the effects declare.** An Unexpected Outpost moves cards from the
 * sideboard or discard back into the deck, which is the recovery family
 * `events` and `grants` both price, discounted again because a card put back in
 * the deck is further away than one put in hand.
 *
 * **What the effects do to the other hazards.** Minions Stir gives every Orc
 * attack +1 strike and +1 prowess, +2 of each while Doors of Night is in play.
 * Its whole value is "it makes my other hazards better", and that is not a
 * guess: the modifier is declared against the same two numbers the strike
 * enumeration runs on, so the plan is re-run with it applied and the difference
 * taken. It was the most-declined hazard event in the game — 59 candidates in
 * three self-play games, against Doors of Night's 46 — and a hazard side that
 * cannot value its own support events cannot build the Orc engine the deck is
 * for.
 *
 * Everything else is declined.
 */
function evaluateHazardEvent(
  action: GameAction,
  context: ModuleContext,
  company: OpponentCompanyView,
): Evaluation | null {
  const record = action as unknown as {
    cardInstanceId: string;
    targetFactionInstanceId?: string;
    targetStoredItemInstanceId?: string;
  };
  const { view, cardPool, standing, tunables } = context;
  const card = view.self.hand.find(c => (c.instanceId as string) === record.cardInstanceId);
  if (!card) return null;
  const def = cardPool[card.definitionId] as unknown as {
    name?: string; effects?: readonly { type?: string; to?: string; count?: number }[];
  } | undefined;
  const name = def?.name ?? (card.definitionId as string);

  const gain = boostGain(cardPool[card.definitionId], card.definitionId as string, context, company)
    ?? removalGain(record, context)
    ?? recoveryGain(def?.effects ?? [], tunables);
  if (!gain) return null;

  const dtsd = netTsdDelta({ realized: gain.tsd, tempo: tunables.provisionalCardPrice }, tunables);
  const outcomes: Outcome[] = [{ p: 1, label: `play ${name} — ${gain.reason}`, dtsd }];
  const scored = standing.score(outcomes);

  return {
    action,
    module: 'hazards',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(`play ${name}`, scored.utility, [
      node('the event', gain.tsd, [
        leaf('event', name),
        leaf('what it achieves', gain.tsd, { unit: 'tsd', note: gain.reason }),
        leaf('the card it spends', tunables.provisionalCardPrice, {
          unit: 'tsd',
          tunable: 'provisionalCardPrice',
        }),
      ], { unit: 'tsd' }),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: [
      'a hazard event is priced by what the action targets or by the family its effects declare, '
      + 'never by its text: an event that also restricts or enables something is under-valued',
      'the hazard-limit slot it consumes is not charged — what else could have gone in that slot '
      + 'is the bundle planner\'s question, and it does not plan events',
      'an attack boost is priced against the hazards *in hand now*, and against this company only: '
      + 'a long event lasts the turn, so what it will be worth to cards not yet drawn and to '
      + 'companies not yet resolved is not counted',
      'a modifier whose condition this cannot read is dropped rather than assumed to hold, so an '
      + 'event gated on something unmodelled is under-valued rather than over-valued',
      ...ASSUMPTIONS,
    ],
  };
}

/** What taking a named card out of the opponent's play is worth. */
function removalGain(
  record: { targetFactionInstanceId?: string; targetStoredItemInstanceId?: string },
  context: ModuleContext,
): { tsd: number; reason: string } | null {
  const targetId = record.targetFactionInstanceId ?? record.targetStoredItemInstanceId;
  if (!targetId) return null;
  const { view, cardPool, standing } = context;
  const target = view.opponent.cardsInPlay.find(c => (c.instanceId as string) === targetId);
  if (!target) return null;
  const printed = cardPool[target.definitionId] as unknown as {
    name?: string; marshallingPoints?: number; marshallingCategory?: string;
  } | undefined;
  const points = printed?.marshallingPoints ?? 0;
  if (points <= 0) return null;
  const source = printed?.marshallingCategory ?? 'misc';
  const tsd = standing.tsd - standing.tsdAfter({}, { [source]: -points });
  return {
    tsd,
    reason: tsd > 0
      ? `takes ${printed?.name ?? 'a card'} out of play — ${points} ${source} MP they lose`
      : `takes ${printed?.name ?? 'a card'} out of play, but that source is already capped for them`,
  };
}

/** What an event that recycles cards into our own deck or hand is worth. */
function recoveryGain(
  effects: readonly { type?: string; to?: string; count?: number }[],
  tunables: ModuleContext['tunables'],
): { tsd: number; reason: string } | null {
  const moves = effects.filter(e => e.type === 'move' && (e.to === 'deck' || e.to === 'hand'));
  if (moves.length === 0) return null;
  const cards = moves.reduce((sum, move) => sum + (move.count ?? 1), 0);
  const toHand = moves.every(move => move.to === 'hand');
  // A card put back in the deck is further away than one put in hand, so it is
  // discounted again by the same factor every "might never happen" is.
  const each = toHand ? tunables.resourceDrawValue : tunables.resourceDrawValue * tunables.potentialDiscount;
  return {
    tsd: cards * each,
    reason: `${cards} card(s) back into the ${toHand ? 'hand' : 'deck'}, at `
      + `${each.toFixed(2)} each${toHand ? '' : ' — discounted for being a draw away'}`,
  };
}

/**
 * Score placing a card face down on the company's site.
 *
 * The rule that decides this one is in `reducer-site.ts`: an on-guard card that
 * is never revealed **goes back to the hazard player's hand** at cleanup. So
 * placement does not spend the card. It buys an option — the right to reveal it
 * during the site phase, when hazards otherwise cannot be played — and an option
 * that costs nothing is worth nothing or better.
 *
 * That is a correction rather than a refinement. This module used to charge half
 * a card for a placement (the bundle's card price times `onGuardDiscount`), a
 * cost the rules do not impose, which made placing look worse than passing.
 *
 * Two consequences:
 *
 * - **A creature** is worth what its attack would do if revealed, discounted by
 *   `onGuardDiscount` for the company never arriving or the reveal conditions
 *   never being met — and with no card price, because the card comes back.
 * - **Anything else** — and the rules allow any card, "even a character or
 *   resource" — is worth *at least* nothing, and this module cannot say more.
 *   What it does on reveal is its text, which is the DSL's to price. Scored at
 *   zero rather than declined, because zero is the honest floor for a free
 *   option and declining left 920 candidates unscored in three self-play games.
 */
function evaluateOnGuard(action: GameAction, context: ModuleContext): Evaluation | null {
  const place = action as unknown as { cardInstanceId: string };
  const company = activeCompany(context.view);
  if (!company) return null;
  const card = context.view.self.hand.find(c => (c.instanceId as string) === place.cardInstanceId);
  if (!card) return null;

  const { tunables } = context;
  // Only asked whether the card is a creature at all; the placement's own
  // profile — detainment included — is built by `placeOnly` below.
  const creature = creatureProfile(context.cardPool, card.definitionId as string, false);

  if (creature) {
    // Worth the attack it would make, with no card price: the card is only
    // spent if it is revealed and used.
    const plan = buildPlan(context.view, context, company);
    const free = { ...tunables, provisionalCardPrice: 0 };
    const single = placeOnly({ ...context, tunables: free }, plan, place.cardInstanceId);
    if (!single) return null;
    // An option is never exercised at a loss. A creature whose reveal would
    // hand over more kill MP than it denies simply is not revealed, and the
    // card comes back — so its placement is worth the floor, not the negative.
    if (single.expectedTsd > 0) {
      // Placement does not spend the card — the rules return it at cleanup —
      // but it does **commit** it for the turn: a card sitting on a site is not
      // available to be played against a company that has yet to move. That
      // opportunity cost was missing, and it is the whole of the difference
      // between "an option that costs nothing" and one that costs the best
      // alternative use.
      //
      // It is the largest single disagreement with recorded human play:
      // `place-on-guard` is what the agent does instead of passing 154 times
      // in 8 games, all of it in the movement/hazard phase, against a `pass`
      // agreement of 15.9% there. An action modelled as free is one a
      // zero-baseline policy takes whenever it has any upside at all.
      //
      // `hazard-plan` already knows the number: the marginal this card
      // contributes to the turn's assignment if it is played rather than
      // placed. The two uses are mutually exclusive, so it is a cost and not a
      // double count.
      const forgone = Math.max(0, computeHazardPlan(
        context.view, context.cardPool, context.standing, tunables,
      ).worth(card.instanceId)?.marginal ?? 0);
      return evaluateBundle(
        action, plan, single, context, tunables.onGuardDiscount,
        `place ${single.cards[0].name} on guard`, forgone,
      );
    }
    return freeOption(
      action, context, single.cards[0].name,
      `revealing it would cost ${(-single.expectedTsd).toFixed(1)} more than it denies, so it `
      + 'would not be revealed — the option is simply never exercised',
    );
  }

  const name = (context.cardPool[card.definitionId] as unknown as { name?: string } | undefined)?.name
    ?? (card.definitionId as string);
  return freeOption(
    action, context, name,
    'not a creature: what it would do on reveal is the card\'s text, which this module does not '
    + 'price. Zero is the floor for a free option, not an estimate',
  );
}

/** A placement worth exactly its floor: it costs nothing and may pay nothing. */
function freeOption(
  action: GameAction,
  context: ModuleContext,
  name: string,
  why: string,
): Evaluation {
  const outcomes: Outcome[] = [{
    p: 1,
    label: `place ${name} face down — it returns to hand unless it is revealed`,
    dtsd: 0,
  }];
  const scored = context.standing.score(outcomes);
  return {
    action,
    module: 'hazards',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(`place ${name} on guard`, scored.utility, [
      node('a free option', 0, [
        leaf('card', name),
        leaf('cost of placing it', 0, {
          unit: 'tsd',
          note: 'an unrevealed on-guard card returns to hand at cleanup — the card is not spent',
        }),
        leaf('worth of revealing it', 0, { unit: 'tsd', note: why }),
      ], { unit: 'tsd' }),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: [
      'a placement is priced as costing nothing, because an unrevealed on-guard card returns to '
      + 'hand; what placing it gives away by being there at all is not modelled',
      'an option is assumed never to be exercised at a loss, so a placement is never worth less '
      + 'than nothing — which is why the floor is zero rather than the reveal\'s value',
      ...ASSUMPTIONS,
    ],
  };
}

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
  // No keying is declared by a placement — what the card would be revealed under
  // is not decided yet — so the detainment prediction falls back to the union of
  // the creature's keying, which is the engine's own fallback for a reveal.
  const detainment = attackIsDetainment(view, cardPool, plan.company, card.definitionId as string);
  const creature = creatureProfile(cardPool, card.definitionId as string, detainment);
  if (!creature) return null;
  const candidate: Candidate = {
    instanceId,
    name: creature.name,
    killMp: creature.killMp,
    race: creature.race,
    selfFacedRaceBoost: creature.selfFacedRaceBoost,
    profile: {
      ...creature.profile,
      killTsd: killTsdOf(creature.killMp),
      killLabel: killLabelFor(creature.name, creature.killMp, creature.detainment),
    },
  };
  const initialFacedRaces = facedRacesFromHistory(hazardsEncounteredThisSubPhase(view), cardPool);
  const search = planBundles([candidate], plan.roster, cardPool, price, standing, tunables, 1, initialFacedRaces);
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
