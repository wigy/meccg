/**
 * @module ai/h2/core/dice
 *
 * Exact 2d6 probability tables.
 *
 * Almost every uncertain decision in MECCG resolves as `2d6 + modifiers`
 * against a target: strike prowess (CoE 3.iv), body checks (CoE 3.iv.7),
 * influence checks for factions (CoE 4.x), corruption checks. H1 carried a
 * rounded integer-percentage table; H2 needs exact values because outcome
 * probabilities must sum to 1 and are checked against the real reducer by the
 * calibration harness, where a 1% rounding error is a visible bias.
 *
 * All functions are pure lookups over a 36-outcome table — cheap enough to
 * call inside the per-decision budget (`< 1 ms` median) without memoisation.
 */

/** Number of equally likely 2d6 rolls. */
const OUTCOMES = 36;

/** Ways to roll each total on 2d6, indexed by total (2..12). */
const WAYS: readonly number[] = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];

/** Lowest and highest possible 2d6 totals. */
const MIN_TOTAL = 2;
const MAX_TOTAL = 12;

/** Probability that 2d6 comes up exactly `total`. */
export function pExactly(total: number): number {
  if (total < MIN_TOTAL || total > MAX_TOTAL) return 0;
  return WAYS[total] / OUTCOMES;
}

/**
 * Probability that 2d6 is at least `need` — the shape most MECCG checks take
 * ("roll `need` or better to succeed").
 */
export function pAtLeast(need: number): number {
  if (need <= MIN_TOTAL) return 1;
  if (need > MAX_TOTAL) return 0;
  let ways = 0;
  for (let t = need; t <= MAX_TOTAL; t++) ways += WAYS[t];
  return ways / OUTCOMES;
}

/** Probability that 2d6 is strictly greater than `value`. */
export function pGreaterThan(value: number): number {
  return pAtLeast(value + 1);
}

/** Probability that 2d6 is at most `value`. */
export function pAtMost(value: number): number {
  return 1 - pGreaterThan(value);
}

/**
 * Probability a body check *fails*, which is the outcome that kills the
 * character: CoE 3.iv.7 resolves a body check as `2d6 + modifiers > body`,
 * and the engine (`handleBodyCheckRoll` in `combat-actions.ts`) implements
 * exactly that comparison. Failure eliminates the character; passing leaves it
 * merely wounded.
 *
 * @param body     - The character's (or creature's) body value.
 * @param modifier - Summed roll modifiers, e.g. `+1` when already wounded.
 */
export function pBodyCheckFailed(body: number, modifier = 0): number {
  return pGreaterThan(body - modifier);
}

/**
 * Probability a strike is defeated by the defender: the defender rolls
 * `2d6 + modifiers` against the strike's prowess and must equal or exceed it
 * (CoE 3.iv). `need` is the already-modified target the engine would compare
 * against.
 */
export function pStrikeDefeated(need: number): number {
  return pAtLeast(need);
}
