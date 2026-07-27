# Flat Monte-Carlo Rollout Agent: Assessment and Salvage Plan

*Status: assessment + plan, 2026-07-27. Evaluates a proposed flat Monte-Carlo
agent against what already exists (`packages/sim/src/search/`, H1 in
`packages/sim/src/ai/`, and `specs/2026-07-27-heuristics-2-ai.md`). Verdict:
**the decision rule is not viable as specified; two of its four components are
worth building anyway**, and they are prerequisites for work already planned.*

## 1. The proposal

1. Quick transform from `PlayerView` to `GameState`, leaving unknown cards
   unknown.
2. When computing legal actions, an unknown card has exactly one function: it
   can be placed on-guard and returns to hand at end of turn. Otherwise it is
   unplayable.
3. From a state, pick a uniformly random legal action, reduce, repeat for a
   horizon of 2–4 turns.
4. Record the root action and the terminal tournament-score differential
   (including doublings).
5. Play the root action with the best average differential per random walk.

This is the **flat Monte-Carlo / rollout algorithm** with null determinization —
a real, well-studied algorithm, not an invention. Three of its design choices
are correct and match conclusions the repo has already reached independently:

- **The real reducer as the forward model.** No second model to keep in sync
  with 700+ card implementations. This is already how `search/puct.ts` works and
  it is the right call.
- **`computeTournamentScore` rather than raw MP.** Marginal MP is not linear —
  a point is worth 2, 1, or 0 depending on doublings and the half-total cap
  (CoE §10.3). Scoring hypothetical totals through the engine's own scorer gets
  this for free. `specs/2026-07-27-heuristics-2-ai.md` §2.1 reaches the same
  conclusion and calls the quantity TSD.
- **Decklist-free hidden-state handling.** `search/determinize.ts` samples
  hidden cards from the owner's *known deck list* ("challenge decks are public
  in tournament play"). That assumption fails for lobby play against a human
  with an unknown deck. Step 1 fills a real gap.

## 2. Why the decision rule does not work as specified

### 2.1 The cost, measured

`npm run bench -w @meccg/sim -- --games 2 --seed 1` on this machine:

| Quantity | Measured |
|---|---|
| Engine throughput | **776 decisions/sec** (1.29 ms per decision) |
| Decisions per game | 2100 mean |
| Turns per game | 50.5 |
| Decisions per turn (both players) | **~42** |
| Forced decisions (branching = 1) | **54%** (2284 / 4199) |
| Decisions in movement-hazard phase | **44%** (1832 / 4199) |
| Mean branching | 7.76 (max observed 640) |

Therefore:

```text
2-turn rollout ≈  84 decisions ≈ 108 ms
4-turn rollout ≈ 168 decisions ≈ 216 ms
```

Against ~8 candidate actions at a modest 100 samples each — 800 rollouts —
one decision costs **86 seconds** at a 2-turn horizon.

Inverting it gives the honest requirement. To afford 100 samples per candidate
inside a 2-second live budget you need 400 rollouts/sec × 84 decisions =
**33,600 decisions/sec, or 43× the current engine**. Within an actual 2-second
budget today you get **~18 rollouts total** — barely two per candidate.

For self-play the arithmetic is worse: search only the 46% contested decisions
and a single game costs ~23 hours. A promotion gate is 400 games.

The 43× is not reachable by tuning. It needs a stripped forward model, which is
a far larger project than the agent itself and reintroduces the sync problem the
real-reducer choice correctly avoided.

### 2.2 The signal, in the samples you can afford

MP move at discrete scoring moments — an influence check resolving, an item
played at its site, a creature defeated. Over two turns of *uniformly random*
play, most rollouts produce Δ = 0 for both sides, and the estimator becomes a
rare-event estimator whose variance is dominated by the handful of rollouts that
happened to score. This pushes the required sample count in the wrong direction
at exactly the moment §2.1 says you cannot afford it.

