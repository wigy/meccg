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

# Vary one number and watch a real decision change, or not
npm run sweep -w @meccg/sim -- --scenario <id> --over tunable:regionCrossingCost --from 0 --to 3
npm run sweep -w @meccg/sim -- --scenario <id> --over risk --steps 5

# Do a module's predictions survive three turns? (plan §6.4)
npm run horizon -w @meccg/sim -- --games 8

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

```text
HAND
    2.60  Orc-warband         would deny 5.2 against their largest company
    1.00  Doors of Night      no points and no attack to model — the flat price
    0.00  Anborn              mind 2 does not fit the 1 influence free
    0.00  Orc-lieutenant      their companies can beat it — worth nothing as an attack
```

That last section is §3.5's shadow price (`card-price`), which was blocked on
`hazards` until `denial` existed. It is what makes a discard a decision rather
than a coin flip, and the reason `hand` is the only module the horizon test can
see any signal from. Note the tension it prints rather than hides: the
Orc-lieutenant is worth nothing *alone*, while `hazards` ranks playing it at
+3.9% as the opener of a bundle the warband finishes. Both answer different
questions; the gap is real and declared.

`exposure` reports facts and stops there. H1 carries a `REGION_DANGER` table —
wilderness 2, shadow-land 4, dark-domain 5 — which is a valuation dressed as a
lookup, tuned by hand and invisible to anyone reading a destination score.
Here the regions crossed are reported; what crossing them is worth belongs to
`travel`, in TSD, in a rationale you can read.

### Hazard bundles

`hazards` is the one module that does not evaluate an action on its own terms,
because hazard play is not an action problem (plan §3.4). Value is
**supermodular**: the second creature meets a company the first one already
tapped, wounded or shortened, so scoring each card alone is how a hazard player
ends up dribbling one attack per turn into a company that shrugs each one off.
So a bundle is resolved as one *sequence* of attacks against a degrading roster
— `services/strike/sequence.ts`, the same enumeration `combat` uses from the
other side — and an action is scored by the best bundle that starts with it:

```text
RANKED (module hazards, partial — place-on-guard, play-hazard unscored)
  1. Play hazard Orc-warband against a company (keyed by region-type: wilderness)
     U = +4.60% win   E[Δtsd] +4.2  σ 0.3  (integrated)
  4. Pass (end your actions this phase)
     U = +0.00% win   E[Δtsd] +0.0  σ 0.0  (integrated)

  play Orc-lieutenant: 3.9%
  ├─ bundle: Orc-lieutenant + Orc-warband
  │  ├─ hazard limit: 5  [5 at reveal, 0 spent]
  │  ├─ resource plays they are believed to hold: 2.824  [29% confidence, 5 cards seen]
  │  ├─ worth denying one resource play: +2.0  {deniedPlayMp}
  │  │    [only the last 2.8 taps deny one — they hold fewer plays than the 5 standing]
  │  └─ planned to follow with: Orc-warband
  │       [scored as one sequence against a company that degrades between attacks]
```

Three things in that tree are the whole design. The objective is **denial, not
damage**: what a tap is worth is the resource play it forfeits, converted
through `standing`, so denying a source they have already capped is correctly
worth nothing. The denial is **marginal**: tapping two characters of five denies
nothing when they hold only two cards to play, and the belief model is what
supplies "two". And the kill marshalling points the defender collects for
beating the creature are **subtracted**, banked by the enumeration on exactly
the branch where every strike was defeated — which is what makes the module
refuse to attack a strong company, as it does at
`movement/hazard-bundle-choice` until the hazard limit and the company size
make it worth it.

Pricing a tap as `tapTempoCost` was the first attempt and it was badly wrong:
it valued a whole denied site phase at a third of a point against a kill-MP
gift of two, so the module concluded that no hazard in the game was ever worth
playing. `deniedPlayMp` is the number that fixed it, and it is a *quantity of
MP* rather than a price, so `standing` still decides what it is worth here.

Hazard **events** are declined — modelling Doors of Night means modelling its
effect — so the decision is reported as partly covered rather than guessed at.

That budget line about influence is the one to watch: `reducer-site.ts` requires the influencing
character to be **untapped**, so a company with none cannot attempt a faction
at all however much influence it holds — and free direct influence subtracts
what is already committed to followers, so a 5-DI character holding a mind-3
follower brings 2, not 5.

`heuristic` vs `h2` over six games: 96.7% agreement on contested decisions,
87.2% inside combat, ~14 divergences per game — and exactly 100% agreement
outside combat, which is the check that the Heuristics-1 fallback makes
`h2:<module>` a clean ablation rather than a rewrite.

