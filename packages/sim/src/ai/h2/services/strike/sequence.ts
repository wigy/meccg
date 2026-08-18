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
import type { Tunables } from '../../core/tunables.js';
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

/** The company's condition when a strike lands, for pricers that need it. */
export interface StrikeContext {
  /**
   * Characters (not allies) still untapped in the company, this strike
   * included.
   *
   * The attacking seat needs it and the defending seat does not: what tapping
   * a character *denies* depends on how many are left to tap, which is a
   * question about the roster rather than about the character struck.
   */
  readonly untappedBefore: number;
}

/** Prices one strike outcome for one target in its current condition. */
export type SequencePricer = (
  outcome: StrikeOutcome,
  target: StrikeTarget,
  context: StrikeContext,
) => number;

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
  /**
   * How hard to search the attacker's choice, when the attack allows one.
   *
   * Only consulted for a profile carrying `attackerChooses`; a defender-assigns
   * attack has nothing to search. Defaults to `'greedy'`, which is the answer
   * that costs nothing.
   */
  readonly attackerChoice?: AttackerChoice;
  /**
   * Whose ledger `price` is written in.
   *
   * The two seats price the same event with opposite signs — the hazard side
   * counts harm done as a positive number, the defending side counts harm
   * suffered as a negative one — and an attacker maximising the wrong one picks
   * the *least* damaging target every time. There is no way to infer this from
   * the numbers, so the caller states it. Defaults to `'attacker'`.
   */
  readonly ledger?: PriceLedger;
}

/**
 * How the attacker's choice of defending character is searched.
 *
 * - `'greedy'` — one step: the target whose expected outcome is worth most right
 *   now. Costs one extra outcome enumeration per candidate per strike, and gets
 *   the ordinary case right, including spreading: once the good parrier is
 *   tapped, striking him again is worth less than turning to someone else, so
 *   the second strike moves on without being told to.
 * - `'exhaustive'` — the adaptive optimum over the rest of *this* attack: at
 *   every strike, for every reachable condition of the company, the choice that
 *   maximises what follows. This is what finds the plans whose payoff is two
 *   strikes away, where the greedy step looks worse than an alternative.
 */
export type AttackerChoice = 'greedy' | 'exhaustive';

/** Whose ledger a {@link SequencePricer} writes in. See {@link SequenceOptions.ledger}. */
export type PriceLedger = 'attacker' | 'defender';

/**
 * How hard to search the attacker's choice at a given standing.
 *
 * One owner for the policy, because the hazard side planning an attack and the
 * defending side predicting one must assume the *same* attacker; two private
 * copies would be two different opinions about how well the opponent plays.
 *
 * `risk.lambda` is `1 − 2W` (`core/risk.ts`), so it is positive when losing and
 * negative when winning. A player who is ahead takes the cheap answer; a player
 * who is behind pays for the search, which is where the two-strike plans live.
 */
