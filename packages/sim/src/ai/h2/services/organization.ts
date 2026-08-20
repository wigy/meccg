/**
 * @module ai/h2/services/organization
 *
 * One potential `Φ` over the whole **arrangement** — the partition of
 * characters into companies plus the follower assignment — per
 * `specs/2026-08-20-h2-organization-phase.md`.
 *
 * The `characters` module prices every shape action as a difference of one
 * scored number per arrangement:
 *
 * ```text
 * Φ(arrangement) = − Σ_c expectedHarm(roster_c, |roster_c|)   (existing)
 *                + OpportunityValue(arrangement)              (new)
 * u(arrangement) = E[ W(tsd + X(arrangement), turn) ] − W(tsd, turn)
 * ```
 *
 * where `X(arrangement)` is the arrangement's outcome distribution: a
 * deterministic `−Σ harm` shift folded with one Bernoulli per assigned goal.
 * Because every arrangement maps to exactly one number `u`, the ranking over
 * shape actions is a potential *at the utility level*: any accepted change
 * strictly increases `u`, arrangements are finite, so no cycle is possible —
 * at any risk posture. The obvious alternative — scoring the *delta*
 * distribution through `standing.score` — provably cycles under a convex
 * (trailing) posture: a split has `E[Δ] ≈ 0` and `σ > 0`, so Jensen prices
 * the split *and* the merge back positive, a strict cycle created by the
 * risk machinery itself.
 *
 * Two conditions make `u` single-valued, both pinned by test: `valueOf` is
 * canonical — a function of the arrangement as a *set*, no dependence on
 * construction order or on which action asked — and both sides of every
 * comparison read the same position-fixed inputs (same typical attack, same
 * goal list, same commitment, same hand), guaranteed by `memoizeOnFirst`
 * producing one `Organization` per position.
 *
 * The goals are real, playable cards only — committed plans first, then
 * unserved hand opportunities from `services/opportunities` — and the
 * matching is injective over distinct cards. A spun-off company with no
 * distinct playable card behind it therefore adds exactly zero opportunity
 * while still moving the harm term: the "resources to play for all" gate
 * falls out as arithmetic, with no counting rule to tune.
 */

import { CardStatus, GENERAL_INFLUENCE, isCharacterCard } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, PlayerView } from '@meccg/shared';
import { memoizeOnFirst } from '../core/memo.js';
import type { Outcome, Rationale, Standing } from '../core/types.js';
import type { Commitment } from '../core/plan.js';
import type { Tunables } from '../core/tunables.js';
import type { MpSource } from '../core/tsd.js';
import { pAtLeast } from '../core/dice.js';
import { leaf, node } from '../core/rationale.js';
import { automaticAttacksOf, computeDefence } from './defence.js';
import { computeReach } from './reach.js';
import { enumerateGoalCandidates, routeProbabilityFor } from './opportunities.js';
import { rosterOf } from './strike/prowess.js';

/**
 * Target assumed for a faction whose definition does not print one — the same
 * stand-in for missing card data `factions` uses, not a tunable.
 */
const DEFAULT_INFLUENCE_TARGET = 8;

/** One MP-bearing thing the arrangement could be serving. */
export interface OrganizationGoal {
  /** Stable identity: the plan's own ID, or `opportunity/<card>@<site>`. */
  readonly id: string;
  /** Human-readable, e.g. `"play Hauberk at Isengard"`. */
  readonly label: string;
  /** The card whose play is the goal. */
  readonly cardInstanceId?: CardInstanceId;
  /** Where it has to happen. */
  readonly siteDefinitionId?: string;
  /**
   * Marginal TSD through `standing`. For a committed goal this is the plan's
   * own payoff, already net of site harm at commit time and frozen for the
   * turn. For an opportunity it is **gross**: the site's toll depends on who
   * walks in, so it is netted inside the matching against the serving
   * company's roster — shape-dependence belongs to the arrangement, never to
   * the goal list, or the potential stops being one.
   */
  readonly payoffTsd: number;
  /** Whether the portfolio is committed to it. */
  readonly committed: boolean;
  /** Whether collecting it needs an influence check. */
  readonly faction: boolean;
  /** Printed influence target, when the goal is a faction. */
  readonly influenceTarget?: number;
  /** `payoffTsd`, discounted unless committed — the matching's currency. */
  readonly discountedPayoffTsd: number;
}

