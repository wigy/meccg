# AI Training System Plan: Super-Strong Self-Play Player

## Context

We want to train a *super-strong* AI player for MECCG (beyond the existing
heuristic/rule-based AI in `packages/text-client/src/ai/`). This is a
self-play / search / reinforcement-learning problem, and which techniques are
viable is determined entirely by what the engine already gives us cheaply.

A codebase reconnaissance established that the engine is unusually well-suited
to this: most of the hard infrastructure prerequisites already exist. The plan
below is harness-first — it builds a reproducible, headless simulation and
evaluation substrate before any learning, then layers imitation, self-play RL,
and determinized search on top.

## What the codebase already gives us

- **Pure, deterministic simulator (biggest asset).** `reduce(state, action) ->
  ReducerResult` (`packages/shared/src/engine/reducer.ts:74`) is pure,
  synchronous, zero-I/O. Games can be stepped in-process at RAM speed with no
  WebSocket, no child processes. This makes real-simulator MCTS viable — we do
  **not** need a learned dynamics model (MuZero).
- **Total determinism.** All randomness flows through a seeded Mulberry32 PRNG
  threaded as `RngState` (seed+counter) in `packages/shared/src/rng.ts`. Same
  seed -> identical game. Enables reproducible paired-seed evaluation and
  treating dice/shuffles as explicit, re-seedable chance nodes.
- **Move generator already exists.** `computeLegalActions(state, playerId) ->
  EvaluatedAction[]` (`packages/shared/src/engine/legal-actions/index.ts:150`)
  returns `{action, viable, reason, actionId}`. `viable===true` is the legal
  mask; `actionId` is a stable key for visit-count targets. **Caveat:** the
  action space is a ~125-type discriminated union parameterized by instance IDs,
  with branching spiking to 100-200+ during movement-hazard creature keying
  (`legal-actions/movement-hazard.ts:1418-1469`). A fixed-width policy head is
  the wrong shape.
- **Clean hidden-information boundary.** `projectPlayerView(state, playerId)`
  (`packages/game-server/src/ws/projection.ts:300`) redacts opponent
  hand/deck/sideboard to `UNKNOWN_CARD`, with `revealedInstances`
  (`visibility.ts`) tracking what is public. This is the **only** thing an
  agent may observe. Never feed raw `GameState` to a net.
- **Heuristic AI already exists** with a clean `@meccg/shared`-only interface:
  `heuristicStrategy.weighActions(ctx: AiContext): WeightedAction[]`
  (`packages/text-client/src/ai/heuristic.ts:80`), where
  `AiContext = {view: PlayerView, cardPool, legalActions}`. No WebSocket
  coupling — safe to lift into a shared sim package. This is the free imitation
  teacher and the first non-trivial baseline.
- **Dense auxiliary reward for free.** Terminal reward is sparse and ternary
  (+1/0/-1) read from `GameOverPhaseState.winner/finalScores/winReason`, over
  **600-2000 decisions per player**. But `recomputeDerived`
  (`packages/shared/src/engine/recompute-derived.ts`) already maintains
  `MarshallingPointTotals` by category every action — a free dense
  shaping/auxiliary signal. Tournament scoring:
  `state-utils.ts:computeTournamentBreakdown`.
- **Deck space is large but factorable.** 643 certified cards (1683 total),
  decks validated by `deck-validation.ts` (60-100 card play deck, resource=hazard
  parity, unique limits, agent mind <=36). Fixed `data/decks/challenge-deck-*.json`
  decks let us remove deck variance from the RL inner loop entirely at first.

### What is NOT there

- No headless in-process game runner (only the WebSocket `game-session.ts`,
  one game/process, and test helpers).
- **No benchmark of games/sec — completely unmeasured. This gates everything.**
- No featurizer, no determinizer, no search, no trainer, no Elo harness.
- Self-play is not yet reproducible: `Math.random()` is used at three game-logic
  call sites (`text-client/src/ai/strategy.ts:49`, `strategy.ts:52`,
  `text-client/src/ai/evaluators/end-of-turn.ts:66`) and must be shimmed to
  seeded RNG.

## Core problem framing: why MECCG is hard

Four compounding difficulties determine the approach:

1. **Imperfect information** (hidden hands/decks/sideboards, face-down on-guard
   cards and agents). Rules in belief/determinization; rules out any approach
   needing the full state as input.
