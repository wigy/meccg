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
(Heuristics 2, see below), `mc` (flat Monte-Carlo rollouts over the real
reducer, see below), `bc` and `search` (learned policies).

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
npm run calibrate -w @meccg/sim -- [--module combat,grants] [--rollouts 5000] [--scenario <id>]

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

### The distribution is reported; the argmax is played

Those are two questions, and H2 used to answer both with one number. The
behavioural-cloning pipeline wants a distribution over candidates as soft
targets, so the agent softmaxes its utilities — and it then *sampled* that
distribution to pick its move. Utilities are win-probability deltas of a few
thousandths and `softmaxTemperature` is 0.02, so the distribution is broad by
construction: a candidate half a percent of win probability behind still comes
out at weight 0.44 against the best one's 0.56. In transcripts that reads

```text
#798 h2 (2 options): Draw 1 card
   → w=  0.56  Draw 1 card
     w=  0.44  Pass (end your actions this phase)
```

— a position where the agent's own model prefers drawing, and it passes two
times in five. `compare` had already written the principle down one paragraph
above: the sampling temperature belongs to the harness, not to the opinion.

So `h2` now plays its argmax and reports the distribution unchanged. Sampled
play is still reachable as `h2:all@0.02`, an explicit request for exploration
when the point is covering positions rather than winning; the agent names
itself `h2@0.02` there, because a replay has to say which of the two played.

Over 599 games in two independent samples, argmax play beats sampled play by
+17 Elo [−30, +65] on 200 games from seed 1 and +10 [−24, +44] on 400 from seed
1001 — **the same direction twice and significant neither time**. This is not a
change that closes the gap to `mc`; it is one that stops paying for noise the
design never asked for. The honest summary is that it is worth something small
and positive, and that 599 paired games cannot say how small.

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
HAZARD PLAN
    4.20  Orc-warband              → their 5-character company
    0.00  Orc-lieutenant           nothing left it improves
  total denied if carried out: 4.20 tsd

HAND
    2.10  Orc-warband         adds 4.2 to the plan against their 5-character company
    1.00  Doors of Night      no points and no attack to model — the flat price
    0.00  Anborn              mind 2 does not fit the 1 influence free
    0.00  Orc-lieutenant      nothing left it improves — worth nothing as an attack