/** One company of a candidate arrangement. */
export interface ArrangedCompany {
  /** Who stands in it. Order is irrelevant; `valueOf` canonicalises. */
  readonly characterIds: readonly CardInstanceId[];
  /** Where it stands, as a site definition ID. */
  readonly currentSiteDefinitionId?: string;
  /** Where its committed movement is already taking it. */
  readonly destinationSiteDefinitionId?: string;
}

/**
 * A whole-board candidate: the partition into companies, plus any follower
 * reassignments relative to the view.
 */
export interface Arrangement {
  readonly companies: readonly ArrangedCompany[];
  /**
   * Follower-assignment overrides, character → `'general'` or the holder's
   * instance ID. Characters not named keep the controller the view records.
   * `valueOf` reads the *effective* mapping, so two spellings of the same
   * assignment are the same arrangement.
   */
  readonly controllers?: Readonly<Record<string, string>>;
}

/** One goal the matching gave to one company. */
export interface GoalAssignment {
  readonly goal: OrganizationGoal;
  /** Index into the canonical company order of the arrangement. */
  readonly companyIndex: number;
  /** Short description of the serving company, for the rationale. */
  readonly companyLabel: string;
  /** P(the goal pays): reach × the influence check where one is needed. */
  readonly p: number;
  /**
   * What paying off is worth: the payoff net of the serving company's toll at
   * the site (committed goals were netted at commit time), discounted unless
   * committed. The Bernoulli's success value.
   */
  readonly valueTsd: number;
  /** `p × valueTsd` — the weight the matching maximised. */
  readonly weightTsd: number;
}

/** Everything `valueOf` computes about one arrangement. */
export interface ArrangementValue {
  /** `Σ expectedHarm(roster, |roster|)`, as a positive quantity. */
  readonly harmTsd: number;
  /** The matching's total weight plus the general-influence headroom. */
  readonly opportunityTsd: number;
  /** The general-influence headroom term alone. */
  readonly headroomTsd: number;
  /** `E[X] = −harm + opportunity`. */
  readonly expectedTsd: number;
  /** The outcome distribution `X`: a shift folded with one Bernoulli per goal. */
  readonly outcomes: readonly Outcome[];
  /** Which goal each company serves, at what probability. */
  readonly assignments: readonly GoalAssignment[];
  /** `E[W(tsd + X, turn)] − W(tsd, turn)` — the scored number per arrangement. */
  readonly u: number;
  /** The derivation, naming which goal each company serves and why. */
  readonly rationale: Rationale;
}

/** The organization potential of one position. */
export interface Organization {
  /** The goal list, most valuable first, truncated to `organizationGoalCap`. */
  readonly goals: readonly OrganizationGoal[];
  /** True when the cap dropped real goals — reported in the rationale. */
  readonly capBound: boolean;
  /** Score one whole-board arrangement. A function of the arrangement as a set. */
  valueOf(arrangement: Arrangement): ArrangementValue;
  /** The arrangement the view is actually in. */
  current(): Arrangement;
}

/** A character's printed name, for labels. */
function nameOf(
  cardPool: Readonly<Record<string, CardDefinition>>,
  view: PlayerView,
  instanceId: string,
): string {
  const definitionId = view.self.characters[instanceId as CardInstanceId]?.definitionId;
  const name = definitionId
    ? (cardPool[definitionId] as unknown as { name?: string } | undefined)?.name
    : undefined;
  return name ?? instanceId;
}

/** Mind cost of a character in play; avatars print none and cost nothing. */
function mindOf(
  cardPool: Readonly<Record<string, CardDefinition>>,
  view: PlayerView,
  instanceId: string,
): number {
  const definitionId = view.self.characters[instanceId as CardInstanceId]?.definitionId;
  const def = definitionId ? cardPool[definitionId] : undefined;
  if (!def || !isCharacterCard(def)) return 0;
  return def.mind ?? 0;
}

