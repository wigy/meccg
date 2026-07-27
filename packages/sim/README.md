# @meccg/sim — Headless Simulation Harness

In-process self-play harness for the MECCG engine, built for AI training and
evaluation (see `specs/2026-06-29-ai-training-system-plan.md`, phases P0–P1).
Games run at RAM speed with no WebSocket or child processes: the runner loops
`projectPlayerView` → agent → `reduce` until game over. Agents only ever see
their own projected `PlayerView` — hidden information stays hidden.

Given the same `(seed, decks, agents)` a game is **bit-reproducible**: all
engine randomness flows through the seeded `RngState`, and each agent draws
from its own seeded stream.

## CLIs

```sh
# Throughput + statistics benchmark (the P0 gate)
npm run bench -w @meccg/sim -- --games 1000 --seed 20000 \
  [--agents random,random] [--decks challenge-deck-a,challenge-deck-b] \
  [--max-decisions N] [--out stats.json]

# Play games with a live decision transcript; optionally record replays
npm run play -w @meccg/sim -- --agents heuristic,heuristic --seed 7 \
  [--games N] [--replay-dir DIR] [--quiet] [--no-candidates] [--max-candidates N]

# Play back a saved replay as a text transcript; verify by re-simulation
npm run replay -w @meccg/sim -- path/to/replay.jsonl [--verify] [--steps] [--quiet]
```

Available agents: `random` (uniform over viable actions), `heuristic` (the
"Smart-AI" strategy, lifted from the text client into `src/ai/`), `h2`
(Heuristics 2, see below), `bc` and `search` (learned policies).

## Heuristics 2

`src/ai/h2/` implements the modular, probabilistic, explainable AI of
`specs/2026-07-27-heuristics-2-ai.md`. Where Heuristics 1 returns unitless
per-phase weights, an H2 module answers every candidate action with an
**outcome distribution** — enumerated outcomes carrying tournament-score
differentials (TSD) — which the risk oracle converts into a change in win
probability by integrating the fitted curve `W(tsd, turn)`. Risk attitude is
emergent from that curvature rather than tuned: a trailing player sits on the
convex limb of `W`, so variance raises `E[W]` and the gamble wins on its own.

Every number is traceable. Any constant that is not read from card data, the
view or a probability table lives in `core/tunables.ts` and must be named in
the `Rationale` tree the module returns beside its number.

```sh
# Why would the AI do that? — the primary development tool
npm run explain -w @meccg/sim -- --scenario combat/orc-ambush-3v1 [--risk +0.6] [--json]
npm run explain -w @meccg/sim -- --game <gameId> --seq 412 [--player p1] [--hash <h>]

# The fixed sample set: named positions modules are tested and explained against
npm run scenarios -w @meccg/sim -- list [--module combat]
npm run scenarios -w @meccg/sim -- capture --game <id> --seq 412 --as combat/orc-ambush-3v1
npm run scenarios -w @meccg/sim -- capture --seed 7 --at 'turn=14,phase=movement-hazard' --as x/y
npm run scenarios -w @meccg/sim -- verify

# Refit W(tsd, turn) from self-play; reports Brier and a reliability diagram
# on held-out *games* (never held-out decisions — see ai-training-system §9)
npm run fit-winprob -w @meccg/sim -- --games 400 [--holdout 0.25] [--out path]
```

The agent takes a module selector, which is what makes per-module ablation
gates possible — decisions no enabled module claims fall through to
Heuristics 1 unchanged:

```sh
npm run gate -w @meccg/sim -- --challenger h2:combat --champion heuristic --games 400
npm run gate -w @meccg/sim -- --challenger h2:combat,kill --champion h2:combat --games 400
```

Status: **P0 shipped** — core (TSD, dice, rationale, tunables, risk oracle,
registry), the `standing` service, the fitted `W`, the scenario store and the
`explain` / `scenarios` / `fit-winprob` CLIs. No evaluation module has shipped
yet, so `h2` currently plays every decision through the Heuristics-1 fallback;
`combat` is P1.

## Replay format

A replay is a JSONL file (`ReplayRecord` per line):

1. `header` — format version, timestamp, seed, both players (name, agent,
   deck ID, alignment), decision cap. Seed + deck IDs make the game
   reproducible from the header alone.
2. `decision` (interleaved with `transition`) — one per agent decision:
   turn/phase/step, acting player and agent, the full weighted candidate
   list (action type, canonical `actionId`, weight, and human-readable
   description for the top candidates), the chosen action verbatim, the
   engine effects it produced (dice rolls, notifications), and think time.
3. `transition` — emitted on every phase/step/turn change with a public
   score snapshot (tournament scores + raw marshalling-point totals), so
   score progression can be charted without re-simulating.
4. `result` — outcome, winner, win reason, final scores, and the per-game
   statistics summary.

`--verify` re-creates the game from the header and re-applies every recorded
action, checking `stateSeq`/turn/phase at each step and the final winner —
proof that the replay is an authentic record of a legal game.

## Statistics

Every game produces a `GameStatsSummary` (embedded in the `result` record and
in `--out` files): decisions and turns, per-phase and per-player decision
counts, chosen-action-type histogram, branching-factor distribution
(min/mean/percentiles + bucketed histogram), dice-roll totals, effect counts,
agent think time, and the score-by-turn trajectory. `aggregateStats` folds
game summaries into batch-level numbers: games/sec, decisions/sec, outcome
and win-reason counts, wins by seat, and distributions across games.

These numbers are the reference dataset for the training plan — archive
`--out` files to compare engine versions and agent generations.

## Library surface

```ts
import {
  playGame,                      // run one game headless
  createRandomAgent, createHeuristicAgent,
  loadDeck, listDecks,           // data/decks catalog
  ReplayWriter, readReplay, verifyReplay,
  StatsCollector, aggregateStats,
  TranscriptPrinter,             // live text transcript observer
} from '@meccg/sim';

const run = playGame({
  agents: [createHeuristicAgent(), createHeuristicAgent()],
  decks: [loadDeck('challenge-deck-a'), loadDeck('challenge-deck-b')],
  seed: 42,
  observers: [new TranscriptPrinter()],
});
```

Custom agents implement the `Agent` interface: `chooseAction(context)` gets
the projected view, the viable actions, the full evaluated candidate list,
and a seeded `random` stream, and returns the chosen action plus (optionally)
the weighted candidates it considered — which flow into transcripts, replays,
and future training data.