### 2.3 A random rollout policy cannot execute MECCG's plans

Flat MC works when random playouts preserve the *relative ordering* of
positions. MECCG converts resources through mandatory multi-step sequences: move
company → survive the hazards → arrive at a site with the matching requirement →
tap the right character → play the item. A uniform policy over a mean branching
factor of 7.76 (max 640) essentially never completes such a sequence
intentionally.

The consequence is structural, not statistical. Flat MC estimates *"the value of
this action given that I play randomly afterwards"*, which systematically
undervalues every action whose payoff needs competent follow-up — which in this
game is nearly all of them. More rollouts do not fix it; they converge to a
biased number.

### 2.4 The terminal evaluator is a documented negative result

`docs/ai-training-system.md` §10, verbatim: *"Blending the score differential
into search leaf values is harmful… at weight 0.5 search fell to 2 wins in 12
games. Maximising immediate score spread is greedy in a game where marshalling
points are bought with corruption risk and capped by the doubling rule."*

Step 4 uses the score differential as the *sole* terminal value. That is the
measured failure at weight 1.0. The mitigation is known and already specified —
`specs/2026-07-27-heuristics-2-ai.md` §2.1 (convert TSD through an empirical
win-probability curve `W`) and §2.3 (decompose into realized + discounted
potential − tempo). Either is cheap to adopt; using neither repeats the
experiment.

### 2.5 The inert-opponent assumption is asymmetric, in the worst phase

Step 2 makes unknown cards unplayable. Our own hand is fully visible to us, so
in every rollout **we** play cards freely while the **opponent** cannot play
any. That is not a neutral approximation, it is a systematically optimistic
opponent model, and 44% of all decisions live in the movement-hazard phase —
precisely where the opponent's hidden hand acts. Rollouts will report that
journeys are safe, cancels never come, and combats go our way, biasing the agent
toward exactly the reckless travel it exists to avoid.

Two cheap fixes, either acceptable:

- **Symmetrize**: blind our own hand in rollouts too (root action excepted).
  Preserves the decklist-free property; loses tactical realism on both sides.
- **Sample the opponent's hidden cards** from a prior — the known deck list via
  the existing `determinize.ts` when available, otherwise an alignment-filtered
  pool. Strictly more informative, and the delta between the two *is* a
  publishable measurement (what is decklist knowledge worth?).

### 2.6 Step 1 has an engine-tolerance problem

`UNKNOWN_CARD` is `did('unknown-card')`, a synthetic id from `card-ids.ts` that
is **not in the card pool** — `loadCardPool()` builds only from `allCards`. A
`GameState` carrying instances with that definition will hit `undefined`
definition lookups in `recompute-derived.ts`, effect dispatch, and the cost
evaluator. Step 1 is not a "quick transform"; it needs a synthetic inert
`CardDefinition` plus a test that the reducer and `computeLegalActions` survive
a full game with unknown cards present on both sides.

## 3. What is worth building

Two components are independently valuable, and one of them is *already required*
by an approved plan. Recommendation: build these, and use them to settle the
agent question with data rather than argument.

### 3.1 `search/rollout.ts` — the playout harness (build regardless)

A seeded playout harness with a pluggable policy, horizon, and terminal
evaluator:

```ts
interface RolloutOptions {
  readonly state: GameState;
  readonly policy: (ctx: AgentContext) => GameAction;  // random | H1 | H2 | net
  readonly horizon: { turns: number } | { decisions: number };
  readonly terminal: (state: GameState, player: PlayerId) => number;  // TSD | W(TSD)
  readonly seed: number;
}
```

This is not optional work. `specs/2026-07-27-heuristics-2-ai.md` §6.2 makes
calibration testing a **ship gate** for every H2 module, and defines it as
"takes the scenario's `GameState`, runs N seeded rollouts through the real
reducer". That harness does not exist yet. Building it here serves H2 P0/P1
directly, whatever happens to the agent.