```

Those two are §3.5's shadow price (`card-price`) and the plan it now rests on.
The price is what makes a discard a decision rather than a coin flip, and the
reason `hand` is the only module the horizon test can see any signal from.

It used to price a creature **alone**, and printed a tension it could not
resolve: the Orc-lieutenant was worth nothing by itself while `hazards` ranked
*playing* it at +3.9% as the opener of a bundle the warband finished.
`hazard-plan` resolves it by answering both questions at once — a standing
assignment of every hazard in hand to a company it would be played against,
greedy and supermodular, so a follow-up is credited as one. Each card is then
worth its **marginal** contribution, which is why the marginals sum to the
total and no pair is credited twice. The lieutenant still comes out at zero, but
now for a reason that agrees with `hazards`: behind the warband there is nothing
left it improves, because it hands over more kill MP than it denies.

It is the most expensive thing in the project — an attack sequence resolved per
(card, company) pair per round — so it is memoised per position, and an
instrumented self-play game runs in about 15 seconds rather than 10.

### One reader for the numbers, so the two seats cannot disagree

A company facing Orcs while Minions Stir is out is facing *stronger* Orcs. The
hazard side learned that first — it prices its own support events by re-running
the plan with the modifier applied — and the defending side did not, so
`defence` reported the printed attack and under-stated every harm it is asked
for: every company-shape comparison, every enter-site cost, every Stealth.

`services/attack-modifiers` is now the one reader of what the hazard events on
the board declare, and both seats spend it. `defence` applies the modifier to
each sampled creature *by its own race* before taking the median, so the answer
stays a whole number the dice tables can be indexed by — and so a modifier keyed
to Orcs moves the typical attack only against an opponent who actually plays
Orcs, which is the median doing its job rather than a limitation.

That also makes the removal priceable from the resource seat. Marvels Told
discards a hazard non-environment permanent or long event, which is exactly what
Minions Stir is, and what it is worth is the harm that stops:

```text
discarding Minions Stir takes 8.8 of harm off our companies — the attacks it
was strengthening go back to their printed numbers
```

It was the largest single blocker in the game at 149 declined candidates in
three self-play games. The player picks the target in a later sub-flow, so the
*best* reachable card is priced rather than a named one; a target whose effect
this cannot read still leaves the card declined.

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

A hazard **support event** is priced by running that same plan twice. Minions
Stir gives every Orc attack +1 strike and +1 prowess, +2 of each while Doors of
Night is in play, and the modifier is *declared* against the same two numbers
the strike enumeration already runs on — so the plan is built as it stands and
again with the modifier applied, and the event is worth the difference between
the two best bundles:

```text
play Minions Stir: 1.5%
├─ the event: +2.4
│  ├─ what it achieves: +2.4
│  │    [orc attack +1 prowess, +1 strike(s); troll attack +1 prowess, +1 strike(s)
│  │     — the best bundle against this company goes from 6.5 to 9.0]
│  └─ the card it spends: +1.0  {provisionalCardPrice}
```

It was the most-declined hazard event in the game — 59 candidates in three
self-play games against Doors of Night's 46 — and a hazard side that cannot
value its own support events cannot build the Orc engine the deck is for. Two
properties fall out of the counterfactual rather than being asserted: the event
is worth **nothing** when the hand holds no attack the modifier would reach, and
the Doors of Night upgrade arrives only when Doors of Night is actually in play,
because the +2 clauses carry `overrides` naming the +1 clauses they replace. A
modifier whose condition the module cannot read is *dropped* rather than assumed
to hold, so an unfamiliar gate under-values the card instead of over-valuing it.

**Once it is out, it is simply the numbers.** The first version of that read a
modifier only at the moment its card was played, which priced the play correctly
and then went on resolving every bundle behind it as if the card were not there
— a long event lasts the turn, a permanent one the game. `planFor` now resolves
every attack with the modifiers the hazard events in play declare, so the
baseline is the board as it stands and the counterfactual arm is **the board
with one more card on it**.

That second reading is the whole of Doors of Night. It does nothing to an attack
itself; what it does is satisfy `inPlay: "Doors of Night"` on the Minions Stir
already out, turning +1 of each into +2. Pricing it by its own declared effects
finds nothing and declines; pricing the board with and without it finds the
upgrade — and says what it found, which in the captured position is that the
upgrade buys nothing, because the bundle already beats the company:

```text
play Doors of Night: -1.1%
  orc attack +1 prowess, +1 strike(s); troll attack +1 prowess, +1 strike(s)
  becomes orc attack +2 prowess, +2 strike(s); troll attack +1 prowess, +1
  strike(s) — but the plan has no attack left it would improve
```

So it is scored at minus the card and refused, rather than declined for want of
a family. A refusal with that tree behind it is an opinion; silence is not.

Hazard events outside those families are still declined — modelling a company
restriction means modelling its effect — so the decision is reported as partly
covered rather than guessed at.

That budget line about influence is the one to watch: `reducer-site.ts` requires the influencing
character to be **untapped**, so a company with none cannot attempt a faction
at all however much influence it holds — and free direct influence subtracts
what is already committed to followers, so a 5-DI character holding a mind-3
follower brings 2, not 5.

`heuristic` vs `h2` over six games: **54.2% agreement on contested decisions,
75.8% inside combat, ~202 divergences per game**. It was 96.7% / 87.2% / ~14
when the modules below covered a third of the game instead of seven eighths, and
the movement is the point: agreement is a sizing number, so a fall in it is how
much more there now is for a gate to measure, not a claim about quality.

Five modules are calibrated, 46 claims in all: `combat` (36), `grants` (4),
`resources` (3), `corruption` (2) and `factions` (1). Two kinds of claim are checked — dice
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

The ablation that matters most is the other direction — *everything*, against
everything but one module — and until recently it could not be run at all. An
agent spec may contain commas of its own, and `--agents` split the pair on
commas, so a fifteen-name selector parsed as fifteen agents and the child
process died. A **semicolon** separates the pair when one is present, and the
comma keeps working for every spec without one:

```sh
npm run gate -w @meccg/sim -- --challenger h2 \
  --champion 'h2:characters,kill,combat,corruption,endgame,events,factions,fetching,grants,hand,hazards,health,resources,travel'
