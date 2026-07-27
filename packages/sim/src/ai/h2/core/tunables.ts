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
  /**
   * Cost in TSD of tapping a character or ally that was untapped.
   *
   * A tapped character cannot tap again to play a resource at the site, which
   * is the whole reason hazards are worth playing: the denial is the damage.
   * Small but never zero — an AI that taps freely arrives at its site unable
   * to score.
   */
  readonly tapTempoCost: number;
  /**
   * Cost in TSD of wounding a healthy character, beyond any MP it carries: it
   * is out of action until healed, fights at −2 meanwhile, and usually costs
   * the company a trip to a haven.
   */
  readonly woundTempoCost: number;
  /**
   * Cost in TSD of losing a character *beyond* the marshalling points that
   * leave with it — the influence it supplied, the items it can no longer
   * carry, and the tempo of replacing it. The MP loss itself is computed from
   * card data, so this covers only what MP cannot express.
   */
  readonly eliminationTempoCost: number;
  /**
   * Provisional price of spending a card from hand, in TSD, until the `hand`
   * module computes a real per-card shadow price (plan §3.5, P6).
   *
   * Explicitly a placeholder: it is one number where there should be a
   * function of the standing, the deck remaining, and what the hazard side
   * expects to need. It is named in every rationale that uses it so a P1
   * explanation can never hide which price produced the decision.
   */
  readonly provisionalCardPrice: number;
  /**
   * Ceiling on the number of live states while an attack is resolved strike by
   * strike. Beyond it, states are merged — probability mass is conserved, but
   * the enumeration stops being exhaustive and says so.
   *
   * A performance bound, not a gameplay choice: the sequence branches about
   * fivefold per strike, and the per-decision budget is a millisecond.
   */
  readonly attackStateCap: number;
  /**
   * Cost in TSD of crossing one region on the way to a site.
   *
   * A stand-in for a hazard model, and labelled as one. What a region actually
   * costs is what the opponent can play into it, which needs the belief half
   * of `exposure` (§3.6); until that exists, distance is charged by length
   * rather than by danger. H1 spent a hand-tuned table here (wilderness 2,
   * shadow-land 4, dark-domain 5) buried inside a destination score — this is
   * one number, named, and visible in every rationale that uses it.
   */
  readonly regionCrossingCost: number;
}

/** The shipped constant set. Overridden per-run by `sweep --over tunable:*`. */
export const DEFAULT_TUNABLES: Tunables = {
  potentialDiscount: 0.5,
  softmaxTemperature: 0.02,
  riskCurvatureScale: 1,
  meanVarianceWinProbSlope: 0.02,
  tapTempoCost: 0.3,
  woundTempoCost: 1.5,
  eliminationTempoCost: 3,
  provisionalCardPrice: 1,
  attackStateCap: 192,
  regionCrossingCost: 0.4,
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
