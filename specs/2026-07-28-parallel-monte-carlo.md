# Parallel Monte-Carlo Rollout Agent

*Status: plan, 2026-07-28. Follows `specs/2026-07-27-monte-carlo-rollout-agent.md`,
which built the single-threaded agent. That agent is now promoted: it beats the
heuristic by **+152 Elo [+59, +273]** at 8 rollouts and **+352 [+228, +672]** at
16, and beats the strongest trained policy by **+149 [+39, +301]**. It is the
only search we have that turns extra budget into strength, which is what makes
parallelising it worth doing.*

## 1. Why parallelise

The measured budget response is the whole argument:

| rollouts | vs heuristic |
|---------:|:-------------|
| 2 | +196 [+96, +339] |
| 8 | +152 [+59, +273] |
| 16 | **+352 [+228, +672]** |

Determinizing PUCT, by contrast, gained nothing from 2.7× the simulations and
hung outright at high branching (`specs/…-monte-carlo-rollout-agent.md` §, and
the post-mortem in `packages/sim/src/search/puct.ts`). Flat rollouts scale, so
cores buy strength directly.

Two consumers want it, and they want opposite things:

- **Interactive play** (lobby `Play vs MC-AI`, currently
  `mc:ms=2000/turns=3/candidates=6`) is *latency-bound*: the 2 s budget is
  fixed and pleasant; parallelism should buy **more rollouts inside the same
  2 s**, i.e. a stronger opponent at unchanged pacing.
- **Batch evaluation and training-data generation** is *throughput-bound*:
  there, whole games already run in parallel via `SIM_JOBS`, so per-decision
  parallelism must not oversubscribe the box.

These pull in different directions and the design has to serve both without
each stealing the other's cores (§5).

## 2. What is actually parallel

`createMcAgent` (`packages/sim/src/agents/mc-agent.ts`) is a round-robin loop:

```text
for round r in 0..rounds-1:
    world_r  = determinizeNull(view, seed = base + r·φ)      # one world per round
    for candidate i in 0..n-1:
        state  = reduce(world_r.state, action_i)             # skip if illegal here
        result = rollout(state, seed = roundSeed ^ K)        # independent playout
        tally[i] += result.tsd
```

Every `(round, candidate)` playout is **pure and independent**: `reduce` is a
pure reducer, `rollout` takes its own seeded stream, and the only shared
mutable state is `tally`, which accumulates by summation.

That gives the two properties the parallel version needs:

1. **Order independence.** `tally[i]` is a sum, so any completion order yields
   the same result — no reduction-order caveat.
2. **Seed independence.** Each playout's seed derives from `(baseSeed, round)`,
   not from a shared cursor, so a playout computes the same value wherever it
   runs.

The unit of distribution should be **a whole round, not a single playout**.
Rounds are the unit of *common random numbers*: every candidate in a round is
compared on one shared world and one shared playout seed, which is where most
of this agent's sample efficiency comes from. Splitting a round across workers
is allowed by the maths but pointless — it multiplies messages while a round is
already `n_candidates` playouts of real work (each up to `maxDecisions` engine
steps, i.e. milliseconds).

## 3. Mechanism: a `worker_threads` pool

Node's `worker_threads`, not child processes: the payload is structured-cloned
rather than serialised through a pipe, and the engine is pure synchronous
TypeScript with no per-process global state to reinitialise beyond the card
pool.

**Pool lifetime.** One pool per agent instance, created lazily on the first
searched decision and reused for the whole game. Worker startup (module load +
`loadCardPool`) costs far more than a round, so it must never be per-decision.

**What crosses the boundary.** Per decision, broadcast once:

- the `PlayerView` (plain data — the projection already contains no functions),
- the shortlisted candidate actions,
- `baseSeed`, `horizonTurns`, `maxDecisions`, `unknownSites`.

Then per task, send only `{ roundStart, roundCount }`. Workers reply with a
`number[]` of per-candidate `{sum, count}` — a few dozen bytes.

**Never send the card pool.** It is ~1683 definitions; each worker calls
`loadCardPool()` itself at startup, exactly as `determinizeNull` already
defaults to. Sending it per decision would dominate the cost being optimised.