2. **Variable, combinatorially large action space** (~125 parameterized types,
   branching 1->200+). Rules out fixed-width policy heads; rules in an
   **action-conditioned policy** that scores each candidate from
   `computeLegalActions`.
3. **Very long episodes with sparse terminal reward.** Rules out cold-start RL
   from scratch; rules in imitation warm-start + MP-spread shaping + a leaf
   value net to truncate.
4. **A privately-constructed opponent deck.** The hidden "range" is over a deck
   the opponent *chose and ordered*, not a small common-knowledge universe like
   poker. This breaks whole-game CFR/ReBeL soundness, so CFR is **demoted** from
   backbone to an optional late-stage tactical tool (combat subgames only).

## Approach: Incremental Self-Play Ladder + AlphaZero-style search

Build Design 3 (the harness-first incremental ladder, the most feasible plan) as
the backbone, and graft in two codebase-specific strengths:

- an **action-conditioned policy head** (score-per-candidate over
  `computeLegalActions`, not a fixed 125-way head), and
- **determinizing IS-MCTS / PIMC** as the search layer, with MP-spread auxiliary
  value.

Keep CFR strictly as an **optional reserve** for combat/hazard subgames where
the hidden universe is small.

**Rejected backbones:** vanilla AlphaZero (assumes perfect information); MuZero
(unnecessary — we have a fast exact simulator); whole-game CFR/ReBeL (the
privately-constructed-deck range assumption is unsound).

**Honest ceiling:** PIMC suffers strategy fusion and non-locality — it cannot
natively represent bluffing on on-guard cards / hidden agent identity. Accept
this for v1 (it still reaches very strong play); mitigate by conditioning the
value net purely on the legal `PlayerView`; hold CFR-on-combat in reserve only
if PIMC measurably plateaus on bluff-heavy lines.

## Architecture

One system, built bottom-up. Each component names the engine API it wraps.

**Simulation & evaluation core (the de-risking backbone):**

- **`@meccg/sim` HeadlessGameRunner** — `playGame(agentA, agentB, seed) ->
  {winner, finalScores, winReason, trajectory}`. Wraps `createGameQuickStart`
  (`init.ts:635`) / `createGame` (`init.ts:134`) and `runFullSetup`
  (`test-helpers.ts`), loops `computeLegalActions` -> `projectPlayerView` ->
  agent -> `reduce` until `Phase.GameOver`. Holds full `GameState`, feeds each
  agent **only** its projected view.
- **Agent interface + baselines** — `act(view, legalActions, cardPool) ->
  GameAction`. Seeded `RandomAgent`, `HeuristicAgent` (lift `heuristicStrategy`),
  `PassMostlyAgent`. The learner is just another `Agent` behind this seam.
- **RNG-determinism shim** — replace the three `Math.random()` sites with engine
  `nextRng`/`nextInt`, threading a self-play RNG so games are bit-reproducible.
