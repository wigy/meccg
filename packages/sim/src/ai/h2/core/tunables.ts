/**
 * @module ai/h2/core/tunables
 *
 * The single typed constants object for Heuristics 2.
 *
 * H1's weights were tuned by hand at the point of use, which is why they ended
 * up meaningless across evaluators. H2 forbids that: any number that is not
 * derived from card data, the player view, or a probability table must be a
 * named field here, and the field name must appear in the {@link Rationale}
 * that used it. That makes every hand-chosen number greppable, sweepable
 * (`sweep --over tunable:<name>`), and visible in `explain` output.
 *
 * Constants are added here as the module that needs them ships — an unused
 * tunable is a constant nobody can calibrate.
 */

/** Named constants shared by all H2 modules. */
export interface Tunables {
  /**
   * Discount `γ` applied to *potential* MP — points a play unlocks but does
   * not bank yet (an item that still has to reach its site, a character freed
   * up for later). §2.3 of the plan: undiscounted potential is how a scorer
   * talks itself into greedy lines, a failure already measured in
   * `docs/ai-training-system.md` §10.
   */
  readonly potentialDiscount: number;
  /**
   * Softmax temperature converting utilities (win-probability deltas) into
   * sampling weights. Low values approach argmax; the behavioural-cloning
   * pipeline consumes the resulting distribution as soft targets, so this is
   * not merely an exploration knob.
   */
  readonly softmaxTemperature: number;
  /**
   * Scale from the local curvature of the win-probability curve to the risk
   * posture `λ`. At 1.0 the posture is exactly `1 − 2·W`: maximally
   * risk-seeking when a loss looks certain, maximally risk-averse when a win
   * does, neutral at an even game.
   */
  readonly riskCurvatureScale: number;
  /**
   * Win-probability slope used by the mean-variance shortcut to convert a TSD
   * figure into a win-probability delta when a module cannot afford to
   * integrate `W` over its outcomes. Expressed as win probability per TSD
   * point at an even standing.
   */
  readonly meanVarianceWinProbSlope: number;
}

/** The shipped constant set. Overridden per-run by `sweep --over tunable:*`. */
export const DEFAULT_TUNABLES: Tunables = {
  potentialDiscount: 0.5,
  softmaxTemperature: 0.02,
  riskCurvatureScale: 1,
  meanVarianceWinProbSlope: 0.02,
};

/**
 * Copy of the defaults with one field overridden by name.
 *
 * Used by the sweep tooling, which addresses tunables as strings coming from
 * the command line; throws on an unknown name so a typo fails loudly instead
 * of silently sweeping nothing.
 */
export function withTunable(base: Tunables, name: string, value: number): Tunables {
  if (!(name in base)) {
    throw new Error(`Unknown tunable "${name}" — available: ${Object.keys(base).join(', ')}`);
  }
  return { ...base, [name]: value };
}
