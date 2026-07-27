/**
 * @module ai/h2/modules/combat/attack-model
 *
 * What a whole attack is worth, for the decisions taken before any strike is
 * resolved: who faces what, and whether to cancel the attack at all.
 *
 * The strike window can read the engine's published target; this window has to
 * project one. It does so by planning the defence the way a defender actually
 * assigns — the character most likely to parry takes the strike, overflow
 * strikes pile up as excess penalties — and then convolving the per-strike
 * distributions into one distribution for the attack.
 *
 * Convolving rather than summing expectations is what makes cancelling
 * comparable to facing. Passing at the cancel window *is* the attack's
 * distribution, spread and all; cancelling is a near-certain small cost. A
 * player who is behind should sometimes take the attack precisely because it
 * might go well, and that only falls out if the spread survives.
 *
 * Two simplifications are declared by every evaluation that uses this: strikes
 * are treated as independent (in truth a character wounded by the first strike
 * faces the second at −2, which makes a multi-strike attack worse than modelled
 * — the supermodularity §3.4 relies on), and the hypothetical assignment
 * assumes the defender assigns greedily and the attacker piles excess strikes
 * on the same characters.
 */

import type { CardDefinition, CombatState, PlayerView } from '@meccg/shared';
import { CardStatus } from '@meccg/shared';
import type { Outcome } from '../../core/types.js';
import type { ConvolutionResult } from '../../core/distribution.js';
import { convolveOutcomes } from '../../core/distribution.js';
import type { StrikeOption, StrikeOutcome, StrikeSituation } from './strike-model.js';
import { strikeOutcomes } from './strike-model.js';
import type { StrikeTarget } from './prowess.js';
import { availableDefenders, bodyOf, predictedNeed, strikeTargets } from './prowess.js';

/** One projected strike: who faces it, how, and against what. */
export interface PlannedStrike {
  /** The character or ally expected to face it. */
  readonly target: StrikeTarget;
  /** How they would face it — tapping to fight, at the projected target. */
  readonly option: StrikeOption;
  /** The fixed properties of the strike. */
  readonly situation: StrikeSituation;
  /** Excess strikes piled on this target, for the rationale. */
  readonly excessStrikes: number;
}

/**
 * Project how the defending company would meet `strikeCount` strikes.
 *
 * Untapped characters are used first and in order of who parries best, which
 * is both what a defender does and what the engine's assignment rules allow
 * (CoE 3.iv). Once they run out, strikes cycle back onto the same characters
 * as excess strikes at −1 prowess each — the engine's overflow rule.
 */
export function planDefence(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  combat: CombatState,
  strikeCount: number,
  forcedFirst?: StrikeTarget,
): PlannedStrike[] {
  const untapped = availableDefenders(view, cardPool, combat);
  // With nobody untapped the engine still assigns strikes, to whoever is left.
  const all = untapped.length > 0 ? untapped : strikeTargets(view, cardPool, combat);
  // A forced first strike is how an `assign-strike` candidate is priced: this
  // character takes this strike, and the rest of the attack falls on whoever
  // is left. Without removing them from the roster the same character would
  // be projected to face two strikes at once.
  const roster = forcedFirst ? all.filter(t => t.instanceId !== forcedFirst.instanceId) : all;
  if (roster.length === 0 && !forcedFirst) return [];

  const build = (target: StrikeTarget, excessStrikes: number): PlannedStrike => ({
    target,
    excessStrikes,
    option: {
      need: predictedNeed(target, cardPool, combat, { excessStrikes }),
      tapMode: 'always',
      bestOfTwo: false,
      bodyPenalty: 0,
    },
    situation: {
      creatureBody: combat.creatureBody,
      detainment: combat.detainment,
      characterBody: bodyOf(target, cardPool),
      alreadyWounded: target.status === CardStatus.Inverted,
      bodyCheckModifier: combat.bodyCheckModifier ?? 0,
    },
  });

  const planned: PlannedStrike[] = [];
  if (forcedFirst && strikeCount > 0) planned.push(build(forcedFirst, 0));
  const remaining = strikeCount - planned.length;
  for (let i = 0; i < remaining && roster.length > 0; i++) {
    planned.push(build(roster[i % roster.length], Math.floor(i / roster.length)));
  }
  return planned;
}

/** Prices one strike outcome for one target, in TSD. */
export type StrikePricer = (outcome: StrikeOutcome, target: StrikeTarget) => number;

/**
 * The distribution of facing every planned strike, in the common currency.
 *
 * An empty plan means there is nothing to face — a certain zero, which is the
 * right answer for an attack with no strikes left rather than an error.
 */
export function composeAttack(planned: readonly PlannedStrike[], price: StrikePricer): ConvolutionResult {
  if (planned.length === 0) {
    return { outcomes: [{ p: 1, label: 'no strikes remain', dtsd: 0 }], merged: false };
  }
  const distributions: Outcome[][] = planned.map(strike =>
    strikeOutcomes(strike.option, strike.situation).map(outcome => ({
      p: outcome.p,
      label: labelFor(outcome, strike),
      dtsd: price(outcome, strike.target),
    })));
  return convolveOutcomes(distributions);
}

/** Short description of one projected strike outcome. */
function labelFor(outcome: StrikeOutcome, strike: PlannedStrike): string {
  const who = strike.target.instanceId as string;
  switch (outcome.character) {
    case 'eliminated': return `${who} eliminated`;
    case 'wounded': return `${who} wounded`;
    case 'tapped': return outcome.strike === 'defeated' ? `${who} parries and taps` : `${who} taps`;
    default: return outcome.strike === 'defeated' ? `${who} parries` : `${who} unharmed`;
  }
}