/** The goal list of a position: committed plans first, then hand opportunities. */
function goalList(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  standing: Standing,
  tunables: Tunables,
  commitment: Commitment | undefined,
): { goals: OrganizationGoal[]; capBound: boolean } {
  const goals: OrganizationGoal[] = [];
  const committedCards = new Set<string>();

  for (const plan of commitment?.plans ?? []) {
    if (plan.goal.mp <= 0) continue;
    if (plan.goal.cardInstanceId !== undefined) {
      committedCards.add(plan.goal.cardInstanceId as string);
    }
    const inHand = view.self.hand.find(c => c.instanceId === plan.goal.cardInstanceId);
    const def = inHand ? cardPool[inHand.definitionId] : undefined;
    const influenceTarget = (def as unknown as { influenceTarget?: number } | undefined)?.influenceTarget;
    goals.push({
      id: plan.id,
      label: plan.goal.label,
      cardInstanceId: plan.goal.cardInstanceId,
      siteDefinitionId: plan.goal.siteDefinitionId,
      // Already marginal and net of site harm — the proposer computed it.
      payoffTsd: plan.payoffTsd,
      committed: true,
      faction: plan.goal.source === 'faction',
      influenceTarget,
      discountedPayoffTsd: plan.payoffTsd,
    });
  }

  // Unserved hand opportunities, deduplicated by card — a committed card is
  // not also an opportunity, and a card playable at several sites is one goal
  // at its best site. "Best" must not read the company partition (the goal
  // list has to survive an undo unchanged), so the site is chosen by the
  // pool-only proxy for its toll: fewest automatic attacks, then fewest
  // printed strikes, then site ID.
  const bestByCard = new Map<string, ReturnType<typeof enumerateGoalCandidates>[number]>();
  for (const candidate of enumerateGoalCandidates(view, cardPool, standing)) {
    if (committedCards.has(candidate.cardInstanceId as string)) continue;
    const held = bestByCard.get(candidate.cardInstanceId as string);
    const better = !held
      || candidate.automaticAttackCount < held.automaticAttackCount
      || (candidate.automaticAttackCount === held.automaticAttackCount
        && (candidate.automaticAttackStrikes < held.automaticAttackStrikes
          || (candidate.automaticAttackStrikes === held.automaticAttackStrikes
            && candidate.siteDefinitionId < held.siteDefinitionId)));
    if (better) bestByCard.set(candidate.cardInstanceId as string, candidate);
  }
  for (const candidate of bestByCard.values()) {
    goals.push({
      id: `opportunity/${candidate.cardInstanceId as string}@${candidate.siteDefinitionId}`,
      label: `play ${candidate.cardName} at ${candidate.siteName}`,
      cardInstanceId: candidate.cardInstanceId,
      siteDefinitionId: candidate.siteDefinitionId,
      payoffTsd: candidate.grossPayoffTsd,
      committed: false,
      faction: candidate.source === 'faction',
      influenceTarget: candidate.influenceTarget,
      // Unbanked and uncommitted, in exactly the §2.3 sense.
      discountedPayoffTsd: candidate.grossPayoffTsd * tunables.potentialDiscount,
    });
  }

  // Deterministic order: by discounted payoff, ties by goal id — and the
  // performance cap, reported when it binds.
  goals.sort((a, b) => b.discountedPayoffTsd - a.discountedPayoffTsd
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const capBound = goals.length > tunables.organizationGoalCap;
  return { goals: goals.slice(0, tunables.organizationGoalCap), capBound };
}

/** A hand character the general-influence headroom could unlock. */
interface HeadroomCandidate {
  readonly name: string;
  readonly mind: number;
  /** `potentialDiscount ×` his marginal-MP TSD. */
  readonly creditTsd: number;
}

/** MP-bearing characters in hand, the raw material of the headroom term. */
function headroomCandidates(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  standing: Standing,
  tunables: Tunables,
): HeadroomCandidate[] {
  const candidates: HeadroomCandidate[] = [];
  for (const card of view.self.hand) {
    const def = cardPool[card.definitionId];
    if (!def || !isCharacterCard(def)) continue;
    const fields = def as unknown as {
      name?: string; marshallingPoints?: number; marshallingCategory?: string; mind?: number | null;
    };
    const mp = fields.marshallingPoints ?? 0;
    if (mp <= 0) continue;
    const source = (fields.marshallingCategory ?? 'character') as MpSource;
    const marginal = standing.tsdAfter({ [source]: mp }) - standing.tsd;
    if (marginal <= 0) continue;
    candidates.push({
      name: fields.name ?? card.definitionId,
      mind: fields.mind ?? 0,
      creditTsd: marginal * tunables.potentialDiscount,
    });
  }
  return candidates;
}

/** Build the organization potential for one position. */
function buildComputeOrganization(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  standing: Standing,
  tunables: Tunables,
  commitment?: Commitment,
): Organization {
  const defence = computeDefence(view, cardPool, standing, tunables);
  const reach = computeReach(cardPool);
  const { goals, capBound } = goalList(view, cardPool, standing, tunables, commitment);
  const headroom = headroomCandidates(view, cardPool, standing, tunables);

  // The view's baseline follower assignment: who controls whom, and what the
  // general-influence pool has free. Controller overrides are priced as
  // adjustments against this baseline, with control cost taken as effective
  // mind — the engine's control-cost overrides are not in the view, recorded
  // rather than guessed.
  const baselineController = new Map<string, string>();
  for (const character of Object.values(view.self.characters)) {
    for (const follower of character.followers) {
      baselineController.set(follower as string, character.instanceId as string);
    }
  }
  const baselineFreeGi = (view.self.generalInfluence ?? GENERAL_INFLUENCE)
    - view.self.generalInfluenceUsed;

  // Per-roster harm, cached by canonical roster signature — the same rosters
  // recur across every candidate this position offers.
  const harmCache = new Map<string, number>();
  const harmOf = (characterIds: readonly string[]): number => {
    const key = characterIds.join('|');
    let harm = harmCache.get(key);
    if (harm === undefined) {
      const roster = rosterOf({ characters: characterIds as unknown as CardInstanceId[] },
        view.self.characters, cardPool);
      harm = defence.expectedHarm(roster, roster.length);
      harmCache.set(key, harm);
    }
    return harm;
  };

  // A site's toll on a roster — the netting inside the matching weight.
  // Cached by (roster, site): the same rosters recur across candidates.
  const siteHarmCache = new Map<string, number>();
  const siteHarmOf = (characterIds: readonly string[], siteDefinitionId: string): number => {
    const key = `${characterIds.join('|')}@${siteDefinitionId}`;
    let harm = siteHarmCache.get(key);
    if (harm === undefined) {
      const roster = rosterOf({ characters: characterIds as unknown as CardInstanceId[] },
        view.self.characters, cardPool);
      harm = defence.harmFrom(roster, automaticAttacksOf(cardPool, siteDefinitionId));
      siteHarmCache.set(key, harm);
    }
    return harm;
  };

  const valueOf = (arrangement: Arrangement): ArrangementValue => {
    // Canonical form: rosters sorted, empty companies dropped, companies
    // ordered by their lowest member. This is condition one of the potential:
    // the answer is a function of the arrangement as a set.
    const companies = arrangement.companies
      .map(company => ({
        ...company,
        characterIds: [...company.characterIds].map(id => id as string).sort(),
      }))
      .filter(company => company.characterIds.length > 0)
      .sort((a, b) => (a.characterIds[0] < b.characterIds[0] ? -1
        : a.characterIds[0] > b.characterIds[0] ? 1 : 0));

    // The effective controller of every character, overrides applied.
    const controllerOf = (id: string): string =>
      arrangement.controllers?.[id] ?? baselineController.get(id) ?? 'general';
    // Free direct influence under this assignment: printed DI less the mind
    // of everyone held with it.
    const heldMind = new Map<string, number>();
    let freeGi = baselineFreeGi;
    for (const character of Object.values(view.self.characters)) {
      const id = character.instanceId as string;
      const controller = controllerOf(id);
      const baseline = baselineController.get(id) ?? 'general';
      if (controller !== 'general') {
        heldMind.set(controller, (heldMind.get(controller) ?? 0) + mindOf(cardPool, view, id));
      }
      // Stacking a follower releases the general influence that held him;
      // un-stacking charges it again.
      if (controller !== 'general' && baseline === 'general') freeGi += mindOf(cardPool, view, id);
      if (controller === 'general' && baseline !== 'general') freeGi -= mindOf(cardPool, view, id);
    }
    const freeDirectInfluence = (id: string): number => {
      const character = view.self.characters[id as CardInstanceId];
      if (!character) return 0;
      return character.effectiveStats.directInfluence - (heldMind.get(id) ?? 0);
    };

    // The best untapped influencer's free direct influence, per company —
    // what `checkP` for a faction goal is recomputed from. This is what makes
    // the follower assignment part of the potential.
    const bestFreeDi = companies.map(company => Math.max(0, ...company.characterIds
      .filter(id => view.self.characters[id as CardInstanceId]?.status === CardStatus.Untapped)
      .map(freeDirectInfluence)));

    const harmPerCompany = companies.map(company => harmOf(company.characterIds));
    const harmTsd = harmPerCompany.reduce((sum, harm) => sum + harm, 0);

    // The weight matrix of the matching:
    //
    //   w(g, c) = netPayoff(g, c) × discount × reach × checkP
    //
    // where the net payoff subtracts the site's toll on the *serving* roster
    // for an opportunity (a committed plan's payoff was netted at commit
    // time), `checkP` for a faction is recomputed from the arrangement's best
    // untapped influencer, and the discount applies unless committed.
    const weightOf = (
      goal: OrganizationGoal,
      companyIndex: number,
    ): { p: number; valueTsd: number; weightTsd: number } => {
      const company = companies[companyIndex];
      const liveHarm = goal.committed || goal.siteDefinitionId === undefined
        ? 0
        : siteHarmOf(company.characterIds, goal.siteDefinitionId);
      const netPayoffTsd = goal.payoffTsd - liveHarm;
      if (netPayoffTsd <= 0) return { p: 0, valueTsd: 0, weightTsd: 0 };
      const route = goal.siteDefinitionId === undefined
        ? { routeProbability: 1 }
        : routeProbabilityFor(
          {
            currentSite: company.currentSiteDefinitionId === undefined
              ? null : { definitionId: company.currentSiteDefinitionId },
            destinationSite: company.destinationSiteDefinitionId === undefined
              ? null : { definitionId: company.destinationSiteDefinitionId },
          },
          goal.siteDefinitionId, reach, tunables,
        );
      const checkP = goal.faction
        ? pAtLeast(Math.max(2, (goal.influenceTarget ?? DEFAULT_INFLUENCE_TARGET) - bestFreeDi[companyIndex]))
        : 1;
      const p = route.routeProbability * checkP;
      const valueTsd = netPayoffTsd * (goal.committed ? 1 : tunables.potentialDiscount);
      return { p, valueTsd, weightTsd: p * valueTsd };
    };

    // Exact maximum-weight assignment: at most one goal per company, each
    // card used at most once. The board is a handful of companies against at
    // most `organizationGoalCap` goals, so brute force over the goal list is
    // exact — and deterministic, because goals are visited in list order and
    // companies in canonical order, and only a strictly better total
    // displaces the incumbent.
    let best: { total: number; picks: (number | null)[] } = {
      total: 0, picks: goals.map(() => null),
    };
    const picks: (number | null)[] = goals.map(() => null);
    const usedCompanies = new Set<number>();
    const usedCards = new Set<string>();
    const search = (goalIndex: number, total: number): void => {
      if (goalIndex === goals.length) {
        if (total > best.total + 1e-12) best = { total, picks: [...picks] };
        return;
      }
      const goal = goals[goalIndex];
      const card = goal.cardInstanceId as string | undefined;
      if (card === undefined || !usedCards.has(card)) {
        for (let companyIndex = 0; companyIndex < companies.length; companyIndex++) {
          if (usedCompanies.has(companyIndex)) continue;
          const { weightTsd } = weightOf(goal, companyIndex);
          if (weightTsd <= 0) continue;
          usedCompanies.add(companyIndex);
          if (card !== undefined) usedCards.add(card);
          picks[goalIndex] = companyIndex;
          search(goalIndex + 1, total + weightTsd);
          picks[goalIndex] = null;
          usedCompanies.delete(companyIndex);
          if (card !== undefined) usedCards.delete(card);
        }
      }
      search(goalIndex + 1, total);
    };
    search(0, 0);

    const assignments: GoalAssignment[] = [];
    best.picks.forEach((companyIndex, goalIndex) => {
      if (companyIndex === null) return;
      const goal = goals[goalIndex];
      const { p, valueTsd, weightTsd } = weightOf(goal, companyIndex);
      const names = companies[companyIndex].characterIds.map(id => nameOf(cardPool, view, id));
      assignments.push({
        goal,
        companyIndex,
        companyLabel: names.length > 2 ? `${names[0]} +${names.length - 1}` : names.join(', '),
        p,
        valueTsd,
        weightTsd,
      });
    });

    // The general-influence headroom: what stacking a follower buys. The best
    // MP-bearing character in hand the pool could now fit, credited at his
    // discounted marginal TSD. A function of `freeGeneralInfluence` alone,
    // hence part of Φ.
    const fitting = headroom.filter(candidate => candidate.mind <= freeGi);
    const unlocked = fitting.reduce<HeadroomCandidate | null>(
      (bestSoFar, candidate) => (bestSoFar === null || candidate.creditTsd > bestSoFar.creditTsd
        ? candidate : bestSoFar),
      null);
    const headroomTsd = unlocked?.creditTsd ?? 0;

    const opportunityTsd = best.total + headroomTsd;
    const shift = -harmTsd + headroomTsd;

    // Fold the Bernoullis onto the deterministic shift, in goal-list order —
    // an order fixed by the position, not by the arrangement.
    let distribution: { p: number; dtsd: number; served: string[] }[] = [{
      p: 1, dtsd: shift, served: [],
    }];
    for (const assignment of assignments) {
      const value = assignment.valueTsd;
      distribution = distribution.flatMap(outcome => [
        {
          p: outcome.p * assignment.p,
          dtsd: outcome.dtsd + value,
          served: [...outcome.served, assignment.goal.label],
        },
        { p: outcome.p * (1 - assignment.p), dtsd: outcome.dtsd, served: outcome.served },
      ]).filter(outcome => outcome.p > 0);
    }
    const outcomes: Outcome[] = distribution.map(outcome => ({
      p: outcome.p,
      dtsd: outcome.dtsd,
      label: outcome.served.length > 0
        ? `the shape serves: ${outcome.served.join('; ')}`
        : 'the shape pays off no goal',
    }));

    const expectedTsd = -harmTsd + opportunityTsd;
    const scored = standing.score(outcomes);

    const detail: Rationale[] = companies.map((company, index) => {
      const serving = assignments.find(a => a.companyIndex === index);
      const names = company.characterIds.map(id => nameOf(cardPool, view, id)).join(', ');
      return leaf(`company: ${names}`, -harmPerCompany[index], {
        unit: 'tsd',
        note: serving
          ? `serves "${serving.goal.label}" at ${(serving.p * 100).toFixed(0)}% `
            + `for ${serving.weightTsd.toFixed(2)} tsd`
          : 'serves no goal — it only carries harm',
      });
    });
    detail.push(leaf('general-influence headroom', headroomTsd, {
      unit: 'tsd',
      tunable: 'potentialDiscount',
      note: unlocked
        ? `${freeGi} free fits ${unlocked.name} (mind ${unlocked.mind})`
        : `${freeGi} free fits no marshalling-point character waiting in hand`,
    }));
    if (capBound) {
      detail.push(leaf('goal list truncated', tunables.organizationGoalCap, {
        tunable: 'organizationGoalCap',
        note: 'a performance bound like hazardBeamWidth — lower-value goals were dropped',
      }));
    }

    return {
      harmTsd,
      opportunityTsd,
      headroomTsd,
      expectedTsd,
      outcomes,
      assignments,
      u: scored.utility,
      rationale: node('arrangement', scored.utility, [
        leaf('harm the shapes invite', -harmTsd, { unit: 'tsd' }),
        leaf('opportunity the shapes serve', opportunityTsd, { unit: 'tsd' }),
        ...detail,
        scored.rationale,
      ], { unit: 'winprob' }),
    };
  };

  return {
    goals,
    capBound,
    valueOf,
    current(): Arrangement {
      return {
        companies: view.self.companies.map(company => ({
          characterIds: company.characters,
          currentSiteDefinitionId: company.currentSite?.definitionId,
          destinationSiteDefinitionId: company.destinationSite?.definitionId,
        })),
      };
    },
  };
}

/**
 * Build the service, once per position.
 *
 * One `Organization` per view is condition two of the potential: both sides
 * of every comparison must read the same goal list, typical attack and
 * commitment, or `utility(change) + utility(undo)` stops being zero.
 */
export const computeOrganization = memoizeOnFirst(buildComputeOrganization);
