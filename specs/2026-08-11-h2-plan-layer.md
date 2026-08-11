# H2 Plan Layer: Long-Term Planning Across Modules

*Status: design, 2026-08-11. Extends `2026-07-27-heuristics-2-ai.md` rather
than superseding it — every module, service and CLI described there stays.
What this adds is a layer above them, and one change to how their numbers are
combined.*

*Nothing here is implemented. One design decision is still open (§7).*

## 1. The evidence

The live server's recorded games (`~/backup/ai-meccg.com/games`, 107 completed
human-versus-AI games across 21 distinct human players) are **107–0** to the
humans. The per-category marshalling-point breakdown says why in a way the
scoreline does not:

| category | human med/mean | AI med/mean | AI games scoring zero |
|---|---|---|---|
| character | 7.0 / 7.7 | 2.0 / 2.4 | 30/102 |
| item | 6.0 / 6.7 | 0.0 / **0.7** | **77/102** |
| faction | 5.0 / 5.7 | 0.0 / **1.0** | **67/102** |
| ally | 2.0 / 3.0 | 0.0 / 0.1 | **94/102** |
| kill | 2.0 / 2.5 | 2.0 / 2.2 | 22/102 |
| misc | 2.0 / 2.6 | 0.0 / **−1.7** | 65/102 |

The AI's score is concentrated in the one category that requires no plan.
`kill` MP happens *to* you when a hazard connects, and it is the only category
where the AI keeps pace. Item, faction and ally each require a multi-turn
commitment — keep the resource, build a company that survives the trip, route
it, enter, play, come home — and the AI scores near-zero in all three. `misc`
is net negative: points shed with no plan behind them.

That is not the distribution a badly-tuned evaluator produces. It is the
signature of a value function that cannot represent *"this is worth doing
because of what it enables four turns from now"*.

Three corroborating measurements:

- **Instrumented self-play** (four games, `h2` versus `heuristic`,
  challenge decks A/B, seeds 1–4) offered `h2` a `play-hero-resource`
  **three times in four games**, and it took the action every time. The
  acquisition modules are not declining to score; they are never asked.
- In the same run `enter-site` was declined two times in three, at a mean
  **fractional rank of 1.00** — dead last, every single time.
  `evaluateEnterSite` prices entering as what becomes playable *now* minus
  the site's automatic attacks *now*, so with nothing in hand to play it is
  structurally negative against `pass` at zero. The arithmetic is right; the
  question is being asked after the plan that would have justified the trip
  was never formed.
- `travel`'s own module comment already states the gap: a destination is
  worth only what the cards *already in hand* would pay there, because the
  strategic half of the H2 plan §3.3 is unwritten. That closes a loop with
  `hand`, which has no reason to keep a resource for a site the agent will
  never route to.

**Depth is not the missing thing, and the repo has already shown it.** The
horizon experiment in `packages/sim/README.md` reports 1 turn at 82%, 2 turns
at 68%, 3 turns at 80%, 6 turns at 77% — no monotone gain, under a section
titled "Why depth buys nothing". The `mc` agent searches real rollouts, is the
strongest agent in the package by a wide margin, and still scores a median 2
MP against humans. A random rollout does not execute a plan either: four turns
of random play will never route a company to a site and play an item, so the
value estimate at depth 4 is the same as at depth 1. The myopic evaluator and
the deep search are missing the same object.

> The measurements above were taken with a throwaway `scoring-loop` diagnostic
> that was **not kept**. Rebuilding it — offered-versus-taken per action type,
> with the *never offered* / *offered and declined* distinction — is step 0 of
> §8, because it is the outcome metric this whole design is judged on.

## 2. What a plan is

Not a sequence of intended actions. A plan is a **commitment carrying a payoff
and a completion probability**.

- **goal** — the MP-bearing event: *play Hauberk of Bright Mail on Théoden at
  Isengard*.
- **payoff** — the **marginal** TSD of that event, through `standing`, never
  its nominal MP. CoE 10.3 step 4 caps any source at half the total, so a
  third faction can be worth exactly zero; a planner that chases nominal MP
  will chase points it cannot score. This is the same argument §2.1 of the H2
  spec makes for the whole design, applied one level up.
- **deadline** — the turn by which it must land.
- **requirements** — what other modules must deliver, named rather than
  assumed: `{ company-at-site, company-0, Isengard, byTurn: 12 }`,
  `{ untapped, Théoden, atArrival }`.
- **P(complete)** — the product of the surviving steps: reach the site
  (`exposure`, `beliefs`), survive the automatic attack (`defence`), have a
  tap available (`budget`), make the roll (`dice`), get home (`exposure`).

That last line is the strongest argument that this layer fits the existing
architecture: **P(complete) is mostly composition of services that already
exist.** This is new bookkeeping over `standing`, `exposure`, `beliefs`,
`defence` and `budget`, not new modelling.

Requirements are also how cross-module planning happens without every module
modelling the whole game. `resources` proposes the goal and names what it
needs; `travel` sees an unmet `company-at-site` requirement and proposes the
routing that satisfies it; `characters` sees the trip and proposes the company
shape that survives it. This is goal decomposition, HTN-shaped, and the prior
art is worth consulting before inventing a variant of it.

## 3. Every module plans; one future is committed

The H2 spec's rule that two models of the same choice will eventually disagree
— stated in `travel.ts` as the reason `plan-movement` and `cancel-movement`
share one `destinationValue` — does not forbid per-module planning. It forbids
per-module *futures*. Split proposal from commitment and both hold:

- **Modules propose.** Any module that can see a payoff proposes plans.
  Per-module, and every module may do it.
- **A shared service commits.** Once per turn it selects a compatible
  portfolio — a company can only be in one place, a character taps once — and
  that committed set is *the* future every module then prices against.

Portfolio selection is small: a handful of companies against a handful of
plans. Greedy by value density is sufficient. Do not build a solver.

## 4. How contributions combine

Two technical facts decide this, and both argue against rank-based voting.

**Utilities are not additive.** Modules today return ΔP(win), and `W` is
nonlinear in TSD. Summing or averaging two modules' ΔP(win) is arithmetically
wrong. Aggregate in **TSD space** and convert through `W` **once**, at the
plan's expected completion turn — which also gets endgame discounting for
free, since `W(tsd, turn)` already takes the turn.

**There is already a common currency, and voting discards it.** Borda or
plurality over modules throws away magnitude and buys Arrow-style pathologies
in exchange. A social-choice mechanism is the wrong instrument when the
contributions are commensurable.

So the rule is:

```text
score(a) = Σ_p ∈ committed  payoff_p × [ P_p(complete | a) − P_p(complete | pass) ]
         + tactical(a)                      // combat, corruption, denial — unchanged

utility(a) = W(tsd + score(a), turn_p) − W(tsd, turn_p)
```

The baseline is `pass`, which `core/baseline.ts` already defines as zero.

The discipline that makes the sum sound is: **the plan owns the payoff; a
module claims only its marginal effect on the completion probability.** That
is what stops `travel` and `resources` both booking the same 2 item MP. The
single-owner registry prevents that double-count today, and this rule is what
replaces it.

Notice what falls out without special-casing. `enter-site` currently ranks
dead last because it is priced as immediately-playable minus immediate harm.
Under this rule, entering moves P(complete) from ~0 to ~1 and collects the
whole payoff. The trip that was already paid for is finally credited.

### What voting was for, bought more cheaply

The real argument for bounded influence is that most modules are not
calibrated — five are, 46 claims in all — so one module with a broken scale
can dominate a sum. Keep the currency and bound it:

- **A per-module influence cap** on the absolute contribution to any one
  decision.
- **A veto channel carrying facts, not preferences** — "this taps the
  character the plan needs", "this kills the plan's carrier", "the engine
  marked this a regress". Boolean, rare, and every veto must be defensible as
  a fact rather than an opinion.

The right fix for a miscalibrated module is calibration (§6). The cap is what
keeps it from costing games in the meantime.

## 5. Failure modes to design against

**Plan thrash is the split/merge cycle one level up.** Plain `h2` was measured
spending an entire 25,000-decision budget on
`split-company` → `plan-movement` → `merge-companies`, rotating the planned
destination between four sites so that no lap repeated a state the engine's
`regress` flag had seen. Two shapes both scoring positive and alternating.
Plan A and plan B alternating every turn is that same bug in strategy space,
and nothing completes. It needs explicit hysteresis: a committed plan gets a
continuation bonus (equivalently, switching pays a cost), and abandonment
happens on an explicit trigger — P(complete) below a threshold, or the
deadline passed — never on being marginally out-ranked.

**Propose slowly, score fast.** `h2` runs around 170 decisions/sec today.
Proposing over site deck × hand × companies on every decision will not survive
that. Proposal is per-turn and memoized (`core/memo.ts`); the per-decision
path must be the P(complete) delta and nothing else.

**Requirements can deadlock.** A plan whose requirement no module ever
proposes to satisfy sits in the portfolio consuming commitment and paying
nothing. Unsatisfied requirements need a deadline of their own, after which
the plan is dropped.

## 6. What becomes falsifiable

This is the part that fits the repo's culture best. A plan makes a far
stronger checkable claim than a module evaluation does: *P(complete) = 0.6* is
settled by replaying to the deadline and seeing whether it completed. That is
a Brier score over plans, using the machinery `fit-winprob` and `calibrate`
already have. A planner systematically overconfident about reaching sites then
becomes a measured fact rather than an argument.

`explain` prints the committed portfolio above the ranking, and each
candidate's contribution per plan — otherwise this layer is undebuggable.

The outcome metric is the §1 table: item, faction and ally MP moving off zero.

## 7. Open decision

Aggregate in TSD with bounded per-module influence plus factual vetoes (§4),
or true rank-based voting across modules?

This spec argues for the first. If the motivation for voting is distrust of
the modules' *scales* rather than of their *preferences*, the cap-and-veto
version buys that without discarding magnitude. **Resolve before writing
types.**

## 8. Incremental path

0. **Rebuild the diagnostic.** Offered-versus-taken per action type, with the
   *never offered* versus *offered and declined* distinction. Without it there
   is no way to tell whether any of the below worked.
1. **Plan service and proposal registry.** `explain` prints the portfolio.
   Contribution weight **zero** — no behaviour change, and the plans are
   inspectable before they can hurt anything.
2. **One proposer, one consumer.** `resources` proposes; `travel` consumes the
   `company-at-site` requirement. Turn the weight on. Success is item MP
   moving off zero.
3. **Widen.** `hand` (keep the card the plan needs), `factions`, `characters`
   (company shape for the trip), `hazards` (defend the plan).
4. **Calibrate** P(complete) against replayed outcomes.
5. **Gate** against the current champion.

## 9. Later

The opponent has plans too. `beliefs` already estimates what they hold;
proposing *their* plans and letting `denial` and `hazards` price disruption
against them is where denial value should come from, instead of the standalone
heuristic it is now. Out of scope until §8 step 3 has shipped.