It must reuse the existing cycle guard (`state-signature.ts`) — `docs/ai-training-system.md`
§10 records two agents burning a 25,000-decision budget inside turn 1 on a
costless no-op loop (*I'll Report You*). A uniform random walk hits this too.

### 3.2 `determinizeNull` — decklist-free determinization

Steps 1 and 2, built properly: a synthetic inert card definition, unknown cards
restricted to on-guard placement, and the reducer-tolerance test from §2.6.
Value beyond this proposal:

- unblocks any search agent in the lobby against hidden-decklist opponents,
  which `determinize.ts` explicitly cannot serve;
- gives the ablation that measures what decklist knowledge is worth
  (`determinize` vs `determinizeNull` at matched budget);
- H2's `exposure` belief model (§3.6 of that spec) needs a null baseline to beat.

### 3.3 `mc` agent — build it, but parameterized, and expect the first config to lose

Once §3.1 and §3.2 exist the agent is a thin wrapper, so build it — as a
*configurable family*, not the single configuration proposed:

```sh
mc:random@2t/800      # the proposal as stated — the control
mc:h1@2t/64           # H1 as rollout policy, raw TSD terminal
mc:h1@2t/64+winprob   # H1 policy, W(TSD) terminal  <- the one with a chance
```

`mc:h1@...` is the version worth betting on: replacing the uniform rollout
policy with H1 addresses §2.3 (playouts execute coherent plans), and cuts the
sample requirement by orders of magnitude because the estimator's variance
collapses. `+winprob` addresses §2.4. Both are small changes on top of the same
harness, which is the argument for building the harness parameterized from the
start.

Three variance reductions are cheap and material, and should be in v1:

- **Common random numbers.** Evaluate every candidate against the *same* set of
  rollout seeds. Paired comparison removes most of the between-candidate noise
  and is worth more than doubling the budget.
- **Successive rejection** instead of uniform allocation. Drop obviously bad
  candidates after a first cheap round; spend the remaining budget separating
  the top few. Uniform allocation over 8 candidates wastes most of an already
  fatal budget.
- **Skip forced decisions.** 54% of decisions have one legal action. Free.

On the proposal's own open question — "average or mean" are the same statistic;
the real choice is mean vs. median vs. max. Use the **mean with paired seeds**:
max is optimistically biased by lucky rollouts, and median discards the tail
information that makes risk posture emergent (H2 §2.1).

## 4. What was built

Implemented and shipped; the signal study (originally proposed as a gate before
writing any agent) was dropped at the author's direction in favour of a working
agent to play against.

| Module | Contents |
|---|---|
| `packages/sim/src/search/determinize-null.ts` | Deck-list-free determinizer. Hidden cards keep their instance id and an injected inert stand-in definition; **sites are the exception** and are sampled from the pool by alignment, because an unplayable site deck freezes the opponent's companies for the whole playout (`unknownSites: 'inert'` restores the literal behaviour). |
| `packages/sim/src/search/rollout.ts` | Seeded playouts over the real reducer: horizon in turns, pluggable policy, TSD terminal via `computeTournamentScore`, cycle guard, decision cap. |
| `packages/sim/src/agents/mc-agent.ts` | The agent. Round-robin allocation, common random numbers, candidate cap, heuristic fallback on views the determinizer cannot widen. |
| `packages/sim/src/cli/common.ts` | `mc` registered in the agent registry. |
| `packages/text-client/src/ai-client.ts` | `--agent <spec>` so any registry agent can play a real lobby game. |
| `packages/lobby-server/src/games/launcher.ts` | `MECCG_AI_AGENT` env var selects the agent for lobby AI games. |

### 4.1 Two things the build changed about the design

**The candidate cap is not optional.** The first full-game attempt did not
finish in 15 minutes at `rollouts=2, turns=1`. The cause is §2.1's branching
factor: work per decision is `candidates × rollouts × playout length`, and this
run observed a maximum branching of 1027. Candidates are now capped (default 8)
and ranked by the fallback heuristic's own weights, with its pick always
retained — so the cap acts as a prior and the search refines a competent
shortlist rather than an arbitrary prefix. With `candidates=4` a full game
completes in **178.9 s (10 decisions/sec, 1702 decisions)**.

**Exact candidate preservation does not hold, and cannot.** `determinize.ts`
asserts that re-projecting a sampled world reproduces the searcher's candidate
list exactly. That property depends on knowing the searcher's *own* deck list,
so this determinizer cannot have it: actions the engine offers from the own play
deck have no counterpart in a world where that deck is sentinels. Measured over
five seeded games: 180/200 candidate lists matched exactly, and 934/936
individual candidates still applied. The agent absorbs the rest by skipping any
candidate a given world rejects, and the test asserts the ≥98% applicability
rather than a false exactness claim.

## 5. Relationship to existing work

- **`search/puct.ts`** already does tree search over K determinized worlds with
  net priors and leaf values, and measures **50.5%, +3 Elo [−61, +69]** against
  the policy at 192 simulations. Flat MC is strictly weaker than PUCT at equal
  budget (no tree, no priors, no selective deepening), so a flat-MC agent that
  beat H1 would be a surprising result — worth knowing, but it should be planned
  for as a measurement, not a shipping agent.
- **`specs/2026-07-27-heuristics-2-ai.md`** attacks the same target from the
  other side: closed-form probability models instead of sampling. Where H2 can
  compute a distribution exactly (2d6 vs prowess, influence checks), sampling it
  through the reducer is pure loss. The two are complementary in a specific way
  — **H2 supplies what this proposal is missing** (`W` for the terminal
  evaluator, TSD decomposition against greed) and **this proposal supplies what
  H2 requires** (the §6.2 calibration harness). That mutual dependency is the
  strongest reason to build R0 and R1.
- **`docs/ai-training-system.md`** §8–§11 holds the measured history: forced
  decisions, the value-head failure, the greed result, the no-op loop. Every one
  of them bears on this design.

## 6. How to run it

```sh
# Self-play, one game (~3 minutes at this budget)
npm run bench -w @meccg/sim -- --games 1 --agents 'mc:rollouts=2/turns=1/candidates=4',heuristic

# Rated match against the heuristic
npm run gate -w @meccg/sim -- --challenger 'mc:rollouts=4/turns=2' --champion heuristic --games 50

# Play it in the lobby (any AI game then uses this agent)
MECCG_AI_AGENT='mc:ms=2000/turns=2' npm run dev -w @meccg/lobby-server
```

Parameters are `key=value` separated by `/` — `,` is taken by `--agents`:
`rollouts`, `turns`, `candidates`, `decisions`, `ms`, `sites`, `fallback`.
Setting `ms` bounds the wall-clock per decision, which is what makes
interactive play comfortable, at the cost of reproducibility from a seed.

## 7. Bottom line

It is built and it plays. The strength question is open and is not settled by
the one self-play game run here (mc won it) — that needs `gate`.

The §2 objections stand and are not fixed by the implementation: the rollout
policy is still uniform-random and cannot execute this game's multi-step scoring
sequences (§2.3), the terminal value is still raw TSD, which §2.4 records as
measured-harmful, and the opponent's hand is still inert in the phase holding
most decisions (§2.5). The candidate cap partly disguises the third problem by
leaning on the heuristic's shortlist.

The upgrade path is unchanged and is now cheap, because the seams exist:
`RolloutOptions.policy` already accepts a non-random policy, so passing the
heuristic there is a one-line change, and swapping the TSD terminal for
`W(TSD)` from `specs/2026-07-27-heuristics-2-ai.md` §2.1 is another. Those two
substitutions are the configuration with a plausible path to beating H1.