Four modules are calibrated: `combat` (36 claims), `resources` (3),
`corruption` (2) and `factions` (1). Two kinds of claim are checked — dice
odds against a binomial interval, and *deterministic* marshalling-point
arithmetic against the engine's own totals, exactly rather than statistically.
The second is what would catch the doubling rule or the diversity cap being
subtly wrong, which no fixture written by the same hand as the module ever
would. `calibrate` is what makes an H2 module falsifiable. A module claims
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
| P2 services | `standing`, `budget`, `exposure`, `beliefs`, `character-value`, `card-price`, `denial`, `defence`, `strike/*` — printed by `explain` where they are spent |
| P3 acquisition | `factions` and `resources` written; the strategic half (which sources are worth chasing) is still missing |
| P4 | `corruption` and `health` written |
| P5–P7 | `characters` (incl. company shape), `hand` (with §3.5's real card price), `endgame` and `hazards` written; `allies`/`misc` not started |

### Coverage, measured

There is a CLI for this now, because it is the number that decides which module
to write next and guessing at it was how the table below went stale twice:

```sh
npm run coverage -w @meccg/sim -- --games 3
```

Over 1321 contested decisions:

```text
  covered and decisive        505  38.2%
  covered but flat            103   7.8%   → H1
  partial, acted anyway       155  11.7%
  partial, handed over        447  33.8%   → H1
  no owner at all             111   8.4%   → H1

  H2 decides 50.0% of contested decisions.
```

That is up from 33.1% at the start of the coverage work, and the three commits
that moved it were all found by running this rather than by reasoning about it:

- **`pass` was the largest single blocker by a factor of three** — 476
  decisions. Three modules own it inside their own windows and nobody owned it
  anywhere else, so a site phase offering four scored resource plays and one
  unscored `pass` went to Heuristics 1 entire. It is not a module: a utility is
  a change relative to doing nothing, and passing *is* doing nothing, so the
  zero is a definition and lives in `core/baseline.ts`.
- **`cancel-movement` and `declare-path`** (262 decisions) were already inside
  `travel`'s model — cancelling is the destination value with the sign flipped.
- **`split-company` and `merge-companies`** (191) turned out to have an exact
  half: the hazard limit *is* the company size, so shape decides how
  concentrated the harm can be. `services/defence.ts` computes it.

What is left, by decisions blocked: `activate-granted-action` 145,
`discard-character` 138, `place-on-guard` 129, `play-short-event` 128,
`play-hazard` 127, `assign-strike` 64. The last two are `hazards`'s own
declared gaps — events and non-creature on-guard cards — and closing them means
pricing card effects, which is the DSL's work rather than a module's.

### Does it win?

```sh
npm run headtohead -w @meccg/sim -- --games 4 --max-decisions 4000
```

```text
  game 1a: h2 -5 — 23 heuristic     game 1b: h2 16 — -5 heuristic
  game 2a: h2  5 — 10 heuristic     game 2b: h2 16 — -5 heuristic
  game 3a: h2 12 — -3 heuristic     game 3b: h2 17 —  8 heuristic
  game 4a: decision-limit after 4000 decisions — not counted
                                    game 4b: h2  6 — -5 heuristic

  h2 5 — 2 heuristic over 7 games (71.4% of the points available)
```

Seven games separate nothing but a landslide, and this is not one — treat it as
evidence that H2 plays a whole game without falling over, not as a verdict.
`gate` is the tool for a verdict; `headtohead` exists because it prints each
game as it finishes, and a run you can watch is worth more than a run you wait
on. One game in eight hit the decision limit, which is a pass-loop between the
two agents and worth chasing separately.

### Does any of it predict anything?

The horizon test (§6.4) correlates what a module predicted against what the
score actually did 1, 3 and 5 turns later. Two things had to be fixed before it
said anything at all:

- It correlated single *decisions*. Sixteen games put every module's
  correlation indistinguishable from zero out to n=2689 — which is what that
  measurement deserves, because one action among the hundreds taken in a turn
  cannot explain what the score did three turns later. It now aggregates a
  module's predictions **by turn**.
- It failed a module on the sign of a point estimate. Two six-game samples put
  the same module at +0.10 and -0.18. It now prints a 95% interval and fails a
  module only when the whole interval is negative.

With both fixed, over 16 games, exactly one module's interval clears zero:

```text
  hand    h1 +0.01 [-0.07, 0.09]   h3 +0.09 [0.02, 0.17]   h5 +0.13 [0.05, 0.20]
```

That is the module whose card price stopped being flat one commit earlier, and
it is the first evidence in this project that a module's predictions track
anything. Every other module spans zero in both directions — not a verdict
against them, but not support either. Treat their valuations as unverified.

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
