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
  /**
   * How much of a faction point's value is forfeited by tapping the character
   * who could have attempted the check, per point of marginal value.
   *
   * Multiplied by `standing.marginal.faction`, so it is correctly zero when the
   * faction source is capped: tapping that character then costs nothing beyond
   * the flat tempo, because there was no attempt worth making.
   */
  readonly influenceTapCost: number;
  /**
   * Cost in TSD per point of follower mind that reverts to the general
   * influence pool when its holder is eliminated. The reversion is a hard
   * consequence (CoE 2.II.2.2.3); this prices it.
   */
  readonly revertedMindCost: number;
  /**
   * How good a covered action must look, in win probability, before H2 acts on
   * an *incomplete* view of a decision.
   *
   * Utilities are changes in win probability relative to doing nothing, so a
   * positive one is a claim that the action improves the position — a claim
   * that needs no reference to the candidates H2 could not score. Requiring a
   * clear margin rather than any positive number is the concession to what is
   * unknown: an unowned candidate might have been better still, and the cost
   * of that is bounded by only speaking when the covered opinion is strong.
   */
  readonly partialCoverageMargin: number;
  /**
   * How far H2's best candidate must beat its runner-up, in win probability,
   * before H2 keeps a decision it *completely* covers.
   *
   * A different question from `partialCoverageMargin`, which asks how sure H2
   * must be to act blind to candidates it could not score. This one asks
   * whether there is a decision here at all: two candidates a thousandth of a
   * win probability apart are a coin flip dressed as an opinion, and the module
   * tree has no more claim on that coin flip than the fallback does.
   *
   * It matters because the fallback is a parameter now. Handing a near-tie to
   * Heuristics 1 would be giving it away; handing it to a rollout search is
   * asking a stronger agent to break the tie, and the search only pays for the
   * decisions that reach it. Zero — the shipped value — keeps the old rule
   * exactly: any strict preference is acted on, however small.
   */
  readonly decisiveMargin: number;
  /**
   * What one resource card drawn is worth, in TSD.
   *
   * Cards drawn are not marshalling points, but they are what the points are
   * made of, and during movement/hazard the draw is the whole reason to
   * resolve one company before another. A price rather than a tally, so the
   * criterion can be compared against everything else in the same currency.
   */
  readonly resourceDrawValue: number;
  /**
   * How many bundles `hazards` keeps alive while planning (§3.4).
   *
   * Bundle value is supermodular, so the subset space cannot be searched
   * greedily without losing exactly the combinations worth finding — and it
   * cannot be searched exhaustively either, because this runs in mass
   * self-play. The beam is the explicit compromise the plan asks for, and its
   * width is reported alongside the ranked bundles so a reader can see how
   * much of the space was actually looked at.
   */
  readonly hazardBeamWidth: number;
  /**
   * Marshalling points one denied resource play would have scored.
   *
   * §3.4 puts the hazard player's objective as the negative of the opponent's
   * expected MP gain, and this is the conversion rate: what a character who
   * arrives tapped, and therefore cannot be tapped to play a resource, costs
   * them. It is a *quantity of MP*, not a price, so it goes through `standing`
   * and picks up the doubling and the diversity cap — denying a play in a
   * source they have already capped is correctly worth nothing.
   *
   * The value it is not: `tapTempoCost`. That is what a tap costs the defender
   * in the middle of a combat they are already in, and using it here priced a
   * whole site phase at a third of a point, which made every hazard in the game
   * look like a mistake.
   */
  readonly deniedPlayMp: number;
  /**
   * The most hazards `hazards` will plan into one company at once.
   *
   * A hard cap on top of the hazard limit, because the enumeration is over
   * *sequences* of attacks and each one multiplies the state space. Bundles
   * this long are rare in play; when the cap binds it is reported.
   */
  readonly hazardMaxBundle: number;
  /**
   * The chance an on-guard card is ever revealed and pays, in [0, 1].
   *
   * Placement itself is free: an on-guard card that is never revealed returns
   * to the hazard player's hand at cleanup (`reducer-site.ts`), so the card is
   * not spent. What is uncertain is whether the option is ever exercised — the
   * company may never enter, and the reveal conditions (CoE 2.V.i) are narrow.
   * So this discounts the *gain* and nothing else.
   *
   * It used to discount a bundle price that included the cost of the card,
   * which charged half a card for a placement the rules charge nothing for.
   */
  readonly onGuardDiscount: number;
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
  influenceTapCost: 0.6,
  revertedMindCost: 0.15,
  partialCoverageMargin: 0.005,
  decisiveMargin: 0,
  resourceDrawValue: 0.35,
  hazardBeamWidth: 4,
  deniedPlayMp: 1,
  hazardMaxBundle: 3,
  onGuardDiscount: 0.5,
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