**Workers must disable engine logging** (`setEngineConsoleLog(false)`): 24
workers narrating rollouts would out-cost the search.

## 4. Determinism, which is the part to get right

Reproducibility is load-bearing here — `playGame` promises a bit-reproducible
game from `(seed, decks, agents)`, and the fuzz sweep depends on a failing seed
replaying. Two rules keep it:

1. **Budget in rounds, not wall-clock, whenever reproducibility matters.** A
   time budget makes the *number of completed rounds* depend on machine speed
   and scheduling, so two runs of the same seed can differ. The existing agent
   already has this property under `ms=…`; parallelism widens the window rather
   than creating the problem. Batch/eval runs must therefore use
   `rollouts=N`, never `ms=…`.
2. **When a time budget is used (interactive play), truncate at round
   granularity.** Never accept a partial round: dropping some candidates'
   samples from round *r* breaks the paired comparison that common random
   numbers exist to provide, and biases toward whichever candidates happened to
   finish. Workers must return whole rounds or nothing.

With those two rules the parallel agent returns *bit-identical* decisions to
the serial one for a given `rollouts=N` — which is the acceptance test in §7.

## 5. Core budgeting

The trap: `SIM_JOBS=10` games each spawning 24 rollout workers is 240 threads
on a 24-core box, and every measurement taken there becomes noise.

- New option `jobs` on `McAgentOptions`, surfaced in the spec string as
  `mc:jobs=8/…`, default **1 (serial)**. Parallelism is opt-in, so no existing
  benchmark silently changes its own timing.
- Env override `SIM_MC_JOBS`, consistent with `SIM_JOBS` / `SIM_SEARCH_*`.
- The lobby sets it explicitly for interactive play, where one game owns the
  machine: `mc:jobs=<cores-2>/ms=2000/turns=3/candidates=6`.
- Batch harnesses keep `jobs=1` and parallelise across games, which is already
  the more efficient axis (no per-decision fan-out overhead at all).

## 6. Expected gain, and where it stops

Wall-clock per decision is `rounds × n_candidates × rollout_cost`. With `W`
workers and rounds distributed evenly, the serial fraction is the shortlist
(one `computeLegalActions` plus a fallback ranking) and the per-decision
broadcast. Both are small next to `rounds × candidates` playouts, so speed-up
should be near-linear until `rounds < W` — at which point extra workers idle,
because a round is the indivisible unit.

Practical consequence for the lobby: at `ms=2000`, going from 1 to ~22 workers
should raise completed rounds by roughly an order of magnitude, which by the
table in §1 is worth well over +100 Elo. That is a bigger single step than any
training change measured so far.

Diminishing returns to watch for:

- **Rounds below worker count.** Prefer raising `rollouts` over adding workers.
- **Memory.** Each worker holds its own card pool; ~24 copies is fine on the
  64 GB training host, and should be measured before assuming it is fine on the
  dev server.
- **Horizon, not width.** More rounds reduce the *variance* of each candidate's
  mean; they do not extend the 3-turn horizon. If strength plateaus with
  rounds, the next lever is `turns`, not more cores.

## 7. Acceptance tests

1. **Equivalence.** For a fixed `rollouts=N`, `mc:jobs=1` and `mc:jobs=8` play
   an identical game from the same seed — same decisions, same final state.
   This is the test that proves the parallelism did not change what is being
   estimated.
2. **Speed-up.** Wall-clock per decision at `jobs=W` versus `jobs=1` on the
   24-core host, reported for W ∈ {1, 4, 8, 16, 22}.
3. **Strength.** Gate `mc:jobs=22/ms=2000/turns=3/candidates=6` against the
   current serial lobby spec over ≥60 games. The claim to test is that equal
   *wall-clock* with more cores is stronger — judged on win rate, per
   `feedback: training-objective-win-rate`.
4. **No regression under load.** `SIM_JOBS=10` with `jobs=1` must not change
   from today's numbers, confirming the default stayed serial.

## 8. Out of scope

- Parallelising the *fallback* path (combat, chain, pending): those decisions
  are delegated to the heuristic and never rollout.
- Tree search. The PUCT post-mortem stands; this plan deliberately scales the
  algorithm that measured well rather than revisiting the one that did not.