- **Tournament & Elo harness** — round-robin/Swiss over agent snapshots with
  **paired seeds + side-swap** (cancels luck variance), Glicko-2 ratings with
  confidence intervals, and a CI regression gate ("new agent must beat champion
  by N Elo"). The most important reusable asset; build it early.

**Representation (shared by imitation, RL, and search):**

- **State featurizer** — `projectPlayerView` -> scalar features (phase/step
  one-hot, MP-by-category, GI, deck-exhaust counts, hazard limit) + set/attention
  encoders over variable zones (hand, companies, characters+items, sites,
  on-guard). Never consumes raw `GameState`.
- **Action featurizer + masker** — encode each `EvaluatedAction` (type embedding
  + referenced instance/site/company features); `viable` is the mask. This is
  the fix for the 125-type / variable-branching problem.

**Learning:**

- **Policy + value network** — shared torso -> action-conditioned policy logits
  over the candidate set (softmax, native masking) + value head (win prob) +
  auxiliary MP-spread head (free labels from `recomputeDerived`). PyTorch,
  exported to ONNX for `onnxruntime-node` inference inside TS self-play.
- **Behavioral-cloning warm start** — train policy/value to imitate
  `HeuristicAgent` (optionally a low-volume LLM agent) so RL has a non-random
  start over the 600-2000-step horizon.
- **Masked PPO/REINFORCE self-play trainer** — terminal +-1 + normalized
  MP-spread shaping; league of frozen baselines as curriculum.

**Search:**

- **Determinizer** — given a `PlayerView` + searching playerId, sample a
  consistent full `GameState` by shuffling the opponent's hidden zones over known
  counts, honoring `revealedInstances`; re-seed `RngState`. Validate sampled
  states don't violate the no-card-disappears invariant.
- **Determinizing IS-MCTS / PUCT** — TS search over
  `reduce()`/`computeLegalActions`, net-guided priors, K determinizations at the
  root, explicit chance nodes via RNG advance, **auto-step forced single-action
  nodes** (most of the 600-2000 decisions are trivial), search budget scaled to
  branching factor.

**Outer loops:**

- **Deckbuilding meta** — evolutionary/bandit search over
  `deck-validation.ts`-valid decks, fitness = Elo of the frozen policy in the
  harness. Kept entirely outside the RL inner loop until the play policy is
  strong.
- **(Optional, reserve) CFR-on-combat** — Deep/tabular external-sampling CFR on
  `state.combat` subgames, with `cheatRollTotal` (`state.ts:175`) used to
  enumerate the 11 distinct 2d6 outcomes as weighted chance branches. Deploy
  only if PIMC plateaus on tactical/bluff lines.

## Phased roadmap

Front-loaded de-risking. Every phase ships a runnable artifact in this repo.

| Phase | Goal | Build | Success metric |
|---|---|---|---|
| **P0 Headless runner** | Prove full games run fast & terminate in-process | `@meccg/sim` `playGame(agentA,agentB,seed)`; seeded `RandomAgent`; throughput + decisions/game instrumentation | 1000 random-vs-random games reach `Phase.GameOver` with **zero engine errors**; **games/sec and decisions/game reported** |
| **P1 Baselines + determinism** | Swappable agents; reproducibility | Lift `heuristicStrategy` into `@meccg/sim`; RNG shim on the 3 `Math.random` sites | Heuristic beats Random **>70%** over 500 paired-seed games; identical `(seed)` -> identical replay |
| **P2 Elo ladder** | Make "stronger?" a gated number | Tournament harness, paired seeds + side-swap, Glicko-2 + CIs, CI regression gate | Elo stable with tight CI across reruns; gate blocks a deliberately-weakened agent |
| **P3 Featurizer + BC policy** | Learned action-scorer imitating strong play | State + action featurizers; action-conditioned net; behavioral cloning on heuristic trajectories; ONNX -> `onnxruntime-node` | Top-1 action match **>50%** on held-out states; BC agent Elo **>= heuristic** |
| **P4 Policy-gradient self-play** | Beat imitation via RL | Masked PPO/REINFORCE + value/MP-aux head; frozen-baseline league | RL agent beats best P3 baseline by **>=100 Elo** (paired-seed) |
| **P5 Determinizing IS-MCTS** | Lookahead under hidden info + chance | Determinizer + net-guided PUCT over `reduce()`; forced-node auto-skip; root chance re-seed | Search agent beats P4 policy-only **>60%** at a fixed per-move compute budget |
| **P6 Full AlphaZero loop** | Monotonic self-improvement | Self-play workers -> replay buffer -> trainer (masked policy CE to visit counts + value MSE + MP aux) -> gated promotion | **>=3 successive gated promotions** with rising Elo; latest beats P5 **>60%** |
| **P7 Deckbuilding meta** | Optimize decks around the strong policy | Evolutionary/bandit over `deck-validation`-valid decks, scored by frozen-policy Elo | Optimizer decks beat stock challenge decks **>60%** with the same policy |
| **P8 (reserve) CFR-on-combat** | Close the bluff gap — *only if needed* | Combat subgame extractor + external-sampling CFR, `cheatRollTotal` chance enumeration | Lower exploitability vs a best-response combat opponent than the P6 agent |

"Super-strong" = the P6->P7 agent: an AlphaZero policy+value net with determinized
search, on optimized decks, with a measured Elo gap over the heuristic and a clear
self-play improvement curve. P8 is the optional reach for true game-theoretic
tactical play.

## Hardest risks & de-risking

- **Simulator throughput is unmeasured and gates the entire plan.** If
  `computeLegalActions` on maximal states is slow, RL sample cost balloons.
  De-risk on day one (P0): benchmark games/sec and decisions/game *before*
  writing any learner. If <~50 games/sec/core, add a serialized fast-path and
  cache `computeLegalActions` per search node before committing to P4+.
- **Action-space explosion (100-200+ during creature keying).** De-risk: the
  action-conditioned scorer (P3) makes branching a runtime set-encode, not an
  architecture constant; in search, canonicalize candidates and auto-skip forced
  nodes.
- **`actionId`/keying-order non-determinism** would misalign visit-count targets.
  De-risk: canonicalize the action key (sort by definitionId + keying method) and
  add a round-trip test that `computeLegalActions` is idempotent on a corpus.
- **Reward sparsity over 600-2000 steps.** De-risk: BC warm-start so RL never
  starts at random; MP-spread auxiliary value + shaping from `recomputeDerived` —
  but cap shaping weight so the agent doesn't farm MP at the expense of the three
  real win paths (One Ring / scoring / double-exhaustion).
- **Determinizer producing illegal opponent hands.** De-risk: validate every
  sampled state by re-running `reduce` on a legal/no-op action and asserting
  `resolveInstanceId` succeeds for all minted instances; unit-test against known
  reveal sequences.
- **Chance handling.** All randomness is seeded: re-seed `RngState` per
  determinization to marginalize dice/shuffles; enumerate 2d6 exactly via
  `cheatRollTotal` where exactness matters (combat, corruption, win rolls).
- **TS-engine / Python-trainer feature drift.** De-risk: single shared featurizer
  spec with golden-vector tests run in both runtimes; ONNX inference checked
  against fixed states.
- **PIMC strategy-fusion ceiling.** Accept for v1; measure with held-out
  bluff-heavy tactical probes; only spend P8/CFR budget if the plateau is real.
- **Engine churn (active codebase).** De-risk: pin the harness to the three
  stable public APIs (`reduce`, `computeLegalActions`, `projectPlayerView`) and
  cover them with tests so the sim package doesn't rot.
- **Four asymmetric alignments + incomplete Balrog pool (0 certified).** De-risk:
  scope v1 to hero + minion (well-certified); treat per-alignment nets as a later
  multiplier, not a v1 requirement.

## Start here — first 5 steps, in order

1. **Create `@meccg/sim` with `playGame(agentA, agentB, seed)`** — wrap
   `createGameQuickStart`/`runFullSetup`, loop `computeLegalActions` ->
   `projectPlayerView` -> agent -> `reduce` until `Phase.GameOver`. Feed agents
   only the projected view. (`reducer.ts:74`, `legal-actions/index.ts:150`,
   `projection.ts:300`, `init.ts:635`.)
2. **Add a seeded `RandomAgent` + throughput benchmark.** Run 1000
   random-vs-random games; **report games/sec and decisions/game.** This single
   number validates or reshapes P4-P8. Confirm 100% terminate with no engine
   errors.
3. **Lift `heuristicStrategy` into `@meccg/sim` as `HeuristicAgent`** and fix
   reproducibility: replace `Math.random()` at `strategy.ts:49`, `strategy.ts:52`,
   and `evaluators/end-of-turn.ts:66` with seeded `nextRng`/`nextInt` from
   `rng.ts`.
4. **Build the paired-seed Elo/tournament harness** with side-swap and Glicko-2 +
   CIs. Gate target: heuristic beats random **>70%** over 500 paired-seed games,
   stable across reruns.
5. **Write the state + action featurizers** (`projectPlayerView` -> tensors with
   set-encoders; `EvaluatedAction` -> per-candidate vectors with `viable` mask)
   and an idempotence/round-trip test on `computeLegalActions`. This unblocks BC
   (P3) and is the load-bearing representation for everything after.

## Key files

- `packages/shared/src/engine/reducer.ts` — `reduce()` simulator core
- `packages/shared/src/engine/legal-actions/index.ts` — `computeLegalActions()`
- `packages/shared/src/engine/legal-actions/movement-hazard.ts` — creature-keying branching
- `packages/game-server/src/ws/projection.ts` — `projectPlayerView()` hidden-info boundary
- `packages/shared/src/rng.ts` — seeded Mulberry32 `RngState`
- `packages/shared/src/engine/recompute-derived.ts` — `MarshallingPointTotals` (shaping signal)
- `packages/shared/src/engine/init.ts` — `createGame` / `createGameQuickStart`
- `packages/shared/src/tests/test-helpers.ts` — `runFullSetup`
- `packages/text-client/src/ai/heuristic.ts` — `heuristicStrategy.weighActions` (imitation teacher)
- `packages/text-client/src/ai/strategy.ts`, `evaluators/end-of-turn.ts` — `Math.random()` sites to shim
- `packages/shared/src/deck-validation.ts` — deck constraints
- `data/decks/challenge-deck-*.json` — fixed decks for the RL inner loop
