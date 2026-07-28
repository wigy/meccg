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
# Why would the AI do that? — the primary development tool (--help for flags)
npm run explain -w @meccg/sim -- --scenario combat/orc-ambush-3v1 [--risk +0.6] [--json]
npm run explain -w @meccg/sim -- --game <gameId> --seq 412 [--player p1] [--hash <h>]
# --state prints the board with the same `format-state` renderer the debug UI
# uses — as the acting player saw it, or `--state full` for the omniscient one
npm run explain -w @meccg/sim -- --scenario combat/creature-with-body --state

# The fixed sample set: named positions modules are tested and explained against
npm run scenarios -w @meccg/sim -- list [--module combat]
npm run scenarios -w @meccg/sim -- capture --game <id> --seq 412 --as combat/orc-ambush-3v1
npm run scenarios -w @meccg/sim -- capture --seed 7 --at 'turn=14,phase=movement-hazard' --as x/y
npm run scenarios -w @meccg/sim -- verify

# Refit W(tsd, turn) from self-play; reports Brier and a reliability diagram
# on held-out *games* (never held-out decisions — see ai-training-system §9)
npm run fit-winprob -w @meccg/sim -- --games 400 [--holdout 0.25] [--out path]

# Check a module's claimed probabilities against the real reducer
npm run calibrate -w @meccg/sim -- [--module combat] [--rollouts 5000] [--scenario <id>]

# How often do two agents actually choose differently, and where?
npm run compare -w @meccg/sim -- --agents heuristic,h2 [--games 6]
npm run compare -w @meccg/sim -- --scenarios --agents heuristic,h2
```

Run `compare` **before** paying for a gate. It answers in seconds what a gate
answers in hours: whether there is any behavioural difference to measure. One
agent drives while the other is polled in its shadow at every decision, both
read at their argmax — the sampling temperature belongs to the harness, not to
the opinion. Forced decisions are reported separately because agreement is
free where there is one legal action, and that is 53% of them.

### Services

Modules never call each other — a number one module owns reaches another as a
typed service on `ModuleContext` (plan §4), so there is one answer per position
instead of two private guesses that disagree. `standing` (TSD now, the marginal
value of +1 MP in each source, the risk posture) and `budget` (free general
influence, per-character free direct influence, mind costs, taps available) and `exposure` (site path, regions
crossed, hazard limit, opponent hand size) are built; all three print in
`explain` above the ranking, because a constraint is as
much a part of "why" as the score is:

```text
BUDGET
  general influence  3 free of 20 — the mind a new character must fit inside
  taps available     3
  company-p1-0: 3 untapped, best influence 1 free (Peath)
  company-p1-1: 0 untapped, no untapped character — no influence attempt possible
```

```text
EXPOSURE
  opponent hand      8 cards (17 discarded) — the ceiling on what they can spend
  company-p2-0: Rivendell → Carn Dûm (dark-hold), crossing wilderness → shadow
      hazard limit 0 (snapshot taken at movement reveal)
```

`exposure` reports facts and stops there. H1 carries a `REGION_DANGER` table —
wilderness 2, shadow-land 4, dark-domain 5 — which is a valuation dressed as a
lookup, tuned by hand and invisible to anyone reading a destination score.
Here the regions crossed are reported; what crossing them is worth belongs to
`travel`, in TSD, in a rationale you can read.

That budget line about influence is the one to watch: `reducer-site.ts` requires the influencing
character to be **untapped**, so a company with none cannot attempt a faction
at all however much influence it holds — and free direct influence subtracts
what is already committed to followers, so a 5-DI character holding a mind-3
follower brings 2, not 5.

`heuristic` vs `h2` over six games: 96.7% agreement on contested decisions,
87.2% inside combat, ~14 divergences per game — and exactly 100% agreement
outside combat, which is the check that the Heuristics-1 fallback makes
`h2:<module>` a clean ablation rather than a rewrite.

`calibrate` is what makes an H2 module falsifiable. A module claims
`P(wounded) = 2.31%`; the harness replays the same action thousands of times
through the engine, classifies the outcome from the engine's own record, and
fails if the observed frequency falls outside a 99% binomial interval. It
drives the continuation the module *assumes* — the character taps to fight
after a support tap, the attacker plays nothing into the defence — so the
assumption is measured rather than merely declared, and a rollout it cannot
drive is reported as unmeasured rather than bucketed.

The agent takes a module selector, which is what makes per-module ablation
gates possible — decisions no enabled module claims fall through to
Heuristics 1 unchanged:

```sh
npm run gate -w @meccg/sim -- --challenger h2:combat --champion heuristic --games 400
npm run gate -w @meccg/sim -- --challenger h2:combat,kill --champion h2:combat --games 400
```

The fitted `W` is also available as the leaf evaluator for the determinizing
PUCT search, which is the experiment `docs/ai-training-system.md` §11 names as
the immediate one — §8 records that search only ties the bare policy, and §9
that the value head is at chance through the middle game where every leaf of a
mid-game search lands:

```sh
npm run gate -w @meccg/sim -- --challenger search-h2:weights.json@192   --champion search:weights.json@192 --games 200
```

`search-h2` keeps the net's move priors and replaces its value head with
`W(tsd, turn)`. This is the same idea as the `mpWeight` knob that was measured
harmful — with the three defects that made it fail removed: that one is an
unfitted `tanh(spread / 6)` with a guessed scale, no turn term, and no notion
that a point means less once a game is decided, so it valued an early
six-point spread as decisively as a late one. **Not yet run** — the gate is
the point of it.

Status by phase:

| Phase | State |
|---|---|
| P0 core | shipped — TSD, dice, rationale, tunables, risk oracle, registry, fitted `W`, scenario store, CLIs |
| P1 `combat` | shipped and calibrated 36/36 against the reducer — strike window, attack window, sequential resolution |
| P2 services | `standing`, `budget`, `exposure` shipped and printed by `explain`; `travel` written |
| P3 acquisition | `factions` and `resources` written; `character-value` service shipped and consumed by `combat` |
| P4 | `corruption` written; `health` not started |
| P5–P7 | not started — `allies`/`characters`/`misc`, `hazards`/`hand`, `endgame` |

### Coverage, measured

Over four self-play games (3524 decisions, 1626 contested), the action types
appearing in contested decisions are led by:

```text
 1154  pass                314  discard-card         190  cancel-movement
  189  play-hazard         178  split-company        178  activate-granted-action
  171  play-short-event    159  move-to-influence    157  draw-cards
  154  plan-movement       142  discard-character    142  transfer-item
```

`activate-granted-action` is in 10.9% of contested decisions — real, but not
the blocker it first looked like from a single scenario. The long tail is:
`split-company`, `merge-companies`, `cancel-movement`, `discard-card`,
`draw-cards`, `discard-character`, `play-short-event`, `play-hazard` all have
no owner. Full coverage is a longer road than eight modules suggests, and
chasing it action type by action type is not obviously the right route —
whether dispatch should stay all-or-nothing is worth re-arguing on this
evidence rather than on the one scenario that prompted the rule.

**Only `combat` has been observed running.** Dispatch requires the module set
to cover every candidate on a decision (see `core/registry.ts`), and the
organization and site phases each still offer action types with no owner —
`transfer-item`, `move-to-influence`, `activate-granted-action`, the sideboard
actions. Until those have owners, `travel`, `factions`, `resources` and
`corruption` are unit-tested against synthetic inputs but never fire in a real
game, and no scenario in the corpus exercises them. Treat their valuations as
unverified.

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
