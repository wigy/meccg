/**
 * @module ai/h2/services/strike/sequence
 *
 * Resolving an attack's strikes **in sequence**, carrying the company's
 * condition from one strike to the next.
 *
 * The first version of the attack model priced strikes independently, and that
 * understated multi-strike attacks in a specific, systematic way: a character
 * tapped by the first strike faces the second at −1, a wounded one at −2, and
 * an eliminated one is not there at all — so the strikes that follow land on a
 * company that is measurably worse at answering them. That degradation is not
 * a detail. It is the whole reason two attacks landed together are worth more
 * than the same two spread across turns, which is the supermodularity §3.4
 * needs before `hazards` can plan bundles at all.
 *
 * So this is a forward enumeration over the strike sequence rather than a
 * convolution of independent distributions. Each state carries the roster's
 * current condition, the probability of having reached it, and the TSD
 * accumulated on the way. Two things fall out of tracking the roster that the
 * independent model could only approximate:
 *
 * - **Repeat damage is priced correctly.** Tapping a character who is already
 *   tapped costs nothing more, and the model knows it, because the roster says
 *   so rather than a flag set at the root.
 * - **Kill MP becomes exact.** The points arrive only if *every* strike is
 *   defeated (`combat-finalize.ts`), and a sequence knows whether that
 *   happened; the independent model had to convolve the kill term separately
 *   and assume it uncorrelated with the harm outcomes.
 *
 * `resolveAttacks` extends the same walk over a *sequence of attacks* against
 * one roster, which is what a hazard bundle is. Excess-strike penalties reset
 * between attacks — they are a within-attack rule — while the roster's
 * condition carries, so the supermodularity above is produced rather than
 * asserted.
 *
 * The state space is bounded by merging states that agree on the roster and
 * fall in the same TSD bucket, then — only if that is still too many — by
 * merging across rosters. Probability mass is always conserved; a truncated
 * enumeration is reported so it is never mistaken for an exhaustive one.
 */

import { CardStatus } from '@meccg/shared';
import type { CardDefinition, CombatState, PlayerView } from '@meccg/shared';
import type { Outcome } from '../../core/types.js';
import type { StrikeOutcome, StrikeSituation } from './strike-model.js';
import { strikeOutcomes } from './strike-model.js';
import type { StrikeTarget } from './prowess.js';
import { availableDefenders, bodyOf, effectiveStrikeProwess, needAgainst, strikeTargets } from './prowess.js';

/** A strike target together with how many strikes it has already faced. */
interface RosterEntry {
  readonly target: StrikeTarget;
  /** Strikes already faced this attack — each further one costs −1 prowess. */
  readonly struck: number;
}

/** One reachable condition of the company partway through the attack. */
interface SequenceState {
  readonly roster: readonly RosterEntry[];
  readonly p: number;
  readonly dtsd: number;
  /** True while every strike so far has been defeated — the kill-MP condition. */
  readonly allDefeated: boolean;
  readonly label: string;
}

/** Prices one strike outcome for one target in its current condition. */
export type SequencePricer = (outcome: StrikeOutcome, target: StrikeTarget) => number;

/** Knobs of the enumeration itself. */
export interface SequenceOptions {
  /** Ceiling on live states; beyond it, states are merged. */
  readonly maxStates: number;
  /** A character forced to take the first strike (an `assign-strike` candidate). */
  readonly forcedFirst?: StrikeTarget;
  /** TSD gained if the whole attack is defeated, or 0. */
  readonly killTsd?: number;
  /** Description of the kill-MP payoff, for outcome labels. */
  readonly killLabel?: string;
}

/**
 * One attack the roster has to answer, described without a `CombatState`.
 *
 * The attacking seat has no combat to read: `hazards` is choosing which
 * creatures to *play*, so everything here comes off the card. The defending
 * seat builds the same profile from the live combat, which is what keeps one
 * enumeration serving both.
 */
export interface AttackProfile {
  /** Prowess the defenders must beat. */
  readonly strikeProwess: number;
  /** How many strikes this attack makes. */
  readonly strikes: number;
  /** The attack's body, or null when a parry defeats it outright. */
  readonly creatureBody: number | null;
  /** Detainment attacks tap instead of wounding, and award no kill MP. */
  readonly detainment: boolean;
  /** Attack-level body-check modifier. */
  readonly bodyCheckModifier: number;
  /** TSD gained if *this* attack is wholly defeated, or 0. */
  readonly killTsd?: number;
  /** Description of that payoff, for outcome labels. */
  readonly killLabel?: string;
  /** Name of the attacking creature, for labels in a bundle. */
  readonly name?: string;
}

