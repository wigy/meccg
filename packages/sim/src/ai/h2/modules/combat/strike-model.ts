/**
 * @module ai/h2/modules/combat/strike-model
 *
 * Closed-form outcome model for one strike.
 *
 * The engine publishes the already-modified 2d6 target on every strike action
 * it offers — `resolve-strike` and `play-strike-event` both carry `need`,
 * computed in `legal-actions/combat.ts` from the full modifier stack
 * (stay-untapped penalty, tapped −1, wounded −2, excess strikes, support +1
 * each, weapon effects keyed to the attacker's race, strike-event bonuses).
 * Reading that number instead of recomputing it is the difference between a
 * model that tracks the rules and one that drifts from them the next time a
 * card adds a modifier: there is exactly one prowess stack, and it lives in
 * the engine.
 *
 * What is left is genuinely the AI's own work — turning `need` into a
 * probability distribution over what happens to the character and the
 * creature, and pricing each branch.
 */

import { pAtLeast, pAtMost, pBestOfTwoAtLeast, pBestOfTwoExactly, pBodyCheckFailed, pExactly } from '../../core/dice.js';

/** How the character taps when the strike does not wound it. */
export type TapMode =
  /** Tap to fight: taps on a defeat or a tie (`resolve-strike` with `tapToFight`). */
  | 'always'
  /** Stay untapped: taps only on a tie (CoE 3.iv, the −3 option). */
  | 'tie-only'
  /** Dodge: never taps, at the price of a card and a body penalty. */
  | 'never';

/** One way of facing the current strike, as offered by the engine. */
export interface StrikeOption {
  /** The 2d6 target the engine published on the action. */
  readonly need: number;
  /** Whether the character taps when it is not wounded. */
  readonly tapMode: TapMode;
  /** Reroll cards roll twice and keep the better total. */
  readonly bestOfTwo: boolean;
  /** Body modifier applied to the character's own body check (dodge, Risky Blow). */
  readonly bodyPenalty: number;
}

/** The parts of the combat state a strike's outcome depends on. */
export interface StrikeSituation {
  /** The attack's body, or null when it has none and a parry defeats it outright. */
  readonly creatureBody: number | null;
  /** Detainment attacks tap instead of wounding, and award no kill MP. */
  readonly detainment: boolean;
  /** The struck character's printed body. */
  readonly characterBody: number;
  /** Whether the character was already wounded — worth +1 on its body check. */
  readonly alreadyWounded: boolean;
  /** Attack-level body-check modifier (e.g. Cruel Caradhras +1). */
  readonly bodyCheckModifier: number;
}

/** What happens to the struck character. */
export type CharacterFate = 'untapped' | 'tapped' | 'wounded' | 'eliminated';

/** What happens to the attacking creature as a result of this strike. */
export type StrikeFate =
  /** The character parried and the attack's body check failed: this strike is defeated. */
  | 'defeated'
  /** The character parried but the attack survived its body check. */
  | 'survived'
  /** A tie: ineffectual, and explicitly not a defeat (CoE 8.19). */
  | 'tie'
  /** The strike got through. */
  | 'struck';

/** One joint outcome of resolving a strike, with the probability it occurs. */
export interface StrikeOutcome {
  /** Probability of this joint outcome. */
  readonly p: number;
  /** What happened to the character. */
  readonly character: CharacterFate;
  /** What happened to the strike. */
  readonly strike: StrikeFate;
}

/** Probability the character's roll beats, ties, or loses to the strike. */
function rollSplit(option: StrikeOption): { win: number; tie: number; lose: number } {
  if (option.bestOfTwo) {
    const win = pBestOfTwoAtLeast(option.need);
    const tie = pBestOfTwoExactly(option.need - 1);
    return { win, tie, lose: Math.max(0, 1 - win - tie) };
  }
  return {
    win: pAtLeast(option.need),
    tie: pExactly(option.need - 1),
    lose: pAtMost(option.need - 2),
  };
}

/**
 * The full outcome distribution of facing a strike one particular way.
 *
 * Outcomes with zero probability are dropped: a distribution that lists
 * unreachable branches cannot be checked against the reducer, and the core
 * invariant rejects it.
 */
export function strikeOutcomes(option: StrikeOption, situation: StrikeSituation): StrikeOutcome[] {
  const { win, tie, lose } = rollSplit(option);

  // A parried strike is only defeated if the attack then fails its own body
  // check (CoE 3.iv.7). An attack with no body is defeated outright.
  const pAttackDefeated = situation.creatureBody === null ? 1 : pBodyCheckFailed(situation.creatureBody);

  // Detainment attacks tap rather than wound, so no body check follows.
  const pEliminatedGivenStruck = situation.detainment
    ? 0
    : pBodyCheckFailed(
      situation.characterBody + option.bodyPenalty,
      (situation.alreadyWounded ? 1 : 0) + situation.bodyCheckModifier,
    );

  const parriedFate: CharacterFate = option.tapMode === 'always' ? 'tapped' : 'untapped';
  const struckFate: CharacterFate = situation.detainment ? 'tapped' : 'wounded';

  const outcomes: StrikeOutcome[] = [
    { p: win * pAttackDefeated, character: parriedFate, strike: 'defeated' },
    { p: win * (1 - pAttackDefeated), character: parriedFate, strike: 'survived' },
    // A tie taps the character whatever the mode — staying untapped does not
    // survive an ineffectual exchange (CoE 3.iv.7), and only a dodge avoids it.
    { p: tie, character: option.tapMode === 'never' ? 'untapped' : 'tapped', strike: 'tie' },
    { p: lose * (1 - pEliminatedGivenStruck), character: struckFate, strike: 'struck' },
    { p: lose * pEliminatedGivenStruck, character: 'eliminated', strike: 'struck' },
  ];
  return outcomes.filter(o => o.p > 0);
}