npm run bench -w @meccg/sim -- --agents 'h2;h2:combat,kill'
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
| P2 services | `standing`, `budget`, `exposure`, `beliefs`, `character-value`, `card-price`, `denial`, `defence`, `hazard-plan`, `attack-value`, `attack-modifiers`, `strike/*` — printed by `explain` where they are spent |
| P3 acquisition | `factions` and `resources` written; the strategic half (which sources are worth chasing) is still missing |
| P4 | `corruption` and `health` written |
| P5–P7 | `characters` (incl. company shape), `hand` (with §3.5's real card price), `endgame`, `hazards`, `grants`, `fetching` and `events` written; `allies`/`misc` not started |

### Coverage, measured

There is a CLI for this now, because it is the number that decides which module
to write next and guessing at it was how the table below went stale twice:

```sh
npm run coverage -w @meccg/sim -- --games 3
```

Over 1882 contested decisions:

```text
  covered and decisive       1595  84.8%
  covered but flat             86   4.6%   → H1
  partial, acted anyway        61   3.2%
  partial, handed over        139   7.4%   → H1
  no owner at all               1   0.1%   → H1

  H2 decides 88.0% of contested decisions.
```

That is up from 33.1% at the start of the coverage work. It reads lower than
the 50.0% reported before regressive candidates were filtered out, and the
comparison is not like for like: the denominator is now the decision the agent
actually faces, with the engine's marked undos removed. More of what is left
scores flat, because dropping a candidate and its undo often leaves a tie.

The commits that moved the number were all found by running this rather than by
reasoning about it:

- **`pass` was the largest single blocker by a factor of three** — 476
  decisions. Three modules own it inside their own windows and nobody owned it
  anywhere else, so a site phase offering four scored resource plays and one
  unscored `pass` went to Heuristics 1 entire. It is not a module: a utility is
  a change relative to doing nothing, and passing *is* doing nothing, so the
  zero is a definition and lives in `core/baseline.ts`. The engine spells the
  same non-act two other ways — `pass-chain-priority` declines to add to an open
  chain, `draft-stop` ends the character draft — and each spelling the baseline
  did not know was a whole decision handed over for want of the one candidate
  that means "nothing". With all three listed, **no action type in a contested
  decision is unowned any more**: the "no owner at all" line reads 0.0%, and
  what is left is modules declining, which is a different and more honest
  failure. Covering the spelling invents no opinion — a draft whose picks all
  score zero is still a tie, and still goes to Heuristics 1.
- **`cancel-movement` and `declare-path`** (262 decisions) were already inside
  `travel`'s model — cancelling is the destination value with the sign flipped.
- **Sideboard access** (72 decisions) was the largest *flat* decision left: four
  action types that `hand` owned and scored at zero, on the grounds that no
  marshalling point moves. True, and beside the point — the cost of reaching
  into a sideboard is never measured in points, and both variants publish
  exactly what it is. The resource player taps their avatar (CoE 2.II.6, and the
  action names him), so `character-value` prices it. The hazard player pays with
  **half the hazard limit** for every company in the coming movement/hazard
  phase, and `hazard-plan` prices that by re-running its allocation against
  halved limits: the cost is the denial the hand can no longer do.
- **`split-company` and `merge-companies`** (191) turned out to have an exact
  half: the hazard limit *is* the company size, so shape decides how
  concentrated the harm can be. `services/defence.ts` computes it.
- **`enter-site`** (89) is the one decision in the game where *both* halves are
  published. Entering commits the company to the site's automatic attacks before
  a single resource can be played (CoE 341–343), and the site card prints those
  attacks with their strikes, prowess and body — so the cost is `defence` run
  against the real thing rather than a median creature, and the gain is the
  hand cards that become playable, capped by the characters left to tap:

  ```text
  enter Goblin-gate: -1.0%
  ├─ automatic attacks: 1  [3 strike(s) at prowess 6]
  ├─ what they would cost: +0.9  [priced against this company]
  ├─ on-guard cards: 0  [nothing was placed]
  └─ taps available: 0
  ```

  Every character is tapped, so nothing is playable and the attacks buy nothing
  at all. Passing wins, and the tree says why.

The report also separates an action type **nobody owns** from one a module owns
and then **declines**, because they mean opposite things: the first is a module
waiting to be written, the second is a module that took responsibility and had
nothing to say. That column immediately found two bugs, both `combat` claiming a window it
could not serve:

- **`choose-strike-order`**, declined 124 times. Ordering was handled only
  inside the strike-window branch, which is reached when a strike is already
  current — and at that step there deliberately is not one, because picking it
  *is* the decision.
- **`assign-strike` from the attacking seat.** Excess strikes are assigned by
  the *attacker* (CoE 3.iv), so the hazard player is asked which enemy character
  eats the extra strike. Every price `combat` knows has the wrong sign there,
  because harm to that company is the thing being aimed for. It now gates on the
  company being ours, and `hazards` takes the window — it is a denial choice
  like any other.

### Pricing a card's ability without knowing the card

`activate-granted-action` was the largest unowned type — 213 blocked decisions —
and it looks like a card-by-card problem, which is why nobody had taken it. It
is not, quite. The DSL already declares both halves of every grant:

```json
{ "type": "grant-action", "action": "saruman-fetch-spell",
  "cost": { "tap": "self" },
  "apply": { "type": "move", "from": "discard", "to": "hand" } }
```

So `grants` prices **families of declared effect**: a `tap` cost is what
`character-value` says tapping that character forfeits, a `move` into hand is a
card recovered, an on-success that discards the granting card is that card
ceasing to do whatever it was doing. Cards this project has never seen are
priced the moment their effects are written; effects outside the list are
declined.

```text
activate Lure of Nature: -0.8%
├─ needs on 2d6: 5  [83.3% to succeed]
├─ what it is worth: +1.7
│    [corruption 5 → 3 narrows the failing band by 19.4%, against 9.0 tsd lost]
└─ what it costs: +2.1
     [taps bearer — flat tempo plus the influence attempt forfeited]
```

It declines to try, for a reason no flat tap cost could reach: shedding two
corruption is worth 1.7, and tapping Glorfindel forfeits a faction attempt worth
2.1.

### The cheapest decision to own: a swap is a difference

`exchange-sideboard` was the last action type with **no owner at all**, and by
candidate count the largest thing in the game: when a play deck runs out the
discard pile becomes the new one, and before it is shuffled the player may swap
up to five cards between the pile and the sideboard — so the engine offers every
(discard, sideboard) *pair*, 20150 of them in three games. Heuristics 1 has no
evaluator for the type either, so every one of those decisions was a coin flip
across a thousand candidates, as likely to send the deck's best remaining card
to the sideboard as to fetch one back.

It needed no model. `fetching` already answers "which card would you rather
have" by asking `card-price` for a quote, and a swap is that question with a
second leg: what arrives minus what leaves. `pass` is the do-nothing baseline
here, so a swap happens only when the difference is positive.

```text
RANKED (modules baseline + fetching)
  1. Exchange Ioreth (discard) ↔ The White Tree (sideboard)
     U = +4.90% win   E[Δtsd] +2.5  σ 0.0  (integrated)
  ...
  1008. Exchange Orc-guard (discard) ↔ Riders of Rohan (sideboard)
     U = -11.89% win  E[Δtsd] -6.8  σ 0.0  (integrated)
```

The failure mode it has to avoid is silent: read only the card the action names
— `namedCard` finds `sideboardCardInstanceId` quite happily — and a swap prices
as a gift, every candidate scores at or above zero, and the module trades away
whatever the deck's best card happened to be. The card *given up* therefore has
its own spelling list in `core/action-fields`, disjoint from the card list by a
test, and the module's test pins that the ranking over outgoing cards is the
reverse of the price ranking.

A thousand candidates is also the only decision in the game where the
per-decision budget is at risk, and it is what forced `quote` to be cached by
definition: 1008 candidates over a few dozen distinct cards, each one otherwise
resolving a whole attack. Measured on the captured position, 110–580 ms without
the cache and 29–64 ms with it.

### "I cannot read this" is not the same as "there is nothing to read"

Declining is the honest answer to a family the module cannot price, and it was
also being given to two cases where the module can *prove* the play achieves
nothing. Those are opinions, and worth stating:

- **The card declares no effect this engine will execute.** Twilight's whole
  effect list is two `play-flag`s — declarations about *how* it may be played,
  not about what happens when it resolves. Its printed text cancels an
  environment card; the DSL does not say so, and the engine plays what the DSL
  declares. It was the second most-offered declined short event, 44 of 122 in
  three games, and playing it spends a card for nothing. The rule is
  self-correcting: the day the cancel is written into the DSL, the effect list
  stops being declaration-only and the module goes back to declining.
- **A removal with nothing to remove.** Every short event in the pool that
  discards something from play — Marvels Told, Ancient Secrets, Voices of
  Malice, The Cock Crows, Wizard's River-horses — targets a *hazard event in
  play*. With none in play the card resolves for nothing; with one, the module
  still declines, because what that event was doing is the thing it cannot
  price.

The second replaced a branch that was simply wrong. It read the same
`move ... from: "in-play" to: "discard"` and priced it as the corruption relief
of taking an attached hazard off one of our own characters — a different effect,
on a different target, that no card in this family has. Whenever one of our
characters happened to be carrying a corrupting hazard, the module credited a
benefit the card could not deliver.

What is left, by decisions blocked: hazard `play-hazard` events at 66,
`play-short-event` at 60, and the granted-action families `grants` still
declines at 43. All three need a card's *effect* priced against the opponent
rather than against a card in play, which is where the family approach runs
out — knowing an event moves a card tells you the mechanism, not what the target
is worth.

### The opening draft: built, gated, and rejected

The draft has scored **flat** since P0 — every candidate at exactly 0.0% — and
the reason is not a gap in a module. CoE 10.3 step 4 reduces any source
contributing more than half a player's total until it is no more than half, and
that iterates, so at 0–0 a score made of one source cancels itself: three
character marshalling points alone score zero. `card-price` quotes every
character in the pool at the same number because the standing has no opinion
there, and the most consequential decision in the game went to Heuristics 1.

The obvious way out is to stop pricing the draft in marshalling points. What a
starting character is *for* is that he stands in front of the company all game,
and that is priced in the flat tempo constants a tap, a wound and an elimination
cost — which do not vanish at 0–0. So a pick is worth the harm it takes off the
company: `defence.expectedHarm(drafted, slots)` minus the same with the
candidate in it, both arms at the limit the company will have *after* the pick,
so the comparison is between candidates rather than between company sizes.

It ranks exactly as you would hope — Glorfindel II first, Fatty Bolger last —
and it **loses**:

```text
h2 vs h2 without the draft module, paired seeds, side-swapped
  score:     90W-106L-4D (46.0%) over 200 rated games
  elo diff:  -28 [-77, +20]
  glicko-2:  -6 [-84, +73]
```

Not conclusively worse — the interval spans zero — but no evidence of gain and
the point estimate on the wrong side, and it fails the gate's own criterion. So
it is not shipped. Two things are worth carrying forward from it.

**The first pick cannot be scored this way at all.** With nothing drafted the
baseline is a company that does not exist, and a company that does not exist
cannot be harmed — so every candidate comes out *negative* (−1.7 to −6.3 in the
corpus position) and `draft-stop` outranks all of them, which would leave the
player with no company. From the second pick the comparison means something
(+2.7 to −2.5, and +6.1 by the fourth). The experiment declined the first pick
for that reason.

**The half that is missing is mind.** Twenty points of general influence across
the whole starting company is the draft's real budget, and a defence-only
valuation never trades it off: a mind-8 character who parries well beats two
mind-4s who would answer better between them, so the pool goes early and the
company ends up small. Pricing mind needs a rate, and a rate is the hand-tuned
weight this design exists to remove. The next attempt should start there rather
than from the defensive number, which is measured and does not carry the
decision on its own.

### Does it win?

```sh
# The verdict: paired seeds, side-swapped, with an Elo interval
npm run gate -w @meccg/sim -- --challenger h2 --champion heuristic --pairs 20 --jobs 4

# The watchable version: prints each game as it finishes
npm run headtohead -w @meccg/sim -- --games 16 --max-decisions 4000
```

`gate` is the tool that answers this properly, and `headtohead` exists because a
run you can watch beats a run you wait on. Over **200 rated games**, paired and
side-swapped, on a tree with every module above in it:

```text
  score:     111W-76L-12D (58.8%) over 199 rated games
  elo diff:  +62 [+15, +111]     (95% CI, challenger − champion)
  glicko-2:  +103 [+25, +182]
  failures:  1 — seed 1: 508 turns, decision limit reached (see below)
```

**Both methods now agree the interval clears zero.** The previous run of this
command — 55.8% over 319 games, +40 [+3, +79] Elo and +29 [-40, +98] Glicko-2 —
had them disagreeing about significance, and that disagreement was the honest
reason the claim was only "probably somewhat stronger". It is not the reason any
more. The two samples are on different seeds and different sizes and their
intervals overlap heavily, so this is not evidence that H2 gained 22 Elo; what it
is evidence of is that a fresh, larger-margin sample now separates the two agents
by both measures.

The other half of the same story is `compare`, which is a sizing number and not
a verdict:

```text
  agreement, contested: 54.2%
  divergences:          ~201.8 per game
```

That was 96.7% and ~14 per game when the section above was written. H2 now
decides 88% of contested decisions rather than 66%, so there is an order of
magnitude more for a gate to measure — and the gate duly measures a wider
separation. Read the two together: the agreement number says *how much* is being
measured, the Elo interval says *which way*.

An earlier run of the same command reported +61 [+24, +100]. It is not quoted
here: source was edited while it was running, and `gate` spawns `tsx` children
that read the source at launch, so different games in it played different code.
The number above is from a stable tree.

#### The one game that did not finish, and the wrong diagnosis of it

Seed 1 ran **508 turns** and hit the decision limit at 0–0, with both players
having lost every character and a companyless player offered nothing but `pass`
in their organization phase.

**The explanation recorded here was wrong**, and is corrected rather than
deleted because the wrong version was acted on. It said there is no
`play-character` on offer "because every path to playing one runs through an
existing company". There is such a path: `findPlayableSites` searches the
player's **site deck** precisely so a character can form a new company. Across
sixty seeds, a companyless player holding a character was offered a viable
`play-character` at 65 decisions; where none was offered the reason was a real
rule — "already played a character this turn", "unique character already in
play", or a home site the site deck no longer held. The seed-1 stall also no
longer reproduces: on current master that game completes in 134 turns.

What is real, and was the mechanism worth chasing, is that **site cards leak**.
A companyless player can only reach the sites in their location deck, so a
player who loses their havens loses the ability to start a new company — and
sites were going missing. One of the leaks is fixed alongside this note:
`cleanupEmptyCompanies` sent a dissolved company's *tapped* site to
`discardPile`, the play deck's discard, where rule 2.07 means the **site**
discard pile. A site sent there is lost as a site — only `siteDiscardPile` is
returned to the location deck, by `startDeckExhaust` — and `completeDeckExhaust`
shuffles that pile into the play deck, so the site card ends up among the cards
drawn.

That is not the whole leak. Tracking every site instance through twelve games
shows a company dissolved during the organization phase losing **both** its
current and its destination site, on master and after this fix alike:

```text
seed 1 p2 turn 5 organization: current:Lórien
seed 1 p2 turn 5 organization: dest:Rivendell
```

That one is located but not diagnosed, and is deliberately left rather than
guessed at.

What the samples do establish is that H2 plays every game to completion, which
was not true a week ago. Two self-play games once ran to the decision limit
cycling `split-company → plan-movement → merge-companies` inside one
organization phase, because `characters` valued a shape change and its undo both
positively. Company-shape utility has to be a difference of one potential,
`Σ harm(company)` over the whole board. Three separate things were breaking that:

- **Order.** Strike targets are picked by lowest need with ties falling back to
  array position, so a company scored differently depending on how it had been
  assembled: merging A into B came out at +2.61%, B into A at +2.30%.
- **Shape-dependent prices.** Harm was priced through `character-value`, whose
  tap cost includes the influence attempt the tap forfeits — which depends on
  *which company the character is in*. Splitting scored +1.28 tsd and merging
  the pair straight back +0.48.
- **The engine had already said so.** `reverse-actions.ts` marks every candidate
  that undoes this phase's progress, and Heuristics 1 had filtered on that flag
  since before H2 existed. H2 and the Monte-Carlo searcher did not. That is now
  `ai/regress.ts`, used by all three and by the CLIs that report what the agent
  sees.

### Does any of it predict anything?

Not measurably. The horizon test (§6.4) correlates what a module predicted over
a turn against what the score actually did 1, 3 and 5 turns later. Over **32
games**:

```text
  (all)        h1 +0.00 [-0.05, 0.06]  h3 +0.01 [-0.04, 0.07]  h5 +0.03 [-0.03, 0.08]
  hand         h1 -0.01 [-0.06, 0.05]  h3 -0.03 [-0.09, 0.02]  h5 -0.05 [-0.11, 0.00]
  travel       h1 -0.09 [-0.16, -0.01] h3 -0.06 [-0.14, 0.02]  h5 -0.03 [-0.11, 0.05]
  hazards      h1 -0.05 [-0.14, 0.03]  h3 +0.01 [-0.07, 0.10]  h5 +0.04 [-0.05, 0.12]
```

Every interval spans zero at horizon 3, including the aggregate. No module
fails the gate and none passes it: the honest reading is that a module's
predicted change over a turn does not measurably track the score three turns
later, in either direction.

**This corrects a claim made a few commits earlier.** A 16-game run on different
seeds put the aggregate at +0.13 [0.05, 0.21] and `hand` at -0.10 [-0.18,
-0.02], and both went into this README — the first as "the first run where the
aggregate predicts anything", the second as a module failing the gate. Neither
replicates. The test's own documentation warns that two six-game samples once
put the same module at +0.10 and -0.18, and reporting a single 16-game sample
was the same mistake one size up. The 32-game numbers are the ones to trust,
and what they say is "no signal", not "signal".

One diagnostic worth keeping from that episode: the report now prints how
strongly each module's per-turn total correlates with its own *decision count*,
because a module whose predictions all carry one sign has a per-turn total that
is mostly how busy it was. `hazards` trips it at +0.85 — its number there is
partly an activity measure. `hand` does not, so that never explained its sign.

Two earlier fixes were needed before the test said anything at all: it
correlated single *decisions* (16 games put every module indistinguishable from
zero out to n=2689 — one action among hundreds in a turn cannot explain a score
change), and it failed modules on the sign of a point estimate.

### Falsifiable, where it can be

```sh
npm run calibrate -w @meccg/sim -- --rollouts 4000
```

`combat` (36 claims), `resources` (3), `corruption` (2), `factions` (1) and
`grants` (4) are checked against the reducer: the harness replays the action
thousands of times and asserts the observed frequency lies inside a 99% binomial
interval of the claim. That is **46 claims**, and the command above is the one
that measures all of them:

```text
  combat       36/36 matched
  corruption   2/2 matched
  factions     1/1 matched
  grants       4/4 matched
  resources    3/3 matched
46/46 claim(s) matched at 4000 rollout(s), 1107 action(s) not modelled
```

It used to report `36/36` and stop there. `--module` defaulted to `combat`,
which was right when combat was the only module the harness could classify, and
stayed after four more classifiers were added — so the bare command measured a
fifth of what this section claims and said nothing about the rest. A green line
that silently covers less than it names is worse than a red one, which is why
the breakdown is per module now: a module the corpus has no position for reports
"nothing measured" instead of disappearing into the total.

`grants` found a bug on its first run. Two claims of 83.3% in one position, one
measuring 84.0% and the other 40.4% — the second action carried `noTap: true`,
and the engine applies **-3 to the roll** for not tapping while publishing the
*unmodified* threshold on both variants. `pAtLeast(5 + 3)` is 41.7%. The module
was also charging a tap the no-tap variant does not pay, so it preferred the
tapping variant, which is exactly backwards.

## Flat Monte-Carlo: how long should a playout be?

`mc` is the flat Monte-Carlo agent of
`specs/2026-07-27-monte-carlo-rollout-agent.md` — no tree, no network, no deck
lists. It widens its own view with `search/determinize-null`, plays every
shortlisted candidate forward through the real reducer under a uniform policy,
and keeps the candidate with the best mean TSD.

```sh
npm run gate -w @meccg/sim -- --challenger 'mc:rollouts=4/candidates=4/turns=1' \
  --champion heuristic --pairs 25 --rounds 1 --jobs 12
```

The obvious knob is `turns`, the playout horizon. Swept against Heuristics 1 at
a fixed budget of 4 rollouts over 4 candidates, 50 paired side-swapped games per
point:

| horizon | score | elo diff (95% CI) | wall |
|---|---|---|---|
| 1 turn | 82.0% | +263 [+162, +431] | 1.0× |
| 2 turns | 68.0% | +131 [+35, +251] | 1.8× |
| 3 turns | 80.0% | +241 [+138, +404] | 1.9× |
| 4 turns | 71.0% | +156 [+60, +281] | 2.2× |
| 6 turns | 77.0% | +210 [+111, +354] | 2.7× |

**There is no horizon effect.** The five proportions are homogeneous —
χ²(4) = 3.83, p = 0.43 — so the zigzag is the sampling noise a 50-game point
carries and not a curve. `heuristic` gated against *itself* on the same schedule
scores exactly 50.0% at ±92 Elo, which is the width to read every row against.
Pooled over all 250 games `mc` scores **75.6% [70.3%, 80.9%]**, and a horizon
past one turn costs up to 2.7× the wall-clock for none of it.

The headline is not the knob, though. **A four-rollout flat Monte-Carlo agent is
the strongest thing measured against Heuristics 1 in this package** — H2 sits at
58.8% / +62 Elo over 200 games (§ *Does it win?*) and `mc` is near +200. That is
a surprise the rollout spec explicitly did not expect (§7 leaves the strength
question open with the §2 objections standing) and it wants an independent
confirmation before it is believed: these 250 games share one deck pair and one
champion.

### Why depth buys nothing

`gate` cannot say why, so `mc-horizon-probe` measures the estimator directly. It
replays real self-play positions, rebuilds `mc-agent`'s decision at each one —
same shortlist, same determinized worlds, same playout seeds — and then runs the
playout at every horizon **from the same seed**. The policy is uniform over the
same filtered list and the random stream is identical, so the 8-turn trajectory
is a prefix-extension of the 1-turn one: the horizons are compared on literally
the same futures.

```sh
npm run mc-horizon-probe -w @meccg/sim -- --games 4 --seed 100 \
  --horizons 1,2,3,4,6,8 --rounds 8 --max-positions 20 [--cycle-limit 200]
```

The first run found the knob was not even connected. Over 60 positions at the
default cycle limit, the share of playouts stopping at `cycle` rather than at
`horizon` ran 18% → 82% from 1 turn to 8, and cost grew only 5× for an 8×
horizon: past two turns the **cycle guard** was ending the playout, not
`horizonTurns`. That is why `cycleLimit` is now a `RolloutOptions` parameter —
the guard is a horizon as much as it is a guard, so a caller asking for a deep
playout has to be able to say so. The default is unchanged at 12.

Raising it to 200 connects the knob (100% of playouts reach the horizon, cost
now scales 30 → 338 decisions) and the answer does not change — 45 positions:

```text
  h   zero   |tsd|  noise  signal      t   flip%   cost
   1   6.8%  12.92   3.18    1.65   1.47     ref     30
   2   6.0%  11.77   5.07    2.15   1.20   22.7%     80
   4   8.1%  10.40   5.95    2.57   1.22   38.6%    172
   8  11.0%   9.51   6.28    2.86   1.29   36.4%    338
```

A deeper playout **does** separate the candidates further — `signal`, the spread
between the best and worst candidate mean, rises 1.65 → 2.86 — but it scatters
them just as fast, `noise` 3.18 → 6.28, so the discrimination the decision
actually gets, `t = signal / (noise / √rounds)`, never improves. Meanwhile the
position's score edge decays: `|tsd|` falls 12.9 → 9.5 and the share of playouts
returning TSD = 0 rises 6.8% → 11.0%. The argmax flips against the 1-turn choice
on ~40% of positions, so this is a different decision, not a refined one.

That is §2.3 of the rollout spec — *a random rollout policy cannot execute
MECCG's plans* — measured rather than argued. Every extra turn of lookahead is
an extra turn of **both** players playing nonsense, and a uniform random walk
regresses the differential the estimator reads toward parity. §2.2's rare-event
worry is not what binds: only ~6% of 1-turn playouts return TSD = 0.

The reading for anyone spending compute here: put it in width, not depth. The
horizon is the one parameter measured to be worth nothing, and the upgrade the
spec names — a competent rollout policy in place of the uniform one
(`RolloutOptions.policy` already accepts it) — is the change that would make
depth mean something, because it is the drift and not the sampling that costs.

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