export function attackerChoiceAt(
  risk: { readonly lambda: number },
  tunables: Tunables,
): AttackerChoice {
  return risk.lambda >= tunables.attackerChoiceSearchLambda ? 'exhaustive' : 'greedy';
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
  /**
   * True when the *attacker* assigns this attack's strikes (CoE: "attacker
   * chooses defending characters"), rather than the defence answering with its
   * best parrier.
   *
   * This inverts the whole target-selection rule, and the inversion is worth far
   * more than the printed prowess suggests. A Cave-drake (le-66) makes two
   * strikes at prowess 10 and chooses who faces them, so it can tap the good
   * parrier and then wound the character his ability was protecting — a plan
   * that is simply unavailable to an attack of the same size that lets the
   * defence answer.
   */
  readonly attackerChooses?: boolean;
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

/**
 * Who may face the next strike.
 *
 * Untapped characters answer first and tapped ones only when nobody is left
 * standing, which is the engine's own rule and applies whichever side is
 * choosing. It is also what keeps the attacker honest: a character he has
 * already tapped drops out of the pool while his company-mates are still up, so
 * "tap the one who matters" is a thing he can do once, not every strike.
 */
function candidatesOf(roster: readonly RosterEntry[]): readonly RosterEntry[] {
  const untapped = roster.filter(e => e.target.status === CardStatus.Untapped);
  return untapped.length > 0 ? untapped : roster;
}

/** The next target to be struck: the best available parrier in its current state. */
function pickTarget(
  roster: readonly RosterEntry[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  strikeProwess: number,
): RosterEntry | undefined {
  if (roster.length === 0) return undefined;
  return [...candidatesOf(roster)].sort((a, b) =>
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
    // Published by the engine rather than read off the card, because by this
    // point the rule may have been granted to the attack by an event rather
    // than printed on the creature.
    attackerChooses: combat.attackerChoosesDefenders ?? false,
  };
  // This entry point resolves the attack from the *defending* seat — the roster
  // is `view.self` — so its pricer counts harm suffered as a negative number.
  // Saying so is what stops an attacker-chooses search from maximising the
  // defender's comfort.
  return resolveAttacks(all, cardPool, [profile], price, { ...options, ledger: 'defender' });
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

  const ledgerSign = options.ledger === 'defender' ? -1 : 1;
  const attackerChoice = options.attackerChoice ?? 'greedy';

  /** What one outcome is worth *to the attacking side*, whichever ledger it is priced in. */
  const gainOf = (outcome: StrikeOutcome, target: StrikeTarget, context: StrikeContext): number =>
    ledgerSign * price(outcome, target, context);

  /** The count a pricer reads as `untappedBefore`. */
  const untappedIn = (entries: readonly RosterEntry[]): number =>
    entries.filter(e => !e.target.isAlly && e.target.status === CardStatus.Untapped).length;

  /** The outcome distribution of aiming one strike of `profile` at one entry. */
  const outcomesAgainst = (entry: RosterEntry, profile: AttackProfile): StrikeOutcome[] =>
    strikeOutcomes(
      {
        need: needAgainst(entry.target, cardPool, profile.strikeProwess, { excessStrikes: entry.struck }),
        tapMode: 'always',
        bestOfTwo: false,
        bodyPenalty: 0,
      },
      situationFor(entry.target, profile),
    );

  /**
   * The best expected gain from `strikesLeft` further strikes of this attack,
   * with the attacker choosing each target after seeing how the last one went.
   *
   * Memoised on the roster's condition and the strikes remaining, which is what
   * makes the adaptive optimum affordable: the same company state is reached by
   * many different orders of the same outcomes, and it is worth the same every
   * time. Only the current attack is searched — what the *next* creature in a
   * bundle would do is decided by whoever ordered the bundle, and folding it in
   * here would be a second opinion about that decision.
   *
   * `budget` bounds the walk by the same `maxStates` the enumeration itself
   * respects. If it binds, the continuation is valued at zero, which degrades
   * the choice toward the greedy one rather than toward anything wilder; at the
   * strike counts that occur in play (four is a large attack) it does not bind.
   *
   * What it leaves out is the kill marshalling points, which the walk banks once
   * per attack on the branch where every strike was defeated. Folding them in
   * would need the `allDefeated` flag threaded through the recursion for a
   * correction that runs one way: aiming at the character least likely to beat
   * the strike also makes "every strike defeated" less likely, so the omission
   * *understates* what the attacker gains by choosing. Conservative in the
   * direction that matters, and declared rather than silent.
   */
  const lookahead = (
    entries: readonly RosterEntry[],
    profile: AttackProfile,
    strikesLeft: number,
    memo: Map<string, number>,
    budget: { nodes: number },
  ): number => {
    if (strikesLeft <= 0) return 0;
    const pool = candidatesOf(entries);
    if (pool.length === 0) return 0;
    if (budget.nodes >= options.maxStates) return 0;
    const key = `${signatureOf(entries)}#${strikesLeft}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    budget.nodes += 1;

    const untappedBefore = untappedIn(entries);
    let best = -Infinity;
    for (const entry of pool) {
      let value = 0;
      for (const outcome of outcomesAgainst(entry, profile)) {
        value += outcome.p * (
          gainOf(outcome, entry.target, { untappedBefore })
          + lookahead(applyOutcome(entries, entry, outcome), profile, strikesLeft - 1, memo, budget)
        );
      }
      if (value > best) best = value;
    }
    const result = best === -Infinity ? 0 : best;
    memo.set(key, result);
    return result;
  };

  /**
   * The target the *attacker* picks, when the attack lets him.
   *
   * The greedy arm is one step and the exhaustive arm searches the rest of the
   * attack; both maximise the same quantity, so the only difference is how far
   * ahead they look. Neither is told to prefer the weakest character or the best
   * parrier — which one wins falls out of the pricer, and that is the point:
   * tapping a prowess-1 character who can cancel strikes for his company beats
   * wounding a prowess-7 warrior exactly when `denial` says it does.
   */
  const chooseAttackerTarget = (
    entries: readonly RosterEntry[],
    profile: AttackProfile,
    strikesLeft: number,
  ): RosterEntry | undefined => {
    const pool = candidatesOf(entries);
    if (pool.length <= 1) return pool[0];
    const deep = attackerChoice === 'exhaustive' && strikesLeft > 1;
    const memo = new Map<string, number>();
    const budget = { nodes: 0 };
    const untappedBefore = untappedIn(entries);

    let best: RosterEntry | undefined;
    let bestValue = -Infinity;
    for (const entry of pool) {
      let value = 0;
      for (const outcome of outcomesAgainst(entry, profile)) {
        value += outcome.p * (
          gainOf(outcome, entry.target, { untappedBefore })
          + (deep ? lookahead(applyOutcome(entries, entry, outcome), profile, strikesLeft - 1, memo, budget) : 0)
        );
      }
      if (value > bestValue) {
        bestValue = value;
        best = entry;
      }
    }
    return best;
  };

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
        // Who answers this strike: a named character the caller forced, else the
        // attacker's own pick when the attack carries that rule, else the
        // defence's best remaining parrier.
        const answering = profile.attackerChooses
          ? chooseAttackerTarget(state.roster, profile, profile.strikes - i)
          : pickTarget(state.roster, cardPool, profile.strikeProwess);
        const entry = first && i === 0 && forced
          ? state.roster.find(e => e.target.instanceId === forced.instanceId) ?? answering
          : answering;
        if (!entry) {
          // Nobody left to face it. The strike cannot be resolved against this
          // company, so the sequence stops here rather than inventing a victim.
          next.push(state);
          continue;
        }
        const need = needAgainst(entry.target, cardPool, profile.strikeProwess, { excessStrikes: entry.struck });
        const untappedBefore = state.roster.filter(
          e => !e.target.isAlly && e.target.status === CardStatus.Untapped,
        ).length;
        if (first && state === states[0] && opening.length === i) opening.push({ target: entry.target, need });

        for (const outcome of strikeOutcomes(
          { need, tapMode: 'always', bestOfTwo: false, bodyPenalty: 0 },
          situationFor(entry.target, profile),
        )) {
          next.push({
            roster: applyOutcome(state.roster, entry, outcome),
            p: state.p * outcome.p,
            dtsd: state.dtsd + price(outcome, entry.target, { untappedBefore }),
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
