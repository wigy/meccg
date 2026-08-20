# H2 Organization Phase: One Potential for Company Shape and Follower Stacking

*Status: design, 2026-08-20. Extends `2026-07-27-heuristics-2-ai.md` §3.2
(the roster plan that "does not exist") and `2026-08-11-h2-plan-layer.md`
§8 step 3 ("widen: `characters` — company shape for the trip"). Nothing here
is implemented.*

## 1. The requirement and the gap

The organization phase is where the agent must take responsibility for
arranging all its characters optimally, and the requirement has three parts:

1. **Leading: keep safe big companies.** Fewer, larger companies; safety
   first.
2. **Trailing: consider splitting into more companies** — how far behind
   counts as trailing depends on the turn, the later the more hurried — but
   **only when there are resources to play for all** of the resulting
   companies.
3. **Always stack followers in the best possible manner** — but **leave
   direct influence free for factions** too.

What the code does today, and why each part fails:

- `modules/characters/characters.ts` prices `split-company`,
  `merge-companies` and `move-to-company` by exactly one thing: the harm the
  shape invites (`services/defence.ts` `expectedHarm(roster, roster.length)`,
  a company's hazard limit being its own size). Its own docstring records the
  missing half: *"splitting also lets two companies reach two sites, which is
  usually the reason anyone does it, and pricing that needs destinations the
  organization phase has not chosen yet."* The destinations now exist — they
  are the committed portfolio of the plan layer — but `ModuleContext` never
  receives the commitment, so `evaluateShape` cannot read them.
- "Leading keeps big companies" works today only by accident: harm-only
  pricing usually favours concentration, but it is not connected to the
  standing at all. `evaluateShape` emits a single `p: 1` outcome, so
  `sigmaTsd` is zero and the risk oracle's curvature has nothing to grip. A
  player forty points ahead and one forty behind price every split
  identically.
- "Trailing splits to score in parallel" never happens for the right reason,
  because the upside of a split — a second company serving a second
  MP-bearing goal — is priced nowhere.
- Follower stacking is priced in one direction only. `influenceUnlocked`
  credits *freeing* direct influence toward a faction attempt, but the code
  ignores `MoveToInfluenceAction.controlledBy`
  (`'general' | CardInstanceId`, `types/actions-organization.ts`) and charges
  both directions as if they freed DI. The to-DI direction — stack a follower
  to free general influence for new characters — is never credited, and
  nothing reserves DI for a committed faction attempt.
- No "can I support two companies?" check exists anywhere in the package.
  The only multi-company reasoning is the hazard-limit harm differential.

The binding constraint on any fix is the oscillation invariant the module
already documents: shape value **must** be a difference of one potential over
the whole board, or split and merge cycle forever. It did, twice, and both
times a game burned thousands of decisions inside a single organization
phase. The new hazard this design introduces — and resolves in §5 — is that
the invariant must now hold *through the curvature of `W`*, because the whole
point is to give the risk machinery variance to act on.

## 2. Architecture: one organization potential over the whole board

A new strategic service, `services/organization.ts`, defines a single
potential `Φ` over the whole **arrangement** — the partition of characters
into companies plus the follower assignment — consumed by the `characters`
module. Not a `characters.proposePlans` proposer: a plan is a commitment
carrying a payoff and a deadline, and "be shaped like this" has neither. Its
value is entirely instrumental to the plans that already exist, shape actions
are per-decision while commitment is per-turn, and the portfolio's conflict
model knows companies, characters and cards, not shapes. The plan layer
already gives shape its cross-turn teeth through `CARRIER_STEP`
(`characters.planStepDelta`: stripping a committed company's last untapped
character costs the whole commitment); this design adds the tactical pricing,
and §6 keeps the two channels disjoint.

The potential composes with the existing defence term rather than replacing
it:

```text
Φ(arrangement) = − Σ_c expectedHarm(roster_c, |roster_c|)    (existing)
               + OpportunityValue(arrangement)               (new)
```

and — the critical part — the utility of an organization action is **not**
`standing.score` of a delta distribution but the difference of one scored
number per arrangement:

```text
u(arrangement)  = E[ W(tsd + X(arrangement), turn) ] − W(tsd, turn)
utility(action) = u(after) − u(before)
```

where `X(arrangement)` is the arrangement's outcome distribution: a
deterministic `−Σ harm` shift folded with one Bernoulli per assigned goal
(§3). Because every arrangement maps to exactly one number `u`, the ranking
over shape actions is a potential *at the utility level*: any accepted change
strictly increases `u`, arrangements are finite, so no cycle is possible — at
any risk posture. §5 shows why the obvious alternative breaks precisely when
trailing.

### Why the commitment must reach `ModuleContext`

`agent.ts` computes the commitment (`portfolio.commit(...)`) *after* building
the module context and never hands it to `evaluateDecision` — modules today
literally cannot see the destinations the agent has chosen. The fix follows
the `Standing` pattern: the `Commitment` / `DroppedPlan` / `DropReason`
*types* move from `services/portfolio.ts` into `core/plan.ts` (they are
vocabulary, no behaviour), `services/portfolio.ts` re-exports them, and
`ModuleContext` gains `readonly commitment?: Commitment`.

Proposers deliberately do **not** see the commitment: `agent.decide` builds
the base context, runs `proposePlans` and `portfolio.commit` on it, then
builds `{ ...moduleContext, commitment }` for `evaluateDecision` and
`rankWithPlans`. A proposer that read the commitment could propose what is
already committed into a feedback loop; the ordering makes that structurally
impossible.

## 3. The service

`computeOrganization = memoizeOnFirst((view, cardPool, standing, tunables,
commitment?) => Organization)`, one per position, with three parts.

**The goal list**, computed once per position: committed plans with an
MP-bearing goal first (`commitment.plans`; their `payoffTsd` is already
marginal and net of site harm), then unserved hand opportunities from the
shared enumeration below, deduplicated by `cardInstanceId` — a committed card
is not also an opportunity. Non-committed goals are discounted by
`potentialDiscount`, in exactly the H2 spec §2.3 sense: unbanked and
uncommitted. The list is truncated to the top `organizationGoalCap` by
discounted payoff with a deterministic tie-break — a performance bound like
`hazardBeamWidth`, reported in the rationale when it binds.

**The matching**: an exact maximum-weight assignment of goals to companies,
at most one goal per company, each `cardInstanceId` used at most once, with

```text
w(g, c) = payoffTsd(g)
        × reachProbability(distance(c.site, g.site), planUnroutedReachProbability)
        × checkP(g, c)                    // factions: pAtLeast(target − best free DI)
        × (committed ? 1 : potentialDiscount)
```

`checkP` for factions is recomputed from the arrangement's best untapped
influencer's free direct influence — this is what makes the follower
assignment part of the potential. Distances come from `services/reach.ts`
with the proposers' existing null-distance convention. The board is at most a
handful of companies against at most `organizationGoalCap` goals, so the
matching is brute-force over permutations with deterministic tie-breaks
(goal id, then company index after canonical ordering). One goal per company
is a stated assumption: within the horizon a company serves one destination
at a time, and discounting sequential service to zero is the conservative
reading. It makes the split upside *exactly* "the best goal the second
company can serve that the first could not".

**`valueOf(arrangement)`** returns the harm term, the opportunity term, the
outcome distribution `X`, the assignments, the scored
`u = standing.score(outcomes).utility`, and a rationale naming which goal
each company serves at what probability — the line that finally answers "why
did it split". It must be a function of the arrangement as a *set*:
canonical roster and company ordering, no dependence on construction order or
on which action asked. That is condition one of the potential, pinned by
test.

Two influence terms live inside `OpportunityValue`, and they are the whole of
requirement 3:

- **General-influence headroom** — for the best MP-bearing character in hand
  whose mind exceeds `freeGeneralInfluence`, the arrangement is credited
  `potentialDiscount ×` his marginal-MP TSD when it fits him
  (`mind ≤ freeGeneralInfluence`). This is what stacking a follower buys. It
  is a function of `freeGeneralInfluence` alone, hence part of Φ.
- **The faction `checkP` term** is what un-stacking buys — and its *loss* is
  what "leave DI for the faction" costs. The reserve is priced, not
  hard-coded: stacking a follower under the best influencer while a faction
  plan is committed or a faction sits in hand drops `checkP` and prices
  negative, with no reservation rule anywhere.

### The shared opportunity enumeration

`resources.proposePlans` and `factions.proposePlans` each privately compute
(card × candidate site) → playability, net payoff and route probability, with
the site enumeration and harm netting duplicated between them. A third
consumer forces the extraction: `services/opportunities.ts`, exposing
`enumerateOpportunities(view, cardPool, standing, tunables)` and
`routeProbabilityFor(company, siteDefinitionId, reach, tunables)`. Both
proposers refactor onto it, and their proposals must stay byte-identical —
pinned by their existing tests plus a golden comparison. After the refactor
there is only one answer in the codebase to "what is this card worth at that
site", which is the point: the "resources to play for all" gate must not be a
second, private resource model.

## 4. Leading, trailing and hurry — with no posture tunable

All three enter through `E[W(tsd + X(arrangement), turn)]`:

- **Trailing** → `W` convex at the current standing (`core/risk.ts`:
  `λ = clamp(riskCurvatureScale · (1 − 2W))` positive) → an arrangement whose
  `X` carries more independent Bernoulli upside — two companies, two goals —
  scores a higher `E[W]` than a concentrated one of equal mean. The split is
  chosen *because the agent is behind*, with no branch saying so.
- **Leading** → concave → the certain harm reduction of the big company
  dominates the probabilistic upside. Safety first, emergent.
- **Turn urgency** → `W(tsd, turn)` is the fitted two-argument model, so the
  same deficit is a steeper, more convex position on turn 14 than on turn 4;
  lateness *is* hurriedness. Deadline pressure additionally enters through
  the goal list itself, because committed plans carry deadlines and are
  withdrawn or abandoned by the portfolio when overtaken.

The honest caveat, and the open question this spec carries: the mechanism
only works if the fitted `W` actually curves over the ±few-TSD range a
split's outcome spread spans. If `sweep --over risk` on the §8 scenarios
shows the mid-game curvature never flips a shape decision, the lever is the
existing `riskCurvatureScale` — it scales exactly this curvature and is
already sweepable. An if/else on "am I trailing" is not added under any
measured outcome.

## 5. Anti-oscillation analysis

**Why the naive design cycles.** Suppose the split's upside were expressed
the obvious way — score the *delta* distribution through `standing.score`.
A split has `E[Δ] ≈ 0` and `σ > 0`, so a trailing (convex) posture prices it
positive; the merge back is deterministic and prices about zero; the split
prices positive again. Jensen's inequality makes
`utility(change) + utility(undo) > 0` under convexity even when the TSD term
is a perfect potential — a strict cycle *created by the risk machinery
itself*. The current code is only safe because its single `p: 1` outcome
makes `W` monotone-through, and that safety is lost the moment variance is
added. This is why utility must be `u(after) − u(before)` of one number per
arrangement, never a scored delta.

**Why the new design is a potential.** `u` is a single-valued function of the
arrangement provided (1) `valueOf` is canonical — a function of the
arrangement as a set — and (2) both sides of every comparison read the same
position-fixed inputs: same typical attack, same goal list, same commitment,
same hand, guaranteed by `memoizeOnFirst` producing one `Organization` per
position. Then `utility(A→B) + utility(B→A) = 0` exactly, at every risk
posture, and any sequence of accepted organization actions strictly increases
`u` over a finite arrangement space. `expectedTsd` stays separately
antisymmetric (a difference of `−harm + opportunity` expectations), so the
existing merge-symmetry tests keep holding. The engine's `regress` flag and
the cycle guard remain backstops, not the fix.

**Tests that pin it**, modelled on the existing property tests in
`characters.test.ts` and `defence.test.ts`:

- *Undo is exactly free, at every posture*: for each shape action on the
  organization scenarios, `utility(change) + utility(undo) === 0` to 1e-9,
  evaluated at a leading standing, a trailing standing, and with
  `riskOverride` at ±0.8. The posture sweep is the new part — the old tests
  pinned only `expectedTsd`.
- *Whole-board invariance*: `valueOf` of a permuted arrangement (companies
  reordered, rosters reordered) equals the original.
- *One `Organization` per position*: the memo is hit once per view, mirroring
  the recompute-equals-cached invariant.
- *Stack/unstack is exactly free*: the same undo property for
  `move-to-influence` pairs.

## 6. No double counting with the plan layer

Two channels touch committed plans and they price disjoint things.
`plan-value` contributions fire only when an owner's `planStepDelta` returns
non-null; for shape actions that is solely the `characters` module's
`CARRIER_STEP` rule (the last untapped character stripped or spent). The
organization matching is deliberately **tapped-ness-blind** — a recorded
assumption — so the one overlap candidate is priced once, by `CARRIER_STEP`,
and the potential prices what `CARRIER_STEP` cannot see: reach geometry and
goal parallelism. `explain` printing both the assignments node and the
plan-contribution node is the audit.

Portfolio hysteresis is unaffected: proposer plan IDs are company-independent
(`resources/<card>@<site>`, `factions/<card>@<site>`), so a split does not
change any incumbent's identity, and commitment happens once per turn, so the
goal list is stable across every decision of an organization phase — the
potential cannot churn against a moving target within a turn.

## 7. "Resources to play for all", concretely

A split is credited only through the matching, and the matching is injective
over distinct goals. Goals exist only for cards that are real and playable:
positive MP, positive *marginal* payoff through `standing` (a capped source
drops out, per CoE 10.3), `resourcePlayableAt` a site in play or in the site
deck, net of the site's automatic attacks, reach-discounted. A spun-off
company with no distinct playable card behind it therefore adds exactly zero
opportunity while still moving the harm term — the gate the requirement asks
for falls out as arithmetic, with no counting rule to tune and no parallel
resource model to drift.

## 8. Changes per file

1. `core/plan.ts` — the `Commitment`, `DroppedPlan` and `DropReason` types
   move in from `services/portfolio.ts`, bodies unchanged.
2. `core/types.ts` — `ModuleContext` gains `readonly commitment?:
   Commitment`; absent for proposers and for tools that evaluate without a
   portfolio, and a reader must degrade to "no plans".
3. `services/portfolio.ts` — imports and re-exports the moved types.
4. `agent.ts` — `decide()` passes `{ ...moduleContext, commitment }` to
   `evaluateDecision` and `rankWithPlans`; proposers keep the bare context.
5. `services/opportunities.ts` (new) — the shared enumeration of §3, with
   `resources` and `factions` refactored onto it.
6. `services/organization.ts` (new) — goals, matching, `valueOf`, per §3.
7. `modules/characters/characters.ts` — `evaluateShape` builds the full
   before/after arrangements (untouched companies included: the matching is
   not additive per company; the harm part still cancels for them), prices
   `utility = u(after) − u(before)`, reports the after-distribution and the
   assignments in the rationale. `move-to-influence` branches on
   `controlledBy` and prices both directions as the same potential
   difference; `influenceUnlocked` is deleted, its faction pricing subsumed
   by the matching's `checkP` — now also applied when the faction is a
   committed plan, not just a card in hand. `ASSUMPTIONS` updated;
   `planStepDelta` unchanged.
8. `services/budget.ts` — one pure helper,
   `afterInfluenceMove(characterInstanceId, controlledBy)`, returning the
   hypothetical free general influence and per-character free DI. Control
   cost is taken as effective mind; the engine's control-cost overrides are
   not in the view, recorded rather than guessed.
9. `core/tunables.ts` — one new field, `organizationGoalCap` (shipped: 4),
   with the standard doc-comment treatment. No posture tunable and no
   urgency tunable, per §4. Every other constant used is existing and named
   in rationales: `potentialDiscount`, `planUnroutedReachProbability`, and
   the tempo costs inside `expectedHarm`.

## 9. Phasing

Every phase is an independently shippable PR; strength gates and full suites
run in review and branch CI, not during development.

| Phase | Content | Exit criterion |
|---|---|---|
| P1 | Commitment reaches the modules (files 1–4); this spec lands | No behaviour change: `architecture.test.ts` green, `explain` byte-identical on the scenario corpus |
| P2 | `services/opportunities.ts`; `resources`/`factions` refactored onto it | Existing proposer tests pass unchanged; golden test pins proposal identity |
| P3 | `services/organization.ts`; `evaluateShape` rewritten as the whole-board potential; `organizationGoalCap` | §5 property tests; scenarios `organization/leading-keeps-big-company`, `organization/trailing-split-two-goals`, `organization/trailing-split-no-second-goal` — split ranks first only in the middle one |
| P4 | `move-to-influence` both directions through the same potential; `afterInfluenceMove`; `influenceUnlocked` deleted | Updated `characters.test.ts` (engine-shaped actions with `controlledBy`; faction-in-hand stays positive; stacking credited when a GI-blocked MP character waits in hand; stacking below a committed faction's need prices negative); scenario `organization/reserve-di-for-faction` |
| P5 | Measure | `calibrate` on the shape decisions' claims; `sweep --over tunable:organizationGoalCap` and `--over risk`; split-taken rate conditioned on standing visible in the offered-versus-taken diagnostic; no scenario regressions; gate vs the champion in review |

## 10. Risks and open questions

- **The fitted curvature may be too shallow to flip decisions** (§4).
  Falsifiable at P5; the lever is `riskCurvatureScale`, not new code.
- **Performance.** `valueOf` runs per shape candidate and organization
  phases offer many. Mitigations: one `Organization` per view, the goal list
  computed once, per-roster harm cached by canonical roster signature — the
  same rosters recur across candidates. The bar is the ~170 decisions/sec
  the plan-layer spec records.
- **Evaluation-contract bend.** For shape actions, `utility` is a difference
  of two scored arrangements rather than `standing.score(outcomes).utility`
  of the reported distribution. Documented in the module doc and stated in
  the rationale; the alternative provably cycles (§5). Whether it deserves a
  `method: 'potential-difference'` label is a P3 review question.
- **Matching myopia.** One goal per company, tapped-ness-blind, top
  `organizationGoalCap` goals only — all recorded assumptions, each a
  falsifiable refinement later, none blocking.
- **`move-to-influence` legality nuances.** Control-cost overrides and
  control restrictions are engine-side; the pricer only prices actions the
  engine already offered, so the risk is mispricing exotic override cards,
  recorded rather than modelled.