/** What the enumeration produced. */
export interface SequenceResult {
  /** The distribution over the whole attack. */
  readonly outcomes: readonly Outcome[];
  /** True when states were merged to respect the cap. */
  readonly merged: boolean;
  /** Who is projected to face each strike, before any degradation. */
  readonly opening: readonly { readonly target: StrikeTarget; readonly need: number }[];
}

/** Width of the TSD buckets states are merged into. */
const BUCKET_WIDTH = 0.25;

/** The roster's condition as a comparable key. */
function signatureOf(roster: readonly RosterEntry[]): string {
  return roster.map(e => `${e.target.instanceId as string}:${e.target.status}:${e.struck}`).join('|');
}

/** The next target to be struck: the best available parrier in its current state. */
function pickTarget(
  roster: readonly RosterEntry[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  strikeProwess: number,
): RosterEntry | undefined {
  if (roster.length === 0) return undefined;
  const untapped = roster.filter(e => e.target.status === CardStatus.Untapped);
  const pool = untapped.length > 0 ? untapped : roster;
  return [...pool].sort((a, b) =>
    needAgainst(a.target, cardPool, strikeProwess, { excessStrikes: a.struck })
    - needAgainst(b.target, cardPool, strikeProwess, { excessStrikes: b.struck }))[0];
}

/** The roster after a strike outcome has been applied to one of its members. */
function applyOutcome(
  roster: readonly RosterEntry[],
  entry: RosterEntry,
  outcome: StrikeOutcome,
): RosterEntry[] {
  const next: RosterEntry[] = [];
  for (const current of roster) {
    if (current.target.instanceId !== entry.target.instanceId) {
      next.push(current);
      continue;
    }
    if (outcome.character === 'eliminated') continue; // gone from the company
    const status = outcome.character === 'wounded' ? CardStatus.Inverted
      : outcome.character === 'tapped' ? CardStatus.Tapped
        : current.target.status;
    next.push({ target: { ...current.target, status }, struck: current.struck + 1 });
  }
  return next;
}

/** Merge states that agree on the roster and land in the same TSD bucket. */
function mergeStates(states: readonly SequenceState[], acrossRosters: boolean): SequenceState[] {
  const groups = new Map<string, SequenceState[]>();
  for (const state of states) {
    const key = `${acrossRosters ? '' : signatureOf(state.roster)}#${Math.round(state.dtsd / BUCKET_WIDTH)}`
      + `#${state.allDefeated ? 1 : 0}`;
    const group = groups.get(key);
    if (group) group.push(state);
    else groups.set(key, [state]);
  }
  return [...groups.values()].map(group => {
    const p = group.reduce((sum, s) => sum + s.p, 0);
    // The representative is the likeliest member: its roster is the one the
    // remaining strikes will be resolved against, and its label the one the
    // reader sees.
    const dominant = group.reduce((best, s) => (s.p > best.p ? s : best), group[0]);
    return {
      roster: dominant.roster,
      p,
      dtsd: group.reduce((sum, s) => sum + s.p * s.dtsd, 0) / p,
      allDefeated: dominant.allDefeated,
      label: dominant.label,
    };
  });
}

/**
 * Enumerate the attack strike by strike.
 *
 * @param strikeCount - how many strikes are still to come.
 * @param price - what one outcome costs, given the target's condition.
 */
export function resolveSequentially(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  combat: CombatState,
  strikeCount: number,
  price: SequencePricer,
  options: SequenceOptions,
): SequenceResult {
  const untapped = availableDefenders(view, cardPool, combat);
  const all = untapped.length > 0 ? untapped : strikeTargets(view, cardPool, combat);
  const profile: AttackProfile = {
    strikeProwess: effectiveStrikeProwess(combat),
    strikes: strikeCount,
    creatureBody: combat.creatureBody,
    detainment: combat.detainment,
    bodyCheckModifier: combat.bodyCheckModifier ?? 0,
    killTsd: options.killTsd,
    killLabel: options.killLabel,
  };
  return resolveAttacks(all, cardPool, [profile], price, options);
}

/**
 * Enumerate a whole *bundle* of attacks against one roster, in order.
 *
 * This is the form §3.4 needs and the reason the enumeration was written as a
 * forward walk over roster states rather than a convolution. Between attacks
 * the excess-strike counter resets — piling strikes on one character is a
 * within-attack penalty — but the *condition* carries: a character tapped by
 * the first creature meets the second at −1, a wounded one at −2, and an
 * eliminated one is not there at all.
 *
 * That carry-over is the entire supermodularity. Two creatures played into the
 * same company are worth more than the same two played a turn apart, and the
 * difference is not a bonus term invented here — it falls out of resolving them
 * against a roster that degrades.
 */
export function resolveAttacks(
  roster: readonly StrikeTarget[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  profiles: readonly AttackProfile[],
  price: SequencePricer,
  options: SequenceOptions,
): SequenceResult {
  const forced = options.forcedFirst;
  const start: RosterEntry[] = (forced
    ? [forced, ...roster.filter(t => t.instanceId !== forced.instanceId)]
    : roster
  ).map(target => ({ target, struck: 0 }));

  const situationFor = (target: StrikeTarget, profile: AttackProfile): StrikeSituation => ({
    creatureBody: profile.creatureBody,
    detainment: profile.detainment,
    characterBody: bodyOf(target, cardPool),
    alreadyWounded: target.status === CardStatus.Inverted,
    bodyCheckModifier: profile.bodyCheckModifier,
  });

  const opening: { target: StrikeTarget; need: number }[] = [];
  let states: SequenceState[] = [{ roster: start, p: 1, dtsd: 0, allDefeated: true, label: '' }];
  let merged = false;
  let first = true;

  for (const profile of profiles) {
    for (let i = 0; i < profile.strikes; i++) {
      const next: SequenceState[] = [];
      for (const state of states) {
        // The first strike may be forced onto a named character; after that the
        // company answers with whoever is best placed *now*.
        const entry = first && i === 0 && forced
          ? state.roster.find(e => e.target.instanceId === forced.instanceId)
            ?? pickTarget(state.roster, cardPool, profile.strikeProwess)
          : pickTarget(state.roster, cardPool, profile.strikeProwess);
        if (!entry) {
          // Nobody left to face it. The strike cannot be resolved against this
          // company, so the sequence stops here rather than inventing a victim.
          next.push(state);
          continue;
        }
        const need = needAgainst(entry.target, cardPool, profile.strikeProwess, { excessStrikes: entry.struck });
        if (first && state === states[0] && opening.length === i) opening.push({ target: entry.target, need });

        for (const outcome of strikeOutcomes(
          { need, tapMode: 'always', bestOfTwo: false, bodyPenalty: 0 },
          situationFor(entry.target, profile),
        )) {
          next.push({
            roster: applyOutcome(state.roster, entry, outcome),
            p: state.p * outcome.p,
            dtsd: state.dtsd + price(outcome, entry.target),
            allDefeated: state.allDefeated && outcome.strike === 'defeated',
            label: state.label === '' ? describe(entry, outcome) : `${state.label}; ${describe(entry, outcome)}`,
          });
        }
      }

      states = mergeStates(next, false);
      if (states.length > options.maxStates) {
        states = mergeStates(states, true);
        merged = true;
      }
      if (states.length > options.maxStates) merged = true;
    }

    // The attack is over: bank its kill MP on the branches that beat every one
    // of *its* strikes, and reset for the next creature. Excess strikes do not
    // carry between attacks; the roster's condition does.
    const killTsd = profile.killTsd ?? 0;
    states = states.map(state => ({
      roster: state.roster.map(e => ({ target: e.target, struck: 0 })),
      p: state.p,
      dtsd: state.dtsd + (state.allDefeated ? killTsd : 0),
      allDefeated: true,
      label: state.allDefeated && killTsd > 0
        ? `${state.label || 'no strikes'} — ${profile.killLabel ?? 'attack beaten'}`
        : state.label,
    }));
    first = false;
  }

  const outcomes: Outcome[] = states
    .filter(state => state.p > 0)
    .map(state => ({
      p: state.p,
      label: state.label || 'no strikes remain',
      dtsd: state.dtsd,
    }));

  return { outcomes, merged, opening };
}

/** Short description of one strike's result, for the composite label. */
function describe(entry: RosterEntry, outcome: StrikeOutcome): string {
  const who = entry.target.name;
  switch (outcome.character) {
    case 'eliminated': return `${who} eliminated`;
    case 'wounded': return `${who} wounded`;
    case 'tapped': return outcome.strike === 'defeated' ? `${who} parries` : `${who} taps`;
    default: return outcome.strike === 'defeated' ? `${who} parries untapped` : `${who} unharmed`;
  }
}
