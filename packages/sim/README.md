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

## Heuristics 1 reads its weights as a ranking

`heuristic` plays the highest-weighted action and breaks ties uniformly at
random. It used to *sample* from the weights, and that cost it about 47 Elo.

The evaluators were written to rank candidates, not to describe a policy, so
reading their output as a distribution meant playing a move scored half as good
about a third of the time. That is not a rare event on the margins: over six
games and 10341 decisions, half of which offer a single candidate, sampling
chose from outside its own top-weighted set on **26.4%** of the 5085 contested
decisions, at a mean weight of 0.858× the best available.

Ten paired gates of 400 games each — `heuristic:greedy` against `heuristic`, one
tree, agents selected by spec so no checkout could confuse the arms:

| seed block | score | paired Elo (95% CI) |
| --- | --- | --- |
| 1 | 59.5% | +67 [+36, +99] |
| 500 | 54.4% | +30 [−1, +62] |
| 1000 | 51.9% | +14 [−18, +46] |
| 1500 | 55.0% | +35 [+4, +66] |
| 2000 | 54.3% | +30 [−2, +61] |
| 2500 | 56.9% | +49 [+17, +82] |
| 3000 | 60.0% | +70 [+39, +103] |
| 3500 | 59.0% | +63 [+32, +95] |
| 4000 | 62.2% | +86 [+55, +119] |
| 4500 | 54.9% | +34 [+3, +66] |
| **pooled, 3997 games** | **56.8%** | **+47 [+37, +58]** |

All ten blocks favour the argmax; the per-block spread is ±23 Elo, which is why
five of them fail a `--min-elo 0` gate on their own. A single 400-game block
carries a ±30 interval — wide enough to straddle zero on an effect this size,
and the reason the first two runs looked like they disagreed.

Sampling is still reachable as `heuristic:sample`, and the training-data
exporters (`export-training`, `fit-winprob`) ask for it by name: an argmax
teacher walks one trajectory per seed, and what those consumers want is
coverage either side of it. `heuristic:greedy` is accepted as a no-op alias.

## Heuristics 2

> ### ⚠ The Elo figures below are unreliable
>
> Every gate result in this document was produced by a harness that could
> silently measure **the wrong tree**. Controls were run either in a `git
> worktree`, or after a `git checkout` inside a compound command; when the git
> step failed — and it did, because a worktree already held `master` — the gate
> ran anyway and reported a clean-looking number for a tree it had not been
> given. Failures produced plausible results instead of errors.
>
> It surfaced when two runs of supposedly different trees agreed to the digit.
> Re-measuring with the tree verified immediately **before and after** each run,
> which is the only thing done differently, gives:
>
> | tree | seed block | score | paired Elo (95% CI) |
> | --- | --- | --- | --- |
> | `master` @ v0.109.0 | 1 | 56.6% | **+46 [+14, +80]** |
> | `master` @ v0.109.0 | 500 | 53.8% | **+26 [−5, +58]** |
>
> **H2 beats Heuristics 1 on both blocks**, and appears to have been doing so
> for some time. Figures in this document reporting H2 at −96, −101, −111,
> −134, −155, −188, −211 or −265 are wrong, and every conclusion resting on a
> *difference* between two such figures is unsupported — including the 87 Elo
> attributed to #2397, the 90 Elo attributed to each enter-site fix, and the
> +157 briefly attributed to charging a carried wound, which turned out to be
> `master`'s own number measured twice.
>
> What survives is everything measured **without** a gate: agreement rates
> against the recorded corpus, the funnel counts from `scoring-loop`, the
> arrival statistics from `hand-flow`, the route shapes from `route-compare`,
> and the wounded/tapped/untapped splits. Those were computed in-process from a
> single tree and are unaffected.
>
> #### The +46 does not hold any more (re-measured at v0.144.0)
>
> Gated again on `master` @ `ec6a4def8` — challenge decks, seed 1, 400 games,
> 4 jobs, the tree printed on each run — H2 scores 17.8% for a paired
> **−266 [−315, −225]** against Heuristics 1. The v0.109.0 rows above record
> what was true then; they are not a current baseline. **H2 is about 270 Elo
> behind H1 today**, which also means every ablation in this section is
> anchored to a `+46` that the agent no longer earns: the *differences* remain
> the honest part of those tables, the level does not. When the regression
> entered, and to which change, is unmeasured.
>
> #### Re-measured: what four of the merged changes are actually worth
>
> Each isolated by zeroing its own constant through the agent spec
> (`h2:all/<tunable>=0`), so nothing is checked out or rebuilt and every run
> prints the tree it read. Seed block 1, against the `master` baseline of
> **+46 [+14, +80]**; standard error on each difference is about 23.
>
> | ablation | score | paired Elo | the change is worth | originally claimed |
> | --- | --- | --- | --- | --- |
> | `favouriteCharacterTsd=0` | 49.1% | −5 [−37, +26] | **≈ +51** | "strength-neutral", −12 |
> | `draftMindPriorityTsd=0` | 56.9% | +49 [+16, +84] | ≈ 0 | +17 |
> | `gatingResolutionTsd=0` | 53.5% | +26 [−8, +60] | ≈ +20 | "strength-neutral", −6 |
> | `revisitedSiteCost=0` | 53.7% | +26 [−7, +60] | ≈ +20 | +21 ✓ |
>
> **Drafting the characters the deck asked for is the largest verified
> contribution in the agent** — about 51 Elo, some 2.2 standard errors — and it
> was written up as making no difference to strength. Drafting the expensive
> characters first, which was written up as the gain, is worth nothing. The two
> conclusions were exactly inverted.
>
> The corruption check and the revisit charge both sit near +20, under one
> standard error: suggestive, not established. The revisit charge's original
> +21 is the one figure from the broken harness that survived contact with a
> verified one, which is a reminder that those numbers were unreliable rather
> than uniformly wrong.
>
> #### The full ledger
>
> Every merged change, isolated either by zeroing its constant or by a surgical
> ablation on its own branch, gated at seed block 1 against `master`'s
> **+46 [+14, +80]**, each run stamped with the tree it read. Standard error on
> each difference is about 23–25.
>
> | change | ablated score | ablated Elo | **worth** | originally claimed |
> | --- | --- | --- | --- | --- |
> | acting on ties | 24.1% | −198 [−240, −161] | **+244** | +110 |
> | favourites draft | 49.1% | −5 [−37, +26] | **+51** | neutral (−12) ✗ |
> | haven healing | 49.9% | −1 [−32, +30] | **+47** | +33 |
> | `move-to-influence` | 52.9% | +20 [−11, +51] | +26 | +9 |
> | corruption check | 53.5% | +26 [−8, +60] | +20 | neutral (−6) ✗ |
> | revisit charge | 53.7% | +26 [−7, +60] | +20 | +21 ✓ |
> | mind-priority draft | 56.9% | +49 [+16, +84] | 0 | +17 ✗ |
> | carried wound *(unmerged)* | 54.0% | +28 [−4, +60] | −18 | +157 ✗ |
> | #2397 tap deduction *(reverted)* | 45.8% | −29 [−63, +4] | −75 | −87 ✓ |
>
> **Acting on a tie rather than passing is worth about 244 Elo** — ten standard
> errors, and four times what was claimed for it. Nothing else in the agent is
> close. An agent holding none of these would sit near −360, which is roughly
> where a policy with no opinion at all belongs.
>
> Five of the nine claims were directionally right; three inverted, and one
> (the revisit charge, +21 against a verified +20) was exact. The broken harness
> produced numbers that were *unreliable*, not uniformly wrong — which is why
> every one had to be re-measured rather than negated.
>
> **The H1 removal is the one change not measured here, and it cannot be
> ablated honestly.** Reverting it means restoring `Heuristic2Options.fallback`,
> the `!speaks → fallback.chooseAction` path and the CLI's `h2+mc` parsing — but
> acting on ties subsequently *rewrote* that same block, so this would be
> reconstructing deleted code by hand and measuring the reconstruction. The
> sound alternative is to gate the commit immediately before it, a tree that
> really existed; that answers "was the agent better before the fallback was
> removed" rather than "what is the removal worth today", and should be labelled
> as such.
>
> Sections below still carry their original figures. They are marked, not
> rewritten: inventing corrected numbers without measurements would repeat the
> original error more quietly.

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

# The same explanation, live, for the game on screen: attach an observer and the
# game screen grows an "Ask AI" icon (specs/2026-08-17-ask-ai-observer.md).
# Any agent, not just h2 — a non-h2 spec renders its ranked candidates instead
# of the module derivation. Reads the position from the game log, so it runs on
# the server's own host and authenticates with MASTER_KEY.
bin/observe [--agent h2] [--new] [--once]
bin/observe --agent h2 --agent 'mc:ms=2000/turns=2'   # offer both, pick per ask
# In the game screen the icon's menu asks either about the position or about
# your own last move — the latter renders a verdict on what you actually played.

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

# Where does the marshalling-point loop break? (offered vs taken, per action)
npm run scoring-loop -w @meccg/sim -- --games 6 [--agents h2,heuristic] [--json]
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
| Plan layer | `core/plan`, `services/portfolio`, `services/plan-value`, printed by `explain`. `resources` and `factions` propose; `travel`, `hand` and `characters` own steps. Measured at n=20 against its own off-switch: behaviour moves, score does not. No survival step yet; not gated |

### The plan layer

Every utility above is a one-step change in win probability relative to doing
nothing, and that is the thing the agent cannot score with. The 107 recorded
human-versus-AI games are 107–0, and the AI's points sit almost entirely in
`kill` — the one marshalling-point category that requires no plan, because it
happens to you when a hazard connects. Item, faction and ally each need a
multi-turn commitment, and the AI scores near-zero in all three.

`specs/2026-08-11-h2-plan-layer.md` is the design. What is in the tree so far
is its vocabulary and its bookkeeping, deliberately inert:

- **`core/plan`** — a plan is a commitment carrying a payoff and a completion
  probability. Its payoff is the *marginal* TSD of the goal through `standing`,
  never nominal MP, because CoE 10.3 step 4 caps a source at half the total and
  a third faction can be worth exactly zero. `P(complete)` is the product of
  its steps, and those steps are `exposure`, `beliefs`, `defence`, `budget` and
  `dice` — composition of services that already exist rather than new
  modelling.
- **`H2Module.proposePlans`** — optional, called once per turn. Most modules
  will never implement it: nothing about a strike is a multi-turn commitment.
- **`services/portfolio`** — every module proposes, one service commits. That
  split is what keeps `travel`'s rule intact: two models of the same choice
  eventually disagree and nothing in the output says which was wrong, and N
  modules each carrying a private future is that failure at strategic scale.
  Proposal is per-module; the future is shared.

The portfolio's second job is the one that would break if it were skipped.
Plain `h2` already spends whole games alternating between a shape change and
its undo, because both score positive and the argmax of that pair oscillates —
the same family `NEVER_YIELDED_ACTION_TYPES` keeps from the `mc` fallback. Two
*plans* alternating every turn is that defect one level up, and worse, because
nothing completes and the symptom is a slow loss rather than a hang. So a
committed plan is never dropped for being marginally out-ranked: a challenger
must beat the **sum** of what it displaces by `planSwitchMarginTsd`, and a plan
otherwise leaves only on an explicit trigger — deadline passed, proposer
withdrew it, or `P(complete)` fell through `planAbandonProbability`.

`explain` prints the portfolio above the ranking, which is the only way the
layer will ever be debuggable — a candidate's contribution is unreadable
except against the commitment it serves:

```text
PLANS
  committed plans: +0.0  [turn 2]
  └─ nothing proposed: no module offered a plan for this position
```

#### The first proposer, the first consumer, and what a plan is worth

`resources` proposes: *play this card at that site*, with the site taken from
the **site deck** rather than from wherever the company happens to stand. That
is the strategic half its own module comment has always said was missing, in
its narrowest form. `travel` owns the one step — whether anything is actually
going there — because reaching a site is a movement question, and a proposer
that answered it would be the second model of movement this module already
refuses to have.

A contribution is then

```text
score(a) = Σ_p ∈ committed  payoff_p × [ P_p(complete | a) − P_p(complete | pass) ]
         + tactical(a)
```

with `W` applied **once**, to the evaluation's own outcome distribution shifted
by that sum. Three things about that are load-bearing:

- **The sum is in TSD.** `W` is nonlinear, so adding two ΔP(win) figures is
  arithmetically wrong, and wrong hardest in the close games that matter most.
- **The distribution is shifted, not the mean.** A plan contribution is
  deterministic given the action, so it moves every outcome equally and leaves
  σ intact — which is what keeps the risk posture's grip on the action.
- **Only a step's owner may move it.** The plan owning the payoff stops two
  modules booking the same points; it does nothing about two modules each
  claiming they raised the same `P(complete)` by 0.3. One owner per step makes
  that double-count structurally impossible, exactly as the single-owner action
  registry does for evaluations. A step driven to zero *is* the veto channel,
  so there is one mechanism rather than two.

Both aggregation rules ship, per §7 of the spec: `planAggregationMode` 0 sums
as above, 1 is Borda over the tactical ranking plus one ballot per committed
plan. Voting discards magnitude by construction — that is the property being
bought and the reason it is the challenger rather than the default. The gate
decides.

#### Does it work? The funnel says yes; the scoreline says not yet

Six games, `h2` versus `heuristic`, challenge decks A/B, seeds 1–6 — the same
run as the baseline above:

| | baseline | with the plan layer |
|---|---|---|
| `play-hero-resource` **offered** | 4 | **10** |
| `influence-attempt` offered | 7 | 11 |
| `enter-site` take-rate | 17.2% | **29.9%** |
| games taking any scoring action | 4/6 | **5/6** |
| item MP | 0.7 (0 in 4/6) | 1.0 (0 in 3/6) |
| faction MP | 2.2 | 3.3 |
| ally MP | 0.0 (0 in 6/6) | 0.3 (0 in 5/6) |
| character MP | 1.5 | 2.2 |
| `misc` MP | −0.8 | 0.0 |

Every column moves the way the design predicts, and the one that matters most
is the first: the acquisition modules are asked two and a half times as often,
because something is finally routing companies to sites where a card in hand
can be played. `enter-site` is taken nearly twice as often for the same reason
— the trip now has a value the moment it is planned, instead of being priced
only on arrival, when the model correctly concludes there is nothing to do
there.

What this is **not** is a strength result. `heuristic` still scores 5.5 item MP
a game against the plan layer's 1.0, the human corpus median is 6, and six
games carry no confidence interval worth quoting. Nothing here has been gated.
The claim is that the mechanism fires and moves the metric it was built to
move; whether it wins games is step 5's question.

One game in six still hits the decision limit — the `split-company` →
`plan-movement` → `merge-companies` cycle, which is untouched by any of this
and tracked separately.

#### Widening it, three bugs, and a clean negative result

The six-game table above did not survive a larger sample, and it should not
have been quoted as a result: at that size the differences it reports are
inside what six games produce by themselves. Run properly — **20 games, same
seeds, same binary**, against `h2:all/planContributionWeight=0` as the control,
which is the layer switched off rather than a different branch:

| | control (weight 0) | plan layer |
|---|---|---|
| `enter-site` take-rate | 23.4% | **50.5%** |
| `play-hero-resource` offered | 19 | **33** |
| `influence-attempt` offered | 28 | **43** |
| games taking any scoring action | 13/20 | **18/20** |
| item MP | 0.5 (0 in 15/20) | 0.5 (0 in 15/20) |
| faction MP | 2.1 | 2.1 |
| ally MP | 0.0 (0 in 20/20) | 0.0 (0 in 20/20) |
| character MP | 1.9 | 1.9 |
| `misc` MP | −1.0 | −1.0 |
| `kill` MP | 3.9 | 5.0 |

**The behaviour changes a great deal and the score does not move at all.**
Entering a site is taken twice as often, resource plays are offered nearly
twice as often and taken 32 times out of 33, and something scores in 18 games
of 20 instead of 13 — and every marshalling-point category the layer targets
comes out identical to the control. The only category that moves is `kill`,
which is the passive one: entering more sites means facing more automatic
attacks, and some of them die.

That is the honest state of it. The mechanism does what it was designed to do
and converts none of it into points.

The leading explanation is a step that is **not** in the model: nothing in
`P(complete)` asks whether the company survives. A plan says *get there, hold
the card, keep someone untapped, play it* and never *and live*. So the agent
now walks into sites it cannot survive, gains the item, and loses it with the
character carrying it — which is consistent with `misc` sitting at −1.0 and
`kill` being the one number that moved. Modelling the arrival is the obvious
next change, and §6's calibration is what would prove it: a `P(complete)`
that is systematically higher than the rate plans actually complete at is
exactly what an unmodelled step looks like.

Three real defects were found and fixed getting to this point, each caught by
dumping the ranking at a decision rather than by reasoning about it:

- **`travel` never answered `enter-site`.** Entry is the moment a plan pays
  off, and the module only responded to `plan-movement`, so entering moved no
  probability and earned no contribution. It was priced by `evaluateEnterSite`
  alone — what becomes playable now minus the site's attacks now — which is
  negative whenever the hand is not already holding the card. Measured on one
  position: **−0.465% before, +18.3% after**, with a +6.0 TSD contribution.
  The giveaway was that `enter-site`'s mean rank when declined was 1.00 both
  before the plan layer and after it. A number that does not move when you add
  a mechanism is a number the mechanism never reached.
- **The carrier step read a present-tense fact as a future probability.**
  "Is anyone untapped *right now*" is not the question for a goal three turns
  out, with an untap phase in between — and during the site phase, when
  companies are tapped, it zeroed every plan. One probed position went from
  **0 committed plans to 5**.
- **Proposers scanned only the site deck.** A site the company is standing on
  has *left* the deck, so the proposal vanished and the portfolio dropped the
  commitment as `withdrawn` one decision before the `enter-site` that would
  have completed it. Plans died exactly when they were about to pay.

#### Adding the missing step: what the trip costs

A plan that never asked whether the company survives is not a plan, so the
site's printed automatic attacks are now priced through `defence` and **netted
off the payoff** before a plan is proposed at all. In TSD rather than as a
probability: `defence` reports harm in TSD, and a harm-to-probability
conversion would be a second model of the same thing, which is what this
service exists to prevent. `automaticAttacksOf` moved out of `travel` and into
`defence` for the same reason — three consumers, one number.

The filter that already dropped points capped to zero now also drops goals the
site would take back. It behaves exactly as designed: the agent became more
selective, entering sites 42.0% of the time rather than 50.5%.

**It did not move the score.** Against the same control:

| n=20, same seeds | control | plan layer | + survival cost |
|---|---|---|---|
| `enter-site` take-rate | 23.4% | 50.5% | 42.0% |
| `play-hero-resource` offered | 19 | 33 | 27 |
| games scoring anything | 13/20 | 18/20 | 15/20 |
| item MP | 0.5 | 0.5 | 0.7 |
| faction MP | 2.1 | 2.1 | 2.0 |
| character MP | 1.9 | 1.9 | 1.6 |

With 14 of 20 games still scoring zero item MP, 0.5 → 0.7 is one extra game,
not a result.

#### What the head-to-head funnel says, and it is not what the spec assumed

The same run reports `heuristic`'s chain beside H2's, and that comparison is
the most useful number produced by any of this work:

| per 20 games | H2 + plan layer | `heuristic` |
|---|---|---|
| `enter-site` offered | 345 | **534** |
| `enter-site` take-rate | 42.0% | 44.0% |
| `declare-path` | 270 | **404** |
| `play-hero-resource` offered | 27 | **91** |
| plays per site entered | 0.19 | **0.39** |
| games scoring anything | 15/20 | **20/20** |
| item MP | 0.7 | 4.5 |

The entering decision is **not** the difference: 42.0% against 44.0% is a tie,
and the plan layer closed that gap from 23.4%. What is left is upstream of
everything the plan layer touches. `heuristic` reaches half again as many
sites, and when it arrives it holds something playable **twice as often per
entry**. Its destination score is the crude `max(10, mp × 20)` per playable
hand card that §2.1 exists to criticise — and crude or not, it is picking
places where its hand can do something, more reliably than a marginal-TSD
model netted of harm.

So the spec's §1 hypothesis — that the AI scores nothing because nothing
routes it to scoring sites — has been tested over three measured iterations
and is at best incomplete. It now routes and enters at very nearly
`heuristic`'s rate and still scores a fifth as much. The remaining gap is in
*which* sites and *what is in hand when it gets there*.

### Hand flow and site-deck flow, and the thing actually stopping it

```sh
npm run hand-flow -w @meccg/sim -- --games 12
```

`scoring-loop` counts what is offered. It cannot see the state the company is
*in* when it arrives, and that turned out to be the whole story. This reports,
at every arrival — every decision where `enter-site` is on the table — what is
in hand, whether any of it is playable **at that site**, and whether anyone in
the company is still untapped to play it.

Twelve games, H2 with the plan layer against `heuristic`:

```text
                                                h2       heuristic
arrivals (enter-site offered)                  193             329
  … entered                             71 (36.8%)     145 (44.1%)
  … nothing playable there              22 (11.4%)     168 (51.1%)
mean playable at arrival                      1.96            0.78
mean untapped in that company                 0.55            1.73
  … arrivals with nobody to tap        145 (75.1%)      77 (23.4%)
hand: item                                    2.47            0.68
hand: faction                                 2.12            0.25
distinct sites entered / game                  4.4             7.3
```

Read the middle two rows first, because they invert the hypothesis that
prompted the diagnostic. **Hand flow is not the problem.** H2 arrives holding
1.96 playable cards against `heuristic`'s 0.78, and arrives with nothing
playable 11.4% of the time against 51.1%. Its hand is *fuller* of exactly the
right cards — 2.47 items and 2.12 factions against 0.68 and 0.25 — because it
never plays them. `heuristic`'s hand is empty of items for the best possible
reason.

**H2 arrives at a site with nobody left to tap 75.1% of the time.** The cards
are there, the company is there, and there is no untapped character to tap for
the play, so `play-hero-resource` is never offered at all.

`tapTempoCost`'s own doc comment predicted this in as many words — *"an AI
that taps freely arrives at its site unable to score"* — and it is a flat 0.3
TSD that does not know a commitment exists. `influence-attempt` is taken by H2
at 93.9% against `heuristic`'s 73.9%, and every one of those taps somebody.

So the price of the **last** tap is now the plan it forfeits. `characters`
already owned the carrier step for company-shape actions; it now answers for
*any* action that spends the last untapped character in a company carrying a
commitment, whatever the action is called. That is the plan layer doing the
one thing a flat tunable cannot: attaching a cost that belongs to a commitment
to a decision that has no idea the commitment is there.

Measured on the same twelve games:

| | before | after |
|---|---|---|
| arrivals with nobody to tap | 145 (75.1%) | **124 (64.6%)** |
| mean untapped in that company | 0.55 | **0.67** |
| `enter-site` take-rate | 36.8% | **42.7%** |
| distinct sites entered / game | 4.4 | **4.9** |
| hand: item | 2.47 | **2.06** |
| hand: faction | 2.12 | 2.06 |

Every column moves, including the one that matters most: the hand stops
filling up with items, because they are being played.

### A note on what these tables can and cannot show

The marshalling-point means quoted throughout this section are **not**
significant at the sample sizes they were taken at, and should not be read as
though they were. At n=20 between 14 and 17 of the 20 games score zero item
MP, so the mean is three games wearing a decimal point, and it has moved
0.5 → 0.5 → 0.7 → 0.3 across four changes whose funnel metrics all improved
monotonically.

The funnel counts are trustworthy — they aggregate thousands of decisions per
run and they have moved consistently and in one direction throughout. The
score column is not, and every claim in this section is stated against the
funnel for that reason. Whether any of it is worth Elo is a question for
`gate`, which is the instrument built for exactly this and the only one quoted
here with a confidence interval.

### The gate: the layer against its own off-switch

```sh
npm run gate -w @meccg/sim -- --challenger h2 \
  --champion 'h2:all/planContributionWeight=0' --pairs 24 --rounds 2 --jobs 6 --min-elo 0
```

The cleanest A/B available: the same binary, the same modules, the same
proposals and portfolio, with only the contribution weight changed. 96 games,
paired seeds, side-swapped.

```text
score:     38W-25L-1D (score 60.2%) over 64 rated games
elo diff:  +72 [-12, +165] (95% CI, challenger − champion)
  paired:  +92 [-2, +203] over 25 complete pair(s) — the criterion
failures:  32

FAIL — Elo-diff lower bound -2 < 0: challenger is too weak
FAIL — 32 game(s) did not complete (engine bug or decision limit)
```

**It does not pass, and it misses by two Elo points.** The criterion is the
paired lower bound at `--min-elo 0` — a strict promotion bar, "must
demonstrably beat the champion" — and −2 fails it. That is a real failure and
not a rounding argument: the honest statement is that 96 games cannot
distinguish this from no effect.

It is also the first number in this work that points anywhere. 60.2% and a
paired point estimate of +92 Elo is not nothing, and the interval is wide
because the sample is small — which brings up the thing now blocking every
measurement here.

**A third of the games did not finish.** 32 of 96 hit the decision limit, all
of them in the `split-company` → `plan-movement` → `merge-companies` cycle
described above, and they are excluded from the rating: 64 rated games out of
96 played. The cycle is not merely an embarrassment in a lobby game, it is
the reason this gate cannot resolve — it throws away a third of every sample
and widens the interval by roughly the amount needed to clear zero. Fixing it
is now the highest-value work available, ahead of anything else in this
section.

One caution on reading the output: the `glicko-2` line disagrees in *sign*
with the Elo estimate on this run, and that is unexplained. The paired Elo
bound is the documented criterion and is what is quoted here, but two rating
methods disagreeing is itself a reason to treat +92 as a direction rather than
a magnitude.

### The cycle guard, and what it did to that number

The organization-phase cycle is fixed. A deterministic argmax policy plus a
legal no-op loop is a hang, and `state-signature` already existed for it — but
the `bc` agent's guard keys on *action identity*, and every `split-company`
mints a fresh company ID, so the `merge-companies` that follows is a move the
guard has never seen. `cycle-guard.ts` keys on the **position** instead:
revisit a signature often enough and the conclusion is not that some move was
wrong, it is that everything tried from here led back here. Above the
threshold the spent action *types* are dropped; if that leaves nothing, `pass`
ends the phase and the position cannot recur.

It only ever narrows, so below the threshold — every position in a healthy
game — behaviour is bit-identical. Eight visits is chosen above the longest
legitimate run of same-signature decisions, because the signature is coarse
enough that a long attack can assign several strikes without moving anything
it watches.

Re-running the same gate with it in place:

| | 32 failures | 2 failures |
|---|---|---|
| games not completing | 32 of 96 | **2 of 96** |
| complete pairs rated | 25 | **46** |
| score | 60.2% | 45.7% |
| paired Elo | **+92 [−2, +203]** | **−30 [−91, +28]** |

**The +92 was an artifact of the discarded third of the sample.** With the
sample repaired the plan layer shows no measurable strength effect at all:
−30 Elo with an interval straddling zero. That is not "it fails by two
points"; it is "there is nothing here to detect at 96 games", and the earlier
number was the most encouraging figure in this whole section.

The bias is not mysterious in hindsight. The discarded games were exactly the
ones where the cycle fired, and whether it fires is not independent of which
agent is playing — so throwing them away threw away a non-random third. Any
result computed on a sample with a third of it missing for a
behaviour-dependent reason deserves the suspicion this one turned out to
warrant.

What stands after all of it:

- **The cycle guard is a clear win** and the only unambiguous one: 32
  unfinished games to 2, and a lobby game against a human can no longer hang.
- **The plan layer moves behaviour reliably and strength not at all.**
  `enter-site` take-rate 23.4% → 47.6%, arrivals with nobody to tap 75.1% →
  64.6%, resource plays offered 19 → 31 — every funnel metric, monotonically,
  across five changes. Elo: nothing detectable.
- Both rating methods disagreed in sign on both runs, which remains
  unexplained and is a reason to trust neither one's magnitude.

### Site-deck flow: diagnosed, three fixes, and still not closed

`hand-flow` now reports movement cadence, which is where the remaining gap to
`heuristic` lives. Twelve games:

| | H2 | `heuristic` |
|---|---|---|
| turns / game | 42 | 42 |
| … turns that planned a move | **30%** | **43%** |
| site changes / game | **16.8** | **26.7** |
| distinct sites entered / game | **4.9** | **6.6** |

H2 sits still. The `explain` tree at a declined movement says why in one line:

```text
travel to Lórien: 0.0%
├─ destination: 0
│  ├─ regions crossed: 0  [already here]
│  ├─ travel cost: +0.0  {regionCrossingCost}
│  └─ acquisition modules: +0.0  [items / factions / allies do not exist yet]
```

**A destination with nothing playable on it scores exactly zero, and `pass` is
zero by definition.** Every movement ties with staying put.

Three changes followed, each defensible on its own terms and **none of which
moved the cadence**:

- **A spurious penalty on every lateral move, removed.** `travel` answered a
  movement to any site other than the plan's with `0` — *impossible* — so a
  commitment worth 12 TSD priced every reachable alternative at −3 against
  `pass` at zero. Since the engine only offers destinations reachable this
  turn, a plan for anywhere further made the agent refuse to move at all.
  Cadence: 33% → 32%.
- **Reach graded by distance** (`services/reach`, `reachProbability`). The
  route step was binary, so only a candidate landing exactly on the plan's site
  could move it. It is now `rate^(regions − 1)` on the engine's own inclusive
  region distance, with `planUnroutedReachProbability` re-read as the chance of
  covering one region — no new constant, and progress toward a distant goal
  finally has a value. Cadence: 32% → 31%.
- **The site's printed resource draws, priced.** Movement is how a deck is
  drawn, and the destination model ignored it entirely. Now counted as
  potential at the same `resourceDrawValue` the module already spends on
  `select-company`. Cadence: 31% → 30%.

The one lever that *did* respond is the travel cost. At
`regionCrossingCost=0.05` — an eighth of the shipped 0.4 — distinct sites go
**4.9 → 5.7** against `heuristic`'s 6.8, though moving turns only reach 32%.
Combined with `beliefs` scaling the charge by `(1 + P(opponent holds a
creature))`, which sits near 1.87 with almost nothing seen, the cost of
crossing three regions is around 2.2 TSD against a destination value rarely
above 1. That is the arithmetic keeping the agent at home, and it is a
constant that has never been swept.

**The gap is not closed and none of the three changes is evidence that it can
be closed this way.** What is established is the diagnosis — destination value
is dominated by a travel cost that no gate has ever validated — and one
constant with measured leverage. `sweep --over tunable:regionCrossingCost`
followed by a gate is the next step, and it is a question about a number
rather than about a model.

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

### The scoring loop, measured against the live corpus

Coverage and divergence both answer "which candidate does the agent prefer".
Neither can see a class of candidate that is *never offered*, and that turns
out to be where the game against a human is actually lost.

The live server's recorded games (`~/backup/ai-meccg.com`, 107 completed
human-versus-AI games across 21 distinct human players) are **107–0**. The
per-category marshalling-point breakdown says why in a way the scoreline does
not:

| category | human med/mean | AI med/mean | AI games scoring zero |
|---|---|---|---|
| character | 7.0 / 7.7 | 2.0 / 2.4 | 30/102 |
| item | 6.0 / 6.7 | 0.0 / **0.7** | **77/102** |
| faction | 5.0 / 5.7 | 0.0 / **1.0** | **67/102** |
| ally | 2.0 / 3.0 | 0.0 / 0.1 | **94/102** |
| kill | 2.0 / 2.5 | 2.0 / 2.2 | 22/102 |
| misc | 2.0 / 2.6 | 0.0 / **−1.7** | 65/102 |

The only category the AI keeps pace on is `kill`, which is the passive one —
it happens to you when a hazard connects. `misc` is net *negative*. Items,
factions and allies are near-total zeros, and those three are 15 of the
human's median 42.

That is not a ranking problem, so:

```sh
npm run scoring-loop -w @meccg/sim -- --games 6 --agents h2,heuristic
```

replays games and reports the chain — hold a resource worth playing, build a
company that can carry it, route it to a site where it is playable, play it —
as a funnel of **offered versus taken** per action type. The distinction it
exists to draw is between *never offered* and *offered and declined*. A
scoring action that never appears among the candidates is a break upstream,
and no amount of work on the module that owns it produces a single point; one
offered often and taken rarely is a valuation bug, and the mean fractional
rank when it is declined says how badly.

Two properties of the tally are load-bearing enough to live in a tested module
(`cli/scoring-funnel.ts`) rather than in the CLI. **Offered is counted per
decision, not per candidate** — a site phase offering eleven different
`play-hero-resource` actions is one opportunity to score, and counting eleven
would divide every take-rate by the branching factor. And **rank is
fractional**, because branching here spans two orders of magnitude: 8th of 10
and 8th of 1000 are opposite findings.

#### The baseline, before any of the plan-layer work

Six games, `h2` versus `heuristic`, challenge decks A/B, seeds 1–6. Five
completed; seed 6 hit the decision limit.

```text
category                 h2 (p1)      heuristic (p2)   human median
character         1.5 (0 in 3/6)      3.3 (0 in 0/6)              7
item              0.7 (0 in 4/6)      5.0 (0 in 1/6)              6
faction           2.2 (0 in 2/6)      2.0 (0 in 2/6)              5
ally              0.0 (0 in 6/6)      0.5 (0 in 5/6)              2
kill              6.3 (0 in 0/6)      3.5 (0 in 0/6)              2
misc             -0.8 (0 in 5/6)     -0.8 (0 in 5/6)              2

── h2 (p1) — the chain ──
games where any scoring action was taken: 4/6

action                     offered    taken   take-rate   mean rank when declined
  — enabling —
  plan-movement             16331     8202    50.2%                       0.35
  declare-path                 86       86   100.0%                          —
  enter-site                   93       16    17.2%                       0.99
  — scoring —
  play-hero-resource            4        4   100.0%                          —
  play-minor-item               0        0        —                          —
  faction-influence-roll        0        0        —                          —
  influence-attempt             7        7   100.0%                          —
```

Three things to read off it.

First, **`play-hero-resource` was offered four times in six games, and taken
every time.** The acquisition modules are not declining to score; they are
never asked. `travel`'s own module comment already says why — a destination is
worth only what the cards *already in hand* would pay there, because the
strategic half of §3.3 is unwritten — and that closes a loop with `hand`,
which has no reason to keep a resource for a site the agent will never route
to. `heuristic`, with a cruder model and no such gap, reaches 5.0 item MP a
game against H2's 0.7.

Second, **`enter-site` is declined five times in six, at a mean fractional
rank of 0.99** — effectively dead last whenever it is not taken. That is what
`evaluateEnterSite` is built to say: it prices entering as the value of what
becomes playable minus the site's automatic attacks, so with nothing playable
in hand the realized value is zero and the attacks make the whole thing
strictly negative against `pass` at zero. The model is not wrong; it is being
asked the question after the mistake has already been made.

Third, **`plan-movement` at 16331 offers against `heuristic`'s 228** is not a
preference, it is a loop. Seed 6 spends its entire decision budget on a
period-three `split-company` → `plan-movement` → `merge-companies` cycle,
rotating the planned destination between four sites so that no lap repeats a
state the engine's `regress` flag has seen — every `split-company` mints a
fresh company ID, so the `merge-companies` that follows names a different
company each lap. It is the same family the `h2>mc` composition already
refuses to yield (`NEVER_YIELDED_ACTION_TYPES`), but plain `h2` rides it
alone. Tracked separately from the scoring work.

The `kill` and `misc` rows are the corpus finding reproduced in self-play:
`h2` out-scores `heuristic` on the category that requires no plan, and sheds
points on the one that has no plan behind it.

### Against the humans: what the corpus says the AI does differently

```sh
npm run human-compare -w @meccg/sim -- --dir ~/backup/ai-meccg.com --games 8
```

Every other instrument here measures the AI against something this repository
built — `compare` against another agent, `gate` against another rating,
`coverage` against its own module registry. The live corpus is a better
reference: **107–0** to the humans across 21 players, at a median 42
marshalling points to the AI's 2, with every game on disk as a full state per
decision.

The log does not record which candidate was taken. It does not have to: the
engine is a pure reducer with its RNG **in the state**, so the move is
recovered exactly by applying each candidate to state N and hashing the result
against state N+1. Dice replay identically because the seed travelled with the
position. The next record's `reason` names the acting *type*, which is what
separates "the human chose otherwise" from "the opponent moved" — without it,
in simultaneous phases, every one of the other seat's moves reads as a failed
attribution.

Two things had to be got right before the numbers meant anything, and both
were wrong on the first run. The log lists every candidate the engine
considered, viable or not, with the refusal on `reason` — feeding the rest to
an agent had it playing `not-playable`, an engine marker, 66 times. And
attribution counts only where exactly one candidate of the acted type
reproduces the state; everything else is reported rather than hidden, because
an attribution rate that quietly falls is how a corpus tool starts lying.

Over 8 games and **2642 attributed decisions** (4216 forced, 1024
unattributable, 2 ambiguous):

| the human chose | times | `h2` agreed | `heuristic` agreed |
|---|---|---|---|
| **`pass`** | **1101** | **22.6%** | **20.5%** |
| `draw-cards` | 313 | 100.0% | 100.0% |
| `discard-card` | 196 | 15.8% | 10.2% |
| `select-company` | 122 | 53.3% | 44.3% |
| `pass-chain-priority` | 87 | 39.1% | 5.7% |
| `resolve-strike` | 81 | 79.0% | 40.7% |
| `play-hazard` | 76 | 32.9% | 46.1% |
| `enter-site` | 70 | 82.9% | 88.6% |
| `plan-movement` | 51 | 31.4% | 25.5% |
| **overall** | **2642** | **39.7%** | **35.4%** |

#### The finding: the AI acts when humans do nothing

`pass` is 42% of all attributed decisions and the agreement on it is 22.6%.
What H2 does instead:

```text
167  pass → play-short-event
154  pass → place-on-guard
135  pass → play-hazard
 97  pass → activate-granted-action
 65  pass → discard-card
 36  pass → support-corruption-check
```

Roughly 850 times in 8 games, a human declined to act and the AI spent a card,
a tap or an on-guard placement. `heuristic` does it *more*, so this is not a
Heuristics-2 defect — it is what both agents have in common and what neither
shares with a human.

It is also the tap-out finding from the other side. `hand-flow` reports the AI
arriving at a site with nobody left to tap **75.1%** of the time against
`heuristic`'s 23.4%, holding items it cannot play. A policy that acts whenever
an action prices above zero arrives everywhere spent, and `pass` is zero by
definition — so any action worth a thousandth of a win probability beats doing
nothing, every time, all game.

#### And a caveat this measured rather than argued

**Agreement does not track strength.** H2 agrees with humans on 39.7% of
decisions against `heuristic`'s 35.4%, and `heuristic` scores 4.5 item MP a
game against H2's 0.5. The agent closer to human play is the weaker one.

So this cannot be a fitness function, and converging on it would be the
mistake `compare` already warns about. What it is good for is *localisation*:
it took one run to point at `pass`, which five model changes and two gates had
not managed between them.

#### One attempt at it, and why it cancelled

The obvious reading of "the AI acts when humans pass" is that acting is
under-charged, and there is a documented candidate: `combat`, `factions`,
`hazards` and `kill` all pay the flat `provisionalCardPrice` when they spend a
card, while `card-price` computes a real per-card shadow price. `hand`'s own
assumptions list has recorded that as unfinished since it shipped.

Moving `hazards` and its bundle search onto the real price **changed nothing**:
agreement 39.7% → 39.7%, `pass` 22.6% → 22.6%, with the over-actions merely
swapping places (`pass → play-hazard` 135 → 152, `pass → place-on-guard` 154 →
135). The change is reverted.

The reason is in `card-price`'s own description: a hazard creature *"is worth
what it contributes to `hazard-plan` — the standing assignment of every hazard
in hand to a company it would be played against"*. For a hazard, the shadow
price **is** the value of the play being scored, so charging it against that
play's own gain double-counts and roughly cancels. A shadow price is only an
opportunity cost when it prices the *next-best* use; here it prices this one.

#### What the discards said, and the one change that moved the number

`human-compare --detail discard-card` asks a question a count cannot: when a
human and the agent *both* discard, which card does each name? On 196 discard
decisions the agreement was 15.8%, and 141 of the misses were
discard-versus-discard — so the decision to throw was never in dispute, only
what to throw:

| card class | human | H2 |
|---|---|---|
| `hero-resource-event` | 23 | 9 |
| `hazard-event` | 21 | 8 |
| `hazard-creature` | 17 | 32 |
| **`hero-resource-item` (2 MP)** | **3** | **20** |
| `hero-character` (2 MP) | 2 | 9 |

**The agent throws the scoring cards and keeps the events. Humans do the
opposite.** Sampled over 200 real discard positions, `card-price` ranked the
whole hand at exactly 1.0 — the flat floor — with the MP-bearing cards *below*
it, because a source priced at zero in 63 of those positions (`character`) and
57 (`item`).

The cause is one line, and the floor's own name gives it away. A card whose use
could not be modelled returned `floor`; a card that *could* be priced and came
out at zero returned zero. So an unmodellable hazard event outranked a 2 MP
item whose source happened to be capped. `worth` now applies the floor to every
held card: the residual it stands for — option value, a play the plan has not
found, a future standing where the cap no longer bites — belongs to all of
them, and playing a capped card is precisely how its source stops being capped.

This overturns a deliberate decision, recorded in `hand.test.ts` as *"points in
a capped source are worth nothing to keep"* with a §10.3 citation. Half of that
still holds and is still tested: capped points are worth less than uncapped
ones. The other half — that the cap "will never let them score" — is only true
of a player who never scores anything else.

Measured against the same 8 games and 2642 attributed decisions:

| | before | after |
|---|---|---|
| overall agreement | 39.74% | **40.73%** (+26 decisions) |
| **`pass`** | **22.6%** | **26.6%** |
| `discard-card` (exact card) | 15.8% | **6.6%** |

The first movement on `pass` from any change in this section, and it comes with
a real cost. Flooring **compresses**: cards that differed only below the floor
now tie at it, so the *distribution* of discards moved toward the human's — 2 MP
items thrown 20 → 7, MP characters 13 → 0, events 9 → 39 — while the *exact*
card agreement fell, because the pick among ties is arbitrary. `hand`'s whole
job is to have an opinion about which card to throw, and this flattens it among
the cheap ones.

Net +26 decisions of 2642.

Two follow-ups were tried on that trade-off, and the second refuted the first's
premise.

**Valuing a capped source at the standing the hand would create.** "The cap
will never let them score" is only true of a player who never scores anything
else, so a card's points are now priced by their marginal contribution
*within* the whole hand's potential — `tsdAfter(all of it) −
tsdAfter(all of it but this)` — rather than against today's totals. The fixture
in `hand.test.ts` is the case exactly: 3 item MP on the board, a 4 MP item and
a 2 MP faction in hand, and it is the faction landing beside it that lifts the
cap. Both halves of §10.3 are now pinned by tests — a source that stays capped
however the hand plays is still worth nothing. It is a correct model and it
bought **+1 decision**.

**Sweeping the floor.** The obvious reading of the discard loss is that a floor
of 1.0 is large next to typical card values, so most of the hand ties at it.
Splitting `heldCardFloor` out of `provisionalCardPrice` — one number was doing
two opposed jobs, the price to *spend* a card and the floor under holding one —
made that sweepable:

| `heldCardFloor` | overall | `pass` | `discard-card` |
|---|---|---|---|
| (floor not applied) | 39.74% | 22.6% | 15.8% |
| **1.0** | **40.76%** | **26.6%** | 6.6% |
| 0.5 | 40.12% | 25.2% | 6.6% |
| 0.25 | 40.12% | 25.1% | 6.6% |
| 0.1 | 40.12% | 25.1% | 6.6% |

**Discard agreement does not move at any value.** The magnitude hypothesis is
wrong, and the reason is structural rather than numeric: an unmodellable event
is priced *at* the floor, so anything floored to the same value ties with it
whatever that value is. Lowering the floor lowers both sides together.

Recovering discard discrimination therefore needs what `card-price` said it
did not have — *"hazard events, corruption cards, resources that carry no
points"* had no valuation at all, only the flat price. That is a module to
write, not a constant to tune, and the sweep is what establishes it.

#### The event valuation, and a trade-off that does not go away

`services/event-value` is that module. It is `events`' effect reading lifted
out of the module and into a service, because two consumers now need the same
number: `events` asks what an event achieves at a *named* target, and
`card-price` asks what it would achieve at the best one available. Sharing the
reading is the point — a card the agent pays to play and refuses to keep is an
incoherence nothing in the output would explain.

Extracting it exposed a real mispricing on the way. `events` was charging the
card's *held* value as the cost of playing it, and once `card-price` learned
to value events those became the same number — a card whose only modelled use
is the play being scored, charged against that play's own gain. It is the
identical trap that made moving `hazards` onto the held price achieve nothing,
and it now has a name in both places: **a shadow price is an opportunity cost
only when it prices the next-best use.** `events` charges
`provisionalCardPrice` and holds `heldCardFloor`, which is what splitting the
two constants was for.

The valuation itself **changed no corpus number** — 40.76% before and after,
in either floor configuration. What it did make possible is the tidier floor
rule, applied only to cards nothing can read, and that rule was measured and
**rejected**:

| | overall | `pass` | `discard-card` |
|---|---|---|---|
| floor on every held card | **40.76%** | **26.6%** | 6.6% |
| floor only where unread | 39.48% | 22.2% | **14.3%** |

It buys back most of the discard precision the blanket floor costs and pays
more than it gains, because `pass` is 1101 of those decisions and
`discard-card` is 196. **Five and a half times as many decisions turn on how
reluctant the agent is to spend anything at all as on which card it throws.**

So the floor stays on everything, the reason is recorded in the code, and the
arithmetic could change: value the remaining modelled zeros — a creature the
plan cannot use, a character whose mind does not fit, an event that declares no
effect — and the tidier rule should win.

#### Separating the two jobs the floor was doing

The blanket floor bought agreement on `pass` and paid for it on `discard-card`
because it was doing two things at once: making every discard expensive, which
is right, and flattening every card priced below it into a tie, which is not.

Those are separable, and separating them belongs to `hand` rather than to
`card-price`. What a card is worth to hold is a **valuation**; what throwing one
*costs* is a **decision**. So `worth` returns the modelled value unclamped, and
`hand` charges `heldCardFloor` **plus** that value. Adding is also the more
honest arithmetic — the floor stands for the residual every card carries and
the valuation for the part that is modelled, and a card has both.

| | overall | `pass` | `discard-card` |
|---|---|---|---|
| before any of this | 39.74% | 22.6% | 15.8% |
| clamp the valuation | 40.76% | 26.6% | 6.6% |
| floor only where unread | 39.48% | 22.2% | 14.3% |
| **floor + worth** | **41.14%** | **26.7%** | **12.2%** |

It keeps the whole `pass` gain and recovers most of the discard precision:
+37 decisions on the baseline, +10 on the clamp. It is also the first change
in this section whose result was *predicted* before it was run rather than
discovered afterwards, which is what having the decomposition right looks like.

#### The remaining modelled zeros, counted before being fixed

With the clamp gone, a card priced at exactly zero ranks below everything, so
it is worth knowing which zeros are real. Sampled over 300 recorded discard
positions and 2462 priced cards, **344 came out at zero (14.0%)**:

| cause | cards |
|---|---|
| creature this turn's plan cannot place | **162** |
| character whose mind does not fit the free influence | 50 |
| event that declares no effect | 39 |
| character with no marshalling points | 35 |
| source that stays capped however the hand plays | 28 |
| removal with nothing in play to remove | 23 |

**The creature case dominates and resisted the obvious fix.** `hazard-plan`
already exposes `marginalFor` — *"what a creature not yet held would add,
against the best target with a slot left"* — which is exactly the neighbouring
question a fetch asks. Using it as the fallback rescued **0 of the 162**,
because it asks the same one-turn question under the same hazard limits. The
value of *holding* a creature is what it will be worth on a turn with different
limits and a different board, and nothing in the plan answers that. Recorded
here so the next attempt starts somewhere else.

**The character case did move.** A mind that does not fit the free general
influence is a timing fact, not a valuation — influence is freed by every
character that leaves play — and it is the third instance of the same
present-tense-standing-for-future-probability error as the capped source and
the tapped-out carrier. It is now valued at its projected marshalling points
discounted **twice**, because the discount is distance from playable and this
card is one step further away than one whose mind fits, which is the reading
`hand` already applies to a card going to the discard rather than to the deck.
No new constant.

| | overall | `pass` | `discard-card` |
|---|---|---|---|
| floor + worth | 41.14% | 26.7% | 12.2% |
| **+ mind-does-not-fit** | **41.22%** | 26.7% | **13.3%** |

+2 decisions of 2642 — small in aggregate, and +1.1 points on the 196 discards
where it actually applies.

#### Localising `pass` before changing anything about it

`pass` is 1101 of the 2642 attributed decisions and by far the largest block of
disagreement, so `human-compare --detail pass` now reports *where* it happens
rather than only how often it is missed:

| phase | human passed | agent agreed |
|---|---|---|
| **movement-hazard** | **579** | **15.9%** |
| site | 158 | 48.7% |
| end-of-turn | 144 | 68.8% |
| **organization** | **83** | **0.0%** |
| untap | 48 | 29.2% |
| long-event | 41 | 17.1% |
| free-council | 41 | 12.2% |

Over half of it is one phase, and in `organization` the agent has **never once
passed** across eight games. Broken down by what it did instead:

```text
154  movement-hazard / place-on-guard
135  movement-hazard / play-hazard
 88  movement-hazard / play-short-event
 59  movement-hazard / activate-granted-action
 36  free-council   / support-corruption-check
 30  organization   / plan-movement
```

That is a different picture from "the agent over-acts". It over-acts **as the
hazard player**, and the single largest specific action is one the module
models as *free*.

#### An option that forecloses another is not free

`reducer-site.ts` returns an unrevealed on-guard card to its owner's hand **at
cleanup**, and `hazards` reads that correctly: placement does not spend the
card, and charging half a card price for it — as the module once did — is a
cost the rules do not impose.

What that missed is that cleanup is the *end of the turn*. While the card sits
on a site it cannot be played against a company that has yet to move, so
placement forecloses the alternative use where passing keeps it. `hazard-plan`
already computes what that alternative is worth: the marginal the card
contributes to the turn's assignment if it is played rather than parked. The
two uses are mutually exclusive, so it is a cost and not a double count.

| | overall | `pass` | `play-hazard` |
|---|---|---|---|
| before | 41.22% | 26.7% | 32.9% |
| **+ forgone hazard use** | **41.41%** | 26.7% | **40.8%** |

Spurious placements fell from 154 to 116, and agreement on `play-hazard` rose
**7.9 points** — the largest single-metric movement in this section — because
the cards are now played rather than parked. `heuristic` sits at 46.1% on the
same measure.

It also overturns a recorded decision, and only half of it: the test that said
placement *"costs nothing, because an unrevealed on-guard card comes back"* now
says it does not spend the card and may still cost what it forecloses, and
pins both halves.

#### Two models of one risk, reconciled — and why it barely mattered

Shutting a company to creatures (Stealth, the most-offered short event in the
game) was priced at `defence.expectedHarm(roster, size)` — the whole hazard
plan the opponent could aim at that company, **unscaled**. `travel` prices the
identical risk the other way, at
`pathLength × regionCrossingCost × (1 + beliefs.holdsAtLeastOne('creature'))`.
Two models of one thing, and this was the optimistic one. It is the second
largest of the movement/hazard over-actions, at 88.

Scaling it by the same belief is the obvious reconciliation, and it moved
almost nothing: `pass → play-short-event` 166 → 165, overall agreement
unchanged at 41.41%.

**The reason is worth more than the fix.** Sampled over 400 real
movement/hazard positions:

| `beliefs.holdsAtLeastOne('creature')` | |
|---|---|
| mean | 0.861 |
| p10 / p50 / p90 | 0.790 / 0.862 / 0.939 |
| min / max | 0.650 / 0.978 |
| mean confidence | 0.359 |
| cards observed | 6.9 mean, 12 max |

**The belief model is a constant.** It spans 0.15 across the entire corpus,
because it has seen seven cards of a sixty-card deck. Every consumer that
scales by it is applying a fixed ~14% discount wearing the costume of an
estimate — `travel`'s `(1 + threat)` is a fixed ×1.86, and this new scaling a
fixed ×0.86.

That has two consequences worth recording. Wiring further consumers to
`beliefs` buys nothing until `beliefs` itself discriminates. And it partly
explains the earlier `regionCrossingCost` sweep: the term it multiplies is
constant, so the product behaves like one constant, which is why moving it
moved the cadence smoothly and moved nothing else.

The scaling is kept because two modules pricing one risk two ways is a defect
whatever its current magnitude — but it is recorded as a consistency fix, not
as an improvement.

#### One more over-action ruled out, and a check that the score has not moved

`activate-granted-action` is the last large piece of the movement/hazard block
— 59 there, 20 more in the site phase — and the obvious hypothesis was the
same one that paid off on `place-on-guard`: an action modelled as free.
`grants.costOf` has three branches and one of them returns
`{ tsd: 0, reason: 'the grant declares no cost' }`.

Evaluated over **188 real `activate-granted-action` candidates** from the
corpus, that branch fired **zero** times. 174 charged the tap through
`character-value.tapCost`, 14 took another path, and only 34.6% scored
positive at all — the agent is not taking every grant it is offered. The
hypothesis is wrong and `grants` is left alone.

That is the fourth attempt to reach the over-activity from the *cost* side —
after the flat card price in `hazards`, the held-price experiment, and the
belief scaling — and the third to come back empty. What keeps working is
finding an action whose model is missing a *specific* forgone alternative
(`place-on-guard`), and what keeps failing is looking for a price that is
merely too low.

Separately, every change in this section has been measured on agreement with
recorded human play rather than on the game. Twelve games of `h2` versus
`heuristic` on the stack:

```text
category                 h2 (p1)      heuristic (p2)
character        0.9 (0 in 7/12)     2.9 (0 in 1/12)
item             1.0 (0 in 9/12)     3.8 (0 in 4/12)
faction          2.3 (0 in 6/12)     0.8 (0 in 9/12)
ally            0.0 (0 in 12/12)     1.3 (0 in 4/12)
kill             4.1 (0 in 0/12)     4.7 (0 in 0/12)
misc            -2.1 (0 in 7/12)    -0.7 (0 in 7/12)
outcomes: 12 completed, 0 hit the decision limit
```

Twelve of twelve games finished, which is the cycle guard holding. The
marshalling-point means are not comparable to the earlier n=20 figures and are
not evidence either way at this sample — they are recorded so that a later
gate has something to be surprised by, not as a result.

The cumulative movement from the corpus, over 2642 attributed decisions:

| | overall | `pass` |
|---|---|---|
| before any of it | 39.74% | 22.6% |
| now | **41.41%** | **26.7%** |

That is worth recording rather than rediscovering. It also means the real
missing term is not a mispriced cost at all but the **option value of not
acting yet** — information and flexibility that no service currently
expresses — and inventing a constant for it is exactly the move that has
failed five times in this section already.

Where H2 does beat `heuristic` is worth noting, because it is exactly the
built part of the design: `resolve-strike` 79.0% against 40.7%,
`pass-chain-priority` 39.1% against 5.7%. The calibrated combat modules track
human play closely. `play-hazard`, which H2 owns and has never calibrated,
goes the other way — 32.9% against 46.1%.

### Coverage is no longer the problem

Cross-referencing every action type a human decided in the corpus against the
`ownedActionTypes` of all fourteen modules and the baseline:

| unowned action type | humans decided it | agreed |
|---|---|---|
| `play-permanent-event` | 18 | 33.3% |
| `tap-item-for-strike` | 7 | 0.0% |
| `cancel-strike` | 7 | 0.0% |
| `untap` | 5 | 100.0% |
| everything else unowned | ≤3 each | — |

**Total disagreements on action types no module owns: 34**, against roughly
1550 disagreements overall. H2 owns 47 action types and they cover essentially
every decision a human actually makes. Writing more modules is not what is
left.

What is left is the rows H2 *does* own and gets wrong:

| owned action type | seen | agreed |
|---|---|---|
| **`play-short-event`** | 26 | **0.0%** |
| **`move-to-influence`** | 37 | **8.1%** |
| `play-character` | 14 | 14.3% |
| **`draft-pick`** | 38 | **15.8%** |
| `exchange-sideboard` | 13 | 0.0% |
| `split-company` / `move-to-company` | 7 / 7 | 0.0% / 0.0% |

Two of these are worth more attention than their counts suggest.

**`move-to-influence` is a declared gap, not a bug.** `characters` owns it and
its own docstring says what it does: *"scored as point-neutral with the
influence change reported… the honest shape until the strategic half can say
what that influence is for."* It is owned and unpriced, which `coverage`
counts as covered and the corpus counts as 34 disagreements.

**`draft-pick` compounds.** Thirty-eight decisions is a small count, but they
are the most consequential in the game — the opening draft fixes the starting
company, and every later decision is conditioned on it. A mid-game tap costs a
tap; a draft pick costs the game it sets up. 15.8% agreement on the decisions
that determine everything downstream is a different kind of number from 15.8%
on discards.

Read with the gate results above, the state of the project is: **H2 covers the
game, models it more faithfully than it did, and is still not stronger than
the crude agent it exists to replace.** Coverage was the thing that could be
finished by building, and it has been. What remains cannot be.

### The gate that says not to do any of this

`human-compare` was used over five iterations to drive changes: agreement with
recorded human play went from **39.74% to 41.41%**, `pass` from 22.6% to 26.7%,
`play-hazard` from 32.9% to 40.8%. Every change was measured, several were
reverted when the measurement refused to move, and two real modelling bugs came
out of it — `place-on-guard` was priced as a free option when it forecloses the
card's use for the turn, and `card-price`'s floor ranked a card it could price
*below* one it could not.

Then the same work was gated against `heuristic`, before and after, on
identical seeds with the same paired side-swapped protocol:

| | score | paired Elo | unfinished |
|---|---|---|---|
| before the five iterations | 47.9% | **−14 [−82, +52]** | 0/96 |
| after them | 41.1% | **−62 [−141, +10]** | 0/96 |

**The point estimate moved 48 Elo the wrong way.** The intervals overlap, so
this is not proof of harm — but there is no evidence of gain anywhere in it,
and the direction is consistent across score, Elo and both rating methods.

This was foreseeable and was in fact foreseen. `human-compare`'s own header
records the measurement that should have stopped it: H2 agreed with humans on
**39.7%** of decisions against `heuristic`'s **35.4%**, while scoring **0.5**
item MP a game against `heuristic`'s **4.5**. The agent closer to human play
was already the weaker one. Optimising the proxy anyway, for five iterations,
is how a metric that was explicitly labelled "not a fitness function" became
one.

So the tool keeps its value and the method does not:

- **`human-compare` localises.** It found `place-on-guard` in one run when five
  model changes and two gates had not, and it ruled out four hypotheses —
  `marginalFor`, blanket flooring, belief scaling, and the free-grant branch —
  that reasoning alone would have shipped. As a *diagnostic* it outperformed
  every other instrument here.
- **Agreement must not be the objective.** A disagreement is a position worth
  explaining. A rising agreement rate is not a better agent, and this is the
  measurement that settles it.

The one thing in this section that gated cleanly is the cycle guard: **0
unfinished games in 96, twice**, against 32/96 before it existed.

### What was reverted, and what was kept

The five corpus-driven iterations were merged before the powered gates
finished. The gates then said the combination costs about 33 Elo, so the parts
that earned it have been reverted on their own terms rather than by undoing
the lot.

Gated individually against `heuristic`, 384 games per arm, paired and
side-swapped, zero unfinished games in every run:

| change | paired Elo | kept? |
|---|---|---|
| baseline before any of it | −9 [−42, +24] | — |
| `place-on-guard` forecloses its alternative | −14 [−41, +13] | **kept** |
| `corruption` owns `support-corruption-check` | **+3 [−30, +36]** | **kept** |
| all five iterations together | −42 [−75, −10] | — |
| held-card floor decomposition | *reverted* | no |
| character whose mind does not fit, valued | *reverted* | no |

The two reverted changes are the two chosen because a metric moved. The floor
decomposition was adopted because discard agreement recovered from 6.6% to
12.2%; the mind valuation because agreement gained two decisions in 2642.
Neither had a rule behind it, and neither was gated before it landed.

The two kept changes each had a rules argument that stands without reference
to any agreement number — an unrevealed on-guard card returns at *cleanup*, so
placement commits it for the turn; and an untapped character "may tap for +1
each before the roll", so supporting is worth exactly the failure it averts.
One gates neutral and one gates slightly positive.

That is the whole lesson of this section in one table. A rules argument was
necessary and not sufficient: it predicted which changes would be harmless,
not which would help. An agreement gain predicted neither.

### Why `move-to-influence` is never chosen, and what that exposed

`move-to-influence` is the action H2 owns and gets most wrong: humans make it
37 times in eight recorded games and the agent agrees **once**. It plans
movement instead 25 of those times.

The mechanism is not subtle. `characters` scores it *"as marshalling-point
neutral, which it is"* — exactly zero — and `pass` is zero by definition, so
any action worth a thousandth of a win probability beats it. It is the same
shape as the modelled zeros in `card-price`: a number that is right about the
quantity it names and wrong about the decision it settles.

The rules say what it is actually worth. Releasing a follower to general
influence returns its mind to the controller's **direct** influence, and free
direct influence is exactly what an influence attempt spends. So the value of
the move is what the influence it frees can then attempt — a commitment's
number rather than a tactical one, which is what the plan layer is for.
`factions` owns the check step, so it is the module allowed to move it.

**That change was written, measured, and reverted, because it can never
fire.** Over 200 recorded positions offering `move-to-influence`:

| | positions |
|---|---|
| offering the action | 200 |
| with any committed plan | 130 |
| with a committed **faction** plan | **3** |
| …whose company holds the character being moved | **0** |

#### The portfolio commits at most one goal per company

That is the finding, and it is larger than the action that exposed it.
`conflicts` refuses to commit one company to two different sites, which is
physically right — and a faction plan and a resource plan almost always name
different sites, so they conflict, and the richer resource plan wins. A
company can therefore never be working toward an item *and* a faction, which
is not a rule of the game: a company travels, plays what it can at the site it
reaches, and attempts what is there.

So `factions` proposes constantly and is committed to almost never, which
makes every consumer of a committed faction plan dead code — including the
`move-to-influence` valuation above, and any future one that hangs off the
same step.

This is a modelling restriction rather than a rules constraint, and it is the
first lead in this section that is a *structural* limit of the plan layer
rather than a mispriced number.

### The draft is decided by a coin flip

`draft-pick` is the decision H2 gets wrong most consequentially: 38 in the
recorded corpus at 15.8% agreement, and unlike a mid-game tap these fix the
starting company, so every later decision is conditioned on them.

What humans draft against what H2 drafts, over 35 attributed picks:

| mean of the character picked | human | H2 |
|---|---|---|
| mind | **4.51** | 3.97 |
| marshalling points | **1.43** | 1.29 |
| direct influence | **1.14** | 0.97 |
| prowess | 3.89 | 4.00 |

```text
human Elrond      mind 10, 3 MP, 7 prowess, 4 DI   |   h2 Beretar  mind 5, 2 MP, 5 prowess, 1 DI
human Thorin II   mind  8, 3 MP, 5 prowess, 2 DI   |   h2 Balin    mind 5, 2 MP, 4 prowess, 2 DI
```

Humans take the big characters. But the reason H2 does not is neither mind nor
prowess — it is that **it has no opinion at all**:

```text
draft decisions sampled: 64
  where EVERY candidate quotes at exactly 0: 64 (100.0%)
  candidate quotes at 0: 479/479 (100.0%)
  standing.marginal at draft time: character 0, item 0, faction 0, ally 0, kill 0, misc 0
```

`fetching` prices a draft pick through `card-price.quote`, which prices a
character by its marshalling points *in the current standing*. At the draft the
standing is 0–0, and CoE 10.3 step 4 caps any source at half the total — so
every source is worth zero, every candidate quotes at zero, and the pick falls
through to whatever breaks the tie. 8.6% agreement across roughly ten
candidates is what chance predicts, and chance is what is happening.

`coverage` already names this state — it counts `degenerateStanding` decisions
where "every marshalling-point source is worth zero" — but counts it as a
*valuation* problem to note rather than a decision being made at random. On
the draft it is the whole decision.

#### What the fix is not, and what it has to be

It is not a mind adjustment. Valuing marshalling points better does not help
either: at the draft, character MP is the *only* source in play, so the
half-total cap holds it near zero however it is projected — that is the rule
working correctly, not a modelling error.

What humans are selecting on is not in the model at all. Elrond's 7 prowess
and 4 direct influence are what let a company survive to a site and attempt
what is there — and prowess and direct influence appear nowhere in
`card-price`'s character branch, which reads only `marshallingPoints` and
`mind`. The project prices both elsewhere: direct influence is what an
influence attempt spends (`factions`, `budget.bestInfluencerIn`), and prowess
is what `defence` and `strike/*` resolve combats with.

So this needs a "what is this character worth to have" valuation that the
project does not have, assembled from services that already exist. That is a
piece of work rather than a line, and it is the most consequential decision in
the game — which is the argument for doing it and the reason not to rush a
half-model into the one decision everything else is conditioned on.

### The deck already knew: favourites

The valuation above is still the right long-term answer, and it was the wrong
place to start, because the answer was already written down. Deck files carry a
`favourite` flag on pool entries — `DeckListEntry.favourite`, "whether this is a
favourite character (starting company pick) in the pool" — and both gate decks
star four of their twelve pool characters. Nothing outside the lobby's deck
editor had ever read it.

That flag is not a heuristic about the card; it is the deck author saying which
characters the deck is *built around*. Whether a character's race matches the
factions, whether its influence carries the allies, whether its home site is on
the intended route — none of that is printed on the character, and all of it was
decided when the deck was built.

Measured on the corpus, replaying every attributed `draft-pick` from a game whose
human seat played a deck with favourite marks:

| | picks a favourite | picks the human's exact card |
| --- | --- | --- |
| Human | 75.3% | — |
| Chance (favourites' share of the candidates offered) | 40.6% | — |
| H2 before | 11.3% | 9.3% |
| H2 after | 98.7% | 24.0% |

150 attributed picks. H2 was not merely indifferent to the deck's plan, it was
*anti*-correlated with it — a third of the chance rate — which is what a flat
zero plus a stable tie-break order produces: not a coin flip, a stuck coin.

The change is a definition-ID list carried from the deck file to the draft
state (`PlayerConfig.favourites` → `DraftPlayerState.favourites`), stripped from
the opponent's copy in projection because which characters someone intends to
start with is a statement of their plan, and read in `fetching` as
`favouriteCharacterTsd` (2 TSD, two cards' worth) added to the quote. It binds
no rule: every pool card stays legal to draft, and a large enough quote would
still outweigh the mark if `card-price` ever stops returning zero at 0–0.

Exact-card agreement more than doubled but stopped at 24%, and the ceiling is
structural: a flat bonus makes every favourite tie, so which favourite gets
picked is still the tie-break. Humans distinguish *among* their own favourites,
and doing likewise is what the character valuation above is for. What this
change buys is that the draft now happens inside the right set.

#### It does not show up on the gate

> **Corrected.** Re-measured against a verified `master` by zeroing
> `favouriteCharacterTsd`, the favourites draft is worth **about +51 Elo** — the
> largest verified contribution in the agent. The paragraphs below, concluding
> that it was strength-neutral and kept only on principle, are wrong. They are
> left standing because the *reasoning* for keeping it was sound and the gate
> that contradicted it was not.

384 games against the heuristic champion, paired seeds, side-swapped, with a
control run of the identical gate on `master`:

| | paired Elo (95% CI) | score | failures |
| --- | --- | --- | --- |
| `master` (control) | +76 [+45, +108] | 230W-149L-4D (60.6%) | 1 |
| with favourites | +64 [+31, +99] | 224W-155L-4D (59.0%) | 1 |

−12 Elo against a standard error on the difference of about 24: indistinguishable
from zero, pointing very slightly the wrong way. The one failure is the same
pre-existing engine deadlock in both arms ("no player has a viable action" in
`movement-hazard`), on different seeds — not caused by this change.

**Run the control.** The first reading of this gate compared against a baseline
of −9 [−42, +24] recorded several merged PRs earlier and concluded the change was
worth ~73 Elo. It was not: `master` had moved to +76 in the meantime, and the
whole apparent gain belonged to work already merged. A stale baseline is not a
baseline. Every gate claim in this document is a difference between two arms, and
the control arm has to be run at the same time as the challenger, not read off an
earlier page.

So this is a change that does what it says and that the gate cannot see. It is
kept on the argument that a deck's author declaring which characters the deck is
built around is information the AI should not be throwing away, and on the
agreement measurement above — not on strength.

### Which favourite: the draft is a knapsack

> **Corrected.** Re-measured by zeroing `draftMindPriorityTsd`, this is worth
> **about nothing** (+3, well inside noise) — not the +17 reported below. The
> corpus evidence for the knapsack ordering is unaffected; what it buys in
> strength is not what was claimed.

The mark got H2 drafting inside the right set and could not order within it. A
flat bonus ties every favourite, so *which* one got picked was still tie-break
order, and agreement stalled at 24%.

The rules say what the order is. The starting company's total mind may not exceed
`GENERAL_INFLUENCE`, and `character-draft` already refuses a pick that would break
it — so nothing in the AI has to model the cap. What the cap decides is **order**.
A big character is the one that stops fitting; under the draft's
`opponent-has-card` rule it is also the one an opponent drafting the same
character can take off the table entirely. A small character fits whatever budget
is left in a later round. The expensive picks are the ones with a deadline.

The corpus plays it exactly that way. Over 200 decisions offering more than one
favourite — so the mark alone could not settle them:

| the human picked the candidate with the… | |
| --- | --- |
| highest prowess | 66.0% |
| highest **mind** | 65.5% |
| highest MP | 64.5% |
| highest skills | 51.5% |
| highest body | 50.0% |
| a random favourite | 32.8% |

Prowess, MP, body and skills all correlate with the same picks, which is what
collinear statistics do — big characters are big in every column. What separates
mind from the rest is the *round* profile of the character taken:

| round | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| mean mind | 7.69 | 4.61 | 4.02 | 3.94 | 2.86 |
| mean prowess | 5.86 | 4.10 | 4.28 | 4.39 | 2.14 |

Mind falls monotonically; prowess does not. That is the knapsack signature, and it
is what marks mind as the driver rather than a passenger.

`draftMindPriorityTsd` therefore scales mind against the budget and is capped
strictly below `favouriteCharacterTsd`, so it orders candidates *within* the mark
and never across it — the smallest marked character still outranks the largest
unmarked one. Exact agreement **24.0% → 54.0%** on the same 150 attributed picks.

384 games each, run at the same time:

| | paired Elo (95% CI) | failures |
| --- | --- | --- |
| control (`master`, favourites only) | +64 [+31, +99] | 1 |
| with mind priority | +81 [+46, +117] | 1 |

+17 Elo against a standard error on the difference of about 25 — not significant,
but the first of these changes to point the right way rather than the wrong one.
Both arms hit the same pre-existing engine deadlock once.

An ordering term, not a valuation, is the thing to notice. Mind is a *cost*
everywhere else in the game, and pricing it as a benefit anywhere but the draft
would be wrong. It is right here only because the budget is a knapsack and the
draft is where it gets spent.

### H2 plays every game with no character deck

`add-character-to-deck` is the character deck draft: the characters left over
from the opening draft, each of which may go into the play deck to be drawn and
recruited later. Over twelve recorded human games the agreement on it was
**0.0%**, and there was only ever one thing H2 did instead:

```text
51  add-character-to-deck → pass
```

Fifty-one of fifty-one. `handleCharacterDeckDraftPass` says what that buys, in
its own log line:

```text
Character deck draft: player N passes — K undrafted pool character(s)
removed from the game
```

They go to the out-of-play pile. So this is not an agreement statistic about
which character to prefer — it is the agent throwing its entire reserve of
characters out of the game before turn one, every game, and then playing on with
whatever its starting company survives with. Eight self-play seeds on `master`,
counted at the first decision after setup:

```text
mean per seat — in the play deck 0.00, removed from the game 5.50
```

#### Zero is not a price

Every candidate quotes exactly zero, for two independent reasons and neither of
them is "this character is worthless":

- **The influence gate.** `card-price` prices a character at a hard zero when
  its mind exceeds the *currently free* general influence, on the argument that
  "a mind that does not fit the free general influence is a card that cannot be
  used". That is a statement about now, and it is measured at the one moment in
  the game when the pool is guaranteed to be fully committed: a player who has
  just built a legal starting company has spent all 20. Both seats read
  `influence 20, used 20, free 0` at this step in every game checked.
- **The degenerate standing.** A character marshalling point is worth `+0.0` at
  0–0, because CoE 10.3's half-total diversity cap has nothing to halve on an
  empty board. This is the same reason the opening draft had to be given the
  favourite mark, recorded above under *The draft is decided by a coin flip*.

A flat ranking is then handed to the agent's tie clause, which passes whenever a
`pass` is on offer — correctly, for the busywork it was written for, and
catastrophically here, where `pass` is the destructive option.

`quote` deliberately does not floor, and says why: it answers what a card is
worth *if it arrives*, "which is a question about acquisition rather than
retention, and no measurement here speaks to it". One does now. The floor stands
for the residual — option value, a play the plan has not found, a future
standing where a capped source is no longer capped — and removal from the game
forfeits that residual with certainty. So at this one step, and only this one, a
character is worth at least the floor.

`card-price`'s own note on what is left at a modelled zero already listed the
culprit: *"a creature the plan cannot use, **a character whose mind does not
fit**, and an event that declares no effect."*

#### Measured

Twelve recorded human games, both trees verified before and after:

| | before | after |
| --- | --- | --- |
| `add-character-to-deck` | **0.0%** | **43.1%** |
| overall agreement | 52.70% | 52.92% |
| `pass` | 70.5% | 69.9% |
| characters in the play deck, per seat | **0.00** | **5.00** |
| characters removed from the game, per seat | **5.50** | **0.00** |

The 51 passes become 22 exact agreements and 29 disagreements about *which*
character — which is a real question this change does not answer, and the same
one the opening draft needed the favourite mark for. Nothing else the module
owns moves: `draft-pick`, `fetch-from-pile`, `fetch-from-sideboard`,
`assign-starting-item` and `exchange-sideboard` are unchanged to the decision.

The cost is on `pass`, and it is the honest one: humans stop with one to three
characters still in the pool and H2 now empties it, because deck dilution is not
modelled here and the engine's ten-character cap is the only limit it respects.
Ten decisions where the human passed and H2 takes; net **+11**.

Not gated.

### The discard is a tie-break on the placeholder

With the draft settled, the largest remaining disagreement is `discard-card`,
and it is not close. Over twelve recorded games:

| the human's action | they chose it | H2 agreed |
| --- | --- | --- |
| `pass` | 1437 | 24.8% |
| `draw-cards` | 414 | 100.0% |
| **`discard-card`** | **306** | **7.8%** |
| `resolve-strike` | 164 | 72.6% |
| `select-company` | 160 | 53.1% |

221 of those are decisions where *both* sides chose to discard and named a
different card — the largest same-type disagreement in the corpus.

The two sides throw away different kinds of card, and consistently:

| card class | human discards | H2 discards |
| --- | --- | --- |
| hazard creature | 46 | 20 |
| hazard event | 41 | 23 |
| characters (all) | 25 | 9 |
| resources carrying MP (items, factions, allies) | ~19 | ~67 |

H2 is throwing away the cards that score.

#### The mechanism is the placeholder, not the standing

The obvious guess — the half-total cap zeroing a source, as it does at the draft
— is wrong, and the probe says so: over 300 attributed discard decisions and 2841
priced candidates, **not one candidate quoted zero**. What it found instead:

```text
candidates quoting exactly 0:                        0 (0.0%)
decisions where the cheapest price is a tie:       299 (99.7%)
mean quote of the card the HUMAN discarded:      1.331
mean quote of the card the AGENT discards:       1.000
```

The cheapest price is **exactly `provisionalCardPrice`**, and almost every card
in hand sits on it. `card-price` has a real opinion about a card that scores or
attacks, and no opinion at all about the rest — so they all land on the flat
floor, tie, and the discard falls to whatever breaks ties. The stuck coin again,
in the second-highest-volume decision type in the game.

This is not a hidden bug. `provisionalCardPrice` documents itself as "a
placeholder … one number where there should be a function of the standing, the
deck remaining, and what the hazard side expects to need", and `hand`'s discard
branch says it is pricing "even while that number is still the flat placeholder
rather than a real reservation value". The measurement is what turns a known
placeholder into a ranked piece of work: it decides 306 decisions per twelve
games, more often than every scoring decision combined.

#### What the fix has to be

Not a better marshalling-point estimate — the cards involved mostly have no MP,
which is why they are on the floor. What separates the cards humans throw from
the cards they keep is whether they can ever be **played**: a resource-side deck
holds hazards it can only use during an opponent's movement, and a resource it
has no site, influence or company for is just as dead. `hand-flow` already
measures playability-at-arrival, and `budget`, `exposure` and `hazard-plan`
already price the three conditions separately.

So the next piece is a real reservation value for a held card, which is what
§3.5 asked for in the first place. Recorded here rather than attempted in the
same pass, because `card-price` is the file this project has twice changed on a
metric and twice reverted (see the reverts above) — the fix has to come from what
the rules say a card in hand can do, not from what moves agreement.

### Heuristics 1 was 41% of Heuristics 2

H2 handed decisions it could not rank to H1. Measured over the recorded corpus,
that was not a rare safety net:

```text
decisions with a real choice: 1564
  H2 decided it itself:      919 (58.8%)
  handed to Heuristics 1:    645 (41.2%)

  corruption-check  96.8%      pass           58.7%
  play-hazard       72.5%      discard-card   55.1%
  pass-chain-prio   63.0%      assign-strike  51.0%
```

More than two decisions in five credited to H2 were H1's. Every measurement in
this document — every agreement figure, every gate — was taken on an agent that
was 41% another agent, and every module improvement was being measured on the
fraction of decisions that reached the modules at all. The discard work above
touched under half the discards it was aimed at.

So the fallback was removed. H2 answers everything itself, and what it says when
it has no preference is `pass`: every action costs something the model may not
have priced — a card, a tap, information — and an action with no modelled benefit
has nothing to set against that.

#### What that revealed

| | overall agreement | `pass` agreement | paired Elo vs H1 | failures |
| --- | --- | --- | --- | --- |
| with the H1 fallback | 41.1% | 24.8% | +81 [+46, +117] | 1 |
| without it | **58.7%** | **73.6%** | **−264 [−315, −221]** | **0** |

Both numbers are large and they point in opposite directions.

**Agreement rose seventeen points**, almost all of it on `pass`. H1's eagerness to
act was the single biggest source of divergence from human play; H2's own modules
were closer to human judgement than the agent overruling them two decisions in
five.

**Strength collapsed to 18%.** H2's modules, standing alone, lose badly to H1.
The +81 Elo H2 used to carry was mostly H1's, with the modules adding a little on
top. That is the honest baseline of the modular agent and it had never been
measured, because the agent had never played a game without help.

The mechanism is not subtle: H2 now passes on 41% of decisions, so it declines to
play resources, decline to attack, and declines to score. Passing is the right
answer to a tie and the wrong answer to a decision nobody modelled, and until
those decisions are owned the two are indistinguishable from inside.

The one unambiguous gain: **zero incomplete games**, where every previous gate in
this document hit the `movement-hazard` deadlock once. An agent that declines
instead of acting on a coin flip does not walk into the cycle.

#### The work list, finally ranked by what it costs

The deferral table is the roadmap, because each row is decisions H2 currently
answers with `pass`:

| action type | deferred | what owning it requires |
| --- | --- | --- |
| `pass` | 262/446 | the modules' own opinion about acting at all |
| `discard-card` | 108/196 | the reservation value §3.5 asked for |
| `play-hazard` | 37/51 | `hazards` already prices bundles; this is coverage, not valuation |
| `corruption-check` | 30/31 | nearly untouched |
| `assign-strike` | 26/51 | fell 44.9% → 12.3% on agreement; no `pass` exists in that window, so H2 takes the first candidate |
| `select-company` | 26/114 | |

Reading the gate as a verdict on the removal would be a mistake. It is a verdict
on the modules, taken for the first time without a second agent covering for
them.

### What the modules decline, and what it costs

With H1 gone, "H2 has no opinion" stopped being invisible: it became a `pass`.
Replaying the corpus against the fallback-free agent, **44.3% of decisions are
declined** — and this is what was on the table when it walked away:

| offered when H2 declined | the human took it | action type |
| ---: | ---: | --- |
| 225 | 3 | `play-short-event` |
| 203 | **192** | `discard-card` |
| 123 | 8 | `activate-granted-action` |
| 119 | 0 | `reshuffle-card-from-hand` |
| 96 | 8 | `place-on-guard` |
| 77 | 46 | `assign-strike` |
| 64 | 44 | `play-hazard` |
| 60 | 0 | `transfer-item` |
| 41 | **41** | `corruption-check` |

The right-hand column is the one that matters, and it splits the list cleanly in
two. Declining `play-short-event`, `reshuffle-card-from-hand` and `transfer-item`
costs almost nothing: the human declined them too, nearly every time. Declining
`discard-card` (192 of 203) and `corruption-check` (41 of 41) is wrong nearly
every time.

So the 44.3% is not one problem. It is a small number of decisions where passing
is *always* the wrong answer, sitting inside a large number where passing is what
a good player does anyway — which is also why removing H1 raised `pass` agreement
to 73.6% while collapsing strength.

#### The discount is now unreachable

Re-running the rejected `heldWorth` discount on the fallback-free agent produces
**identical numbers** — 58.7% overall, 12.7% on the discard. Not a small effect: no
effect at all. H2 declines the discard rather than choosing among discards, so a
better price for the card it throws is never consulted.

That is worth stating as a rule, because it nearly cost a second gate cycle: **a
valuation cannot be measured on a decision the agent does not reach.** The order
is coverage first, price second. #2361 was also rejected on a gate that was 41%
H1, so its verdict is void either way — but re-testing it was still wasted, for
this second reason.

**Correction: the discard is not declined.** The paragraph above said it was, on
a probe that counted two different outcomes as one. Measured properly, over 300
corpus positions offering a discard:

```text
H2 passed:                        20
no `pass` was on offer at all:   173
H2 acted on a real preference:   107

not fully covered:                24
best candidate scores <= 0:      292
```

So the discard is usually **forced** — at the end-of-turn hand limit there is no
`pass` to take, which is the rule working as written — and coverage is not the
problem either: only 24 of 300 have an unowned candidate. What is uniform is the
sign. In 292 of 300 positions *every* option scores at or below zero, because a
discard is priced as a pure cost and nothing offsets it. H2 therefore never has a
positive preference here; whether it acts at all depends entirely on whether two
costs differ.

That is the real question, and it is narrower than the three this section
originally listed: not *why H2 declines*, but whether the card it throws when it
must throw one is its own cheapest — and if so, why a better price for that card
(the `heldWorth` discount) changed the outcome by exactly nothing. Those two
cannot both be true, and the next measurement has to settle which is wrong before
anything is built on either.

The earlier three-way question is left below as it was written, because the
reasoning behind option three still stands even though its premise did not — at the end-of-turn hand limit the discard is
forced, so pricing it against a `pass` that the rules will not honour compares an
option against one that is not really available. That is a question with a
definite answer and it has not been asked yet.

### The discard reads the price, and the price names seven cards

The contradiction above is settled, and neither horn was right. Restricted to the
**forced** discard — no `pass` on offer, every candidate a discard — over 179
corpus positions:

```text
H2 threw one of its cheapest-priced cards:  179 (100.0%)
the human threw one of H2's cheapest:       142 (79.3%)
decisions with a tie at the cheapest price: 179 (100.0%)
mean size of that tied set:                 6.93
```

Every line matters:

- **H2 does read the price.** It throws a cheapest-priced card every single time.
  The choice is not bypassing the valuation.
- **The price is not wrong.** The human's card is inside H2's cheapest set four
  times in five. `card-price` already knows which cards are the cheap ones.
- **The price does not *choose*.** It names 6.93 cards as equally cheapest, every
  time, and which of the seven gets thrown is array order.

That arithmetic closes the case: 79.3% ÷ 6.93 ≈ 11.4%, against a measured discard
agreement of 12.7%. The observed disagreement is exactly what picking uniformly
inside the tied set predicts. Nothing else needs explaining.

It also explains why the `heldWorth` discount moved nothing. Scaling hazards to
0.4 and characters to 0.7 does not *order* a hand — it sorts it into three groups,
and the cheapest group is still several cards. A change that turns a seven-way tie
into a four-way tie is invisible to a metric that needs one card named.

#### What the fix has to be, stated exactly

Not a better estimate of what a card is worth: that estimate is already good
enough to bracket the human's choice four times in five. What is missing is a
**total order** on the hand. The requirement is not "price cards more accurately",
it is "never return the same number twice", and those are different engineering
problems — the second is satisfiable by a tie-break the first would call noise.

Measured against the corpus, a purely categorical order — all hazards before all
characters before all resources, MP descending inside each — reaches 22.1% against
a 10.8% chance rate. That is the target to beat, and beating it needs a rule that
separates two hazards, which nothing in `card-price` currently does.

### The pass work list: a forced decision priced against an option that is not there

With H1 gone, every decision H2 cannot rank becomes a `pass`, and the corpus
ranks those by what declining costs. Splitting each type by *why* it was
declined separates two very different problems:

| offered | human took | no owner | owner declined | scored ≤ 0 | scored > 0 | action type |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 43 | **43** | 0 | 0 | **43** | 0 | `corruption-check` |
| 171 | 41 | 0 | 0 | **171** | 0 | `move-to-influence` |
| 116 | 59 | 0 | 0 | 71 | 45 | `enter-site` |
| 114 | 74 | 0 | 28 | 60 | 26 | `assign-strike` |
| 107 | 74 | 0 | 41 | 20 | 46 | `play-hazard` |

Coverage is not the problem anywhere on this list — `no owner` is zero in every
row. Two rows are scored non-positive *every single time*, and those are the ones
where the valuation, not the coverage, is deciding.

#### The corruption check

The clearest case in the corpus: offered 43 times, taken by the human 43 times,
scored at or below zero by H2 all 43 times, and therefore never taken.

Scored absolutely, that is correct — a corruption check is a risk with no upside,
so its expectation cannot exceed zero and `pass` sits at exactly zero. As a
*decision* it is wrong, and the engine says why in its own documentation: a
pending corruption check **"gates all other organization actions until it is
resolved"**. The roll is coming whatever the agent does. Declining does not avoid
it; it freezes the phase in which every resource this player will ever play has
to be played.

So the outcomes still describe the event, and what they are compared against was
the error. Shifting the distribution by its own expectation prices what resolving
costs *relative to the unavoidable baseline* — which is nothing — leaving
`gatingResolutionTsd` for the phase that declining forfeits. σ is untouched,
because the risk is real even when the choice about it is not.

| | corruption-check agreement | paired Elo (95% CI) |
| --- | --- | --- |
| control (`master`) | 27.9% | −241 [−288, −201] |
| taking gating resolutions | **82.4%** | −247 [−295, −206] |

Six Elo apart against a standard error on the difference of about 32:
**strength-neutral**, and the first change since H1 was removed that moves a
decision type sharply toward human play without paying for it. It is kept on the
rules argument — passing does not avoid a gated check — with the gate confirming
it costs nothing, rather than the other way round.

A note on reading these: overall agreement moved 58.7% → 58.1% while this type
went 27.9% → 82.4%, and unrelated types swung hard (`pass-chain-priority` 42.3% →
93.7%). That is not measurement noise. The agent is stateful within a game — the
cycle guard remembers what it has played — so one changed decision moves
everything downstream of it. **Overall agreement is not a valid read on a
single-decision change**, and the per-type figure plus the gate are.

### Priced against an option that does not exist

Two rows of the pass work list turned out to be the same bug, and it is not the
one the rest of this document has been chasing. Neither valuation was *wrong*.
Both were compared against an alternative that is not really available.

| | what it scored | why that was wrong | agreement | paired Elo |
| --- | --- | --- | --- | --- |
| `corruption-check` | ≤ 0 always — a risk with no upside | a pending check gates every other organization action, so declining stalls the phase rather than avoiding the roll | 27.9% → **82.4%** | −247 [−295, −206] |
| `move-to-influence` | exactly 0 — "marshalling-point neutral, which it is" | the freed direct influence is what an influence attempt spends, so declining costs the attempt | 0.0% → **13.8%** | −232 [−276, −194] |

Against a control of −241 [−288, −201], measured identically twice: −6 and +9
Elo, both inside a standard error of about 32. **Strength-neutral, and both move
their decision sharply toward human play.**

The shared shape is worth naming, because it is a different failure from
everything above. A module computes what an action is worth *in isolation*,
correctly, and the agent then compares it against `pass` at zero — as though
declining were free. Where the rules make declining expensive, that comparison
is simply the wrong subtraction, and no amount of improving the valuation fixes
it:

- A corruption check cannot be avoided by passing. The roll is coming; the only
  question is whether the phase moves while it happens. So the risk is **sunk**,
  and pricing the decision means shifting the distribution by its own
  expectation — σ untouched, because the risk is real even when the choice is
  not.
- Moving a follower to general influence is marshalling-point neutral and always
  will be. What it buys is probability on an influence attempt: 2d6 against the
  faction's printed `influenceNumber`, less the influence the company brings.

Both fixes are also correctly **zero most of the time** — a hand with no faction
and no ally has nothing to spend influence on, and the human declines three
offers in four. That is the difference between pricing a decision and inventing
a reason to act.

#### Why this class pays and the discard class did not

Three attempts to make the discard more human-like each cost 41–84 Elo. These
two cost nothing and were found the same way, in the same corpus, on the same
instrument. The distinguishing feature is not the size of the disagreement but
what the human's choice *depends on*:

- What is safe to discard depends on the rest of the player's strategy, which H2
  does not share. The answer does not transfer.
- Whether to resolve a gating check, or whether freed influence buys an attempt,
  depends only on the **rules** and the position in front of both players. The
  answer transfers because the premise does.

So the usable rule is narrower than "imitate the human" and narrower than
"ignore agreement": **agreement locates the decision; the rules decide whether
its answer is portable.** Where a divergence rests on a rule both players are
bound by, copy it. Where it rests on a strategy only one of them has, do not.

### Not acting is a move, and a bad one

**The +110 is unreliable — see the correction at the top of this section.** The
agreement figures stand.

Removing Heuristics 1 left a question the fallback had been answering: what does
H2 do on a decision it cannot rank? The first answer was `pass`, on the argument
that every action costs something the model may not have priced — a card, a tap,
information — so an action with no modelled benefit has nothing to set against
it.

That argument treats passing as the neutral option. It is not. A turn spent
passing plays no resource, attempts no faction and scores nothing, while the
opponent's turn arrives regardless. `pass` is a move with its own cost, and
preferring it on every tie had H2 decline **44% of its decisions**.

So a decision H2 cannot rank now goes to one of the tied best, drawn uniformly,
and `pass` wins a tie only when nothing else is tied with it. Random rather than
first-in-list, because the failure the clause was originally written for is real:
a tie at the top is whichever candidate the stable sort put first, not a
preferred one, and taking it deterministically once had H2 give away two starting
items it had no reason to move. Choosing uniformly removes the false preference
without inventing one.

| | overall agreement | `pass` agreement | score | paired Elo (95% CI) |
| --- | --- | --- | --- | --- |
| passing on a tie | 58.1% | 73.6% | 17.8% | −265 [−311, −225] |
| acting on a tie | **49.0%** | **46.7%** | **29.0%** | **−155 [−195, −119]** |

**+110 Elo**, against a standard error on the difference of about 29 — nearly
four standard errors, and by a wide margin the largest single change measured in
this document.

#### The cleanest disproof of agreement-as-target

Agreement with human play fell nine points overall and twenty-seven on `pass`,
and the agent got much stronger. That is the exact opposite direction from the
discard results, where agreement rose and strength fell three times running, and
between them the two settle the question:

| | agreement | strength |
| --- | --- | --- |
| discard: opportunity discount | ↑ 3 points | −41 Elo |
| discard: retention-only discount | ↑ 3 points | −42 Elo |
| discard: total order | ↑ 4.3 points | −84 Elo |
| **acting on ties** | **↓ 9 points** | **+110 Elo** |

Agreement is not the objective and never was; it is an *instrument*. It found the
draft coin flip, the placeholder discard price, the 41% deferral to H1 — every
one a real defect, none of them findable from win rate alone, because a 20% score
is a single number and the corpus is three thousand labelled decisions.

But the human's *answer* is only portable when it rests on something both players
share. `pass` is the extreme case: the humans in this corpus pass because their
position is developed and they are waiting for the right moment. H2 passes
because it has nothing to say. Those are the same move for opposite reasons, and
copying the frequency copied the reason it did not have.

### The landscape after acting on ties

Every ranking in this document above was measured on an agent that passed
whenever it could not rank a decision. That agent no longer exists, and the
ordering changed with it. Re-measured on twelve recorded games:

| the human's action | they chose it | H2 agreed |
| --- | --- | --- |
| `pass` | 1437 | 46.7% |
| `draw-cards` | 414 | 100.0% |
| `discard-card` | 306 | 7.5% |
| `resolve-strike` | 161 | 69.6% |
| `select-company` | 160 | 56.9% |
| `assign-strike` | 138 | 19.6% |
| `play-hazard` | 138 | 26.8% |
| `pass-chain-priority` | 111 | 93.7% |
| `enter-site` | 106 | 71.7% |
| `corruption-check` | 68 | 80.9% |

And what H2 does instead, which is where the ordering really moved:

```text
253  pass → place-on-guard
213  discard-card → discard-card
170  pass → play-hazard
 64  play-hazard → place-on-guard
```

`place-on-guard` is now the single largest divergence by a wide margin, and it is
the *same* divergence this document already recorded once: "`place-on-guard` is
what the agent does instead of passing 154 times in 8 games". Charging the
forgone hazard use narrowed it and gated neutral (−14 [−41, +13]). Acting on ties
widened it again, because a card with any modelled upside is now taken rather
than declined.

#### The question that has not been asked

Placement is priced by what the card would do *if it is revealed* —
`single.expectedTsd`, discounted by `onGuardDiscount` and reduced by the play it
forgoes. What is nowhere in that chain is the probability that anybody ever walks
into it. A guard card is revealed only when a company enters the site it sits on;
if the opponent goes somewhere else, the card did nothing and the turn spent
placing it bought nothing.

`onGuardDiscount` at 0.5 is standing in for that probability without being
derived from anything — the site the opponent is moving to is *published* when
they reveal movement, and the agent can see it. So the honest next step is to
find out whether placement is being priced against a certainty the position
already contradicts, and that is a measurement, not a constant to tune. Three
attempts at the discard were lost to tuning a constant against a metric; this one
should not be.

### The largest divergence is worth nothing

The obvious next target after acting on ties was `place-on-guard`: 253 decisions
where the human passed and H2 placed a card, plus 64 where they played a hazard
instead — the largest single divergence in the corpus by a wide margin, and the
second time this document has named it as such.

Before pricing anything, two checks. The first killed the hypothesis this
section was going to be about: placement happens in the hazard window against
the **active company**, which has already revealed where it is going, so arrival
is not uncertain and a probability-of-arrival discount would push H2 to place
*more*, not less.

The second was an ablation. `place-on-guard` is priced as a **free option** — the
card returns at cleanup if revealing it would be bad, so the downside is floored
at zero and only the forgone hazard play is charged. Within that model, taking it
whenever there is any upside is correct, which is exactly what H2 does. So: price
placement below every alternative, never place at all, and gate it.

| | paired Elo (95% CI) | score |
| --- | --- | --- |
| placing on guard (`master`) | −155 [−195, −119] | 29.0% |
| never placing on guard | −148 [−188, −112] | 29.8% |

Seven Elo apart against a standard error of about 28. **Placing 253 times and
placing never are the same strength.** The tactic is inert: H2's placements buy
nothing, and removing them costs nothing.

#### Frequency of divergence is not importance

This is the correction the work list needed. `compare` ranks action types by how
often H2 disagrees with the human, and that ordering has been steering this
project — it is how `place-on-guard` reached the top twice, and it is why the
forgone-hazard charge was written for it at all (which also gated neutral, and
now looks like a fix to something that did not matter either way).

A divergence count answers "where does H2 behave differently". It cannot answer
"where does behaving differently cost anything", and those come apart badly: the
largest divergence in the corpus is worth zero Elo, while acting on ties — which
*reduced* agreement by nine points — was worth +110.

The instrument that does answer it is the one used here: **ablate the agent's
opinion on one decision type and gate.** It costs a full gate per type, which is
why it has not been run broadly, but it is the only measurement that ranks
decisions by what they are worth rather than by how often they come up. Run it
before pricing anything, not after.

### What each opinion is actually worth

**Unreliable — see the correction at the top of this section.** The ablation
ranking is a set of differences between gate runs, so the ordering it reports
(hazards ~0, combat 47, movement 94) is unsupported. The *method* — flatten one
group's opinion and re-measure — remains the right instrument, run properly.

`place-on-guard` showed that the largest divergence in the corpus is worth zero
Elo, which made the frequency ranking unusable for deciding what to work on. So
the ablation was run properly: flatten H2's opinion on a group of action types —
the candidates stay, every one scores alike, and the tie rule picks among them
uniformly — and gate. The difference against master is what *knowing which one to
take* is worth.

Flattening rather than removing is what makes it a measure of the opinion. A
removed type leaves its candidates uncovered and never chosen, which measures the
action instead.

| flattened | paired Elo (95% CI) | score | cost of losing the opinion |
| --- | --- | --- | --- |
| — (`master`) | −155 [−195, −119] | 29.0% | — |
| `play-hazard`, `place-on-guard` | −166 [−208, −128] | 27.9% | **−11** |
| `assign-strike`, `resolve-strike`, `choose-strike-order` | −202 [−247, −163] | 24.0% | **−47** |
| `plan-movement`, `enter-site`, `select-company`, `declare-path` | −249 [−299, −207] | 19.5% | **−94** |

Standard error on each difference is about 30.

#### The ordering is the opposite of the one this project has been using

| | divergence rank | worth |
| --- | --- | --- |
| hazards | **1st** — 253 + 64, the largest in the corpus | ~0 Elo |
| combat | mid | 47 Elo |
| movement | low | **94 Elo** |

**The hazard machinery is the most elaborate thing in H2 and it is inert.** The
bundle beam search resolves whole attacks state by state, `hazard-plan` assigns
every hazard in hand to a company, `card-price` prices creatures through that
plan — and replacing all of it with a coin flip costs 11 Elo, inside noise. Every
hazard-side change in this document was tuning something that does not move the
result: the on-guard forgone charge (neutral), the held-hazard discount (−41,
−42), the total order that mostly reordered hazards (−84).

**Movement is where the strength is**, and it has had almost no attention here,
precisely because H2 already agrees with humans about it reasonably often
(`enter-site` 71.7%, `declare-path` 79.4%) and so it never rose up a
divergence-ranked list.

#### What to do with this

Work on movement and combat; stop working on hazards until something explains why
the machinery cannot pay. The three-way split also bounds the whole project: H2 is
−155 against Heuristics 1, and its entire measurable opinion is worth about 140
Elo, so an agent with no opinions at all would sit near −300. The remaining gap to
a *winning* agent is not in refining these three; it is in whatever H2 does not
model at all.

### Movement: H2 is greedier than the human, not blinder

The ablation put movement at 94 Elo — the one place H2's opinion demonstrably
carries the agent — and `plan-movement` is its weakest type. Restricted to
decisions where the human actually planned movement and had more than one
destination, H2 picks the same site 30 times in 64 (46.9%).

The obvious hypothesis was that `travel` cannot see what a destination is *for*:
`regionCrossingCost` is documented in its own tunable as "a stand-in for a hazard
model", and a big enough distance penalty would swamp the playability term. The
measurement says the opposite:

| | mean cards in hand playable at the destination | mean MP playable there | destination plays strictly more |
| --- | --- | --- | --- |
| human | 1.06 | 2.59 | 6 |
| **H2** | **1.36** | **3.41** | **18** |

H2's destinations are *better* on immediate playability, three times as often as
the human's. It is not failing to see what it can play on arrival — it is
optimising that harder than the human does, and still losing.

So the gap is whatever the human is buying instead. Candidates, none of them
measured yet: arriving somewhere survivable rather than somewhere lucrative; a
site that sets up the *next* two turns rather than this one; keeping a company
within reach of a haven. Each is a real MECCG consideration and none of them is
"how many cards does this site let me play now", which is the only thing the
destination score currently maximises.

That is worth recording as a *negative*: the fix everyone would reach for first —
weight playability higher, or cut the distance penalty that hides it — moves
`travel` further in the direction it is already overshooting.

### Movement, second look: a trade, not a blind spot

If H2 is not blind to what it can play on arrival, the next hypothesis was that
the human is buying safety. Measured over the same 64 attributed `plan-movement`
decisions:

| | automatic attacks at the destination | site-path length | site-path danger | hazard draws granted |
| --- | --- | --- | --- | --- |
| human | 0.47 | 2.73 | 4.48 | 2.25 |
| H2 | 0.55 | 2.63 | 4.53 | 2.42 |

**The survivability hypothesis is only weakly supported.** H2's destinations are
slightly more dangerous on two of four measures, no different on a third, and it
actually travels *shorter* paths. None of these gaps would explain a 94-Elo
module choosing differently half the time.

The one clean signal is *which sites*:

| | free-hold | shadow-hold | ruins-and-lairs | border-hold | haven |
| --- | --- | --- | --- | --- | --- |
| human | **19** | 12 | 15 | 9 | 8 |
| H2 | 12 | **19** | 13 | 10 | 8 |

An exact inversion on the two types that differ. Put beside the playability
result — H2's destinations average 3.41 playable marshalling points against the
human's 2.59 — the behaviour is coherent and not obviously wrong: **H2 takes the
richer, more dangerous site and the human takes the safer, poorer one.**

And `travel` is not ignoring the danger half. It runs `defence.harmFrom` against
the site's real automatic attacks (`automaticAttacksOf`), so this is a *trade*
between two modelled quantities, not a missing term. Which means the remaining
lever is the exchange rate between them — and tuning that against an agreement
metric is precisely the move that cost 41, 42 and 84 Elo on the discard.

What is genuinely unpriced is the *other* danger: the hazards an opponent plays
against a company in transit. `beliefs` was measured as effectively a constant
(mean 0.861, span 0.15 over 6.9 observed cards), and `regionCrossingCost` is
documented in its own tunable as "a stand-in for a hazard model" charging
distance by length rather than by danger. If the human's free-holds are worth
more than their playability suggests, that is where the difference would live —
but it is a modelling question, not a constant, and it should be built before it
is weighed.

### Movement, third look: the destination does not explain it

The last hypothesis standing was that a destination's danger is not "more
hazards" but *which* hazards — the rules let an opponent play only creatures
keyed to a region type in the site path, or to the destination's site type, and
`keyedTo: { regionTypes, siteTypes }` is exact card data. So the danger of a
journey is computable from the card pool without any constant at all.

Computed over the same 64 decisions:

| | creatures the rules admit | worst prowess × strikes | mean threat |
| --- | --- | --- | --- |
| human | 72.5 | 35.2 | 16.3 |
| H2 | 73.2 | 35.2 | 16.4 |

**Flat.** Identical on the measure that was supposed to separate them, because
most creatures are keyed to wilderness and nearly every site path crosses one.
The rules-derived threat of a destination barely varies across the destinations
actually on offer.

#### Three hypotheses, three negatives

| hypothesis | prediction | measured |
| --- | --- | --- |
| `travel` cannot see what a destination is for | H2's sites play less | H2's play **more** (3.41 MP vs 2.59) |
| the human buys survivability | H2's sites are more dangerous | marginally, and H2 travels *shorter* paths |
| danger is *which* creatures the path admits | H2's sites admit worse | **identical** (35.2 vs 35.2) |

Taken together these say something more useful than any of them separately:
**the disagreement is not explained by any attribute of the destination.** Three
independent readings of "what is this site worth" all fail to separate a choice
the two sides make differently half the time.

What is left is what a single-decision instrument cannot see. `plan-movement` is
scored as one decision, but a company's route is a *sequence* — this site, then
the site it makes reachable, then the haven it can retreat to — and the human is
choosing a path where H2 is choosing a step. Every measurement in this document
compares one decision against one decision, which is exactly the shape that
cannot detect a difference in plan.

That is a tooling gap before it is a modelling gap. The plan layer exists
(`services/portfolio`, `services/plan-value`) and was measured earlier as
committing at most one goal per company, so the machinery for multi-step
intentions is present and inert. Whether movement is where it should finally pay
is the open question, and answering it needs an instrument that scores a *route*
against the route the human took — which does not exist yet.

### `route-compare`: the company has somewhere to be

Three per-decision measurements failed to explain the movement gap, which is the
signature of measuring the wrong object. `route-compare` measures the sequence
instead: it reconstructs, per company, the ordered destinations the human chose,
and asks the agent at each step where *it* would go.

It is **teacher-forced by construction**, and that bounds every number it
prints. An agent's own route cannot be rolled forward — at its first
disagreement the position leaves the corpus and the opponent's replies are no
longer recorded — so the company follows the human's route and the agent's
sequence is its *first steps from the human's positions*, not a route it walked.
The instrument says so in its own output.

First run, twelve games, 64 attributed movement decisions:

```text
                                        human      agent
  consecutive moves in one region        0.0%      23.4%
  destinations already visited           1.6%      18.8%
  destinations that are havens          12.5%      12.5%
  distinct sites per company             3.71       3.06
  moves per company                      3.76       3.76
```

Two of those are not close.

**The human never moves to the same region twice running.** Zero of forty-seven
transitions. H2 does it on nearly a quarter of its moves.

**The human almost never returns to a site.** One destination in sixty-four had
been visited before by that company, against H2's twelve — and it shows in the
totals: the human's company touches 3.71 distinct sites in 3.76 moves, so its
route is a *tour*, while H2's touches 3.06 in the same 3.76, so its route
doubles back.

The rules say why that matters. A site's resources are played when the company
is there; going back to a site already worked yields nothing it has not already
yielded, and the turn spent travelling is a turn not spent opening a new one. A
company that revisits is a company scoring nothing while the opponent's clock
runs.

That is a defect no per-decision instrument could see, because *every individual
revisit is a defensible destination* — it is a site with playable cards and
survivable danger, which is exactly what the earlier three measurements
confirmed H2 optimises well. It is only wrong in the context of where the
company has already been, and until now nothing was looking at that.

### Charging the company for doubling back

The revisit `route-compare` found is charged rather than forbidden: a return is
sometimes right — a haven is revisited on purpose, and a site can hold a card
the hand did not have the first time. What it should not be is *free*, which is
what it was. The destination score reads the current hand and the printed site,
and neither of those changes when the company has already been there, so only
what the hand has drawn since is actually new.

A correction to how this was first written up: the claim that a worked site
"yields nothing it has not already yielded" does not survive contact with the
state. **No offered destination is ever in the site discard pile** — 0 of 1375 —
because the site card returns to the site deck, and a worked site is offered
again exactly like one never seen. What is true, and checked: neither gate deck
holds a duplicate site (15 distinct, one copy each), so the repeated definitions
`route-compare` counted are genuine returns rather than second copies. The
finding stands; the reason for it is narrower than first stated.

Because the game state records no company history and cannot, the agent
remembers — the same pattern `cycle-guard` uses for positions the engine cannot
mark — and `ModuleContext.visited` carries it to the modules. It records only
movement the agent itself chose, so in corpus replay a route it did not walk
leaves no trace.

| | before | after | human |
| --- | --- | --- | --- |
| consecutive moves in one region | 23.4% | **13.0%** | 0.0% |
| destinations already visited | 18.8% | **11.1%** | 1.6% |
| distinct sites per company | 3.06 | **3.29** | 3.65 |

| | score | paired Elo (95% CI) |
| --- | --- | --- |
| control (`master`) | 29.0% | −155 [−195, −119] |
| charging the revisit | **31.6%** | **−134 [−173, −97]** |

**+21 Elo** against a standard error on the difference of about 29 — inside
noise, and pointing the right way. Kept on that basis plus the shape change,
which is large and one-directional, rather than on a significance claim the
interval does not support.

Worth setting against the discard work, which raised agreement three times and
lost 41, 42 and 84 Elo. The difference is not that this change is more
human-like — it is that `route-compare` measured an object H2 was not modelling
at all, where the discard measured one it was modelling correctly and pricing
against the wrong alternative. **A new instrument found a defect four
measurements on the old one could not**, which is the argument for building
instruments before pricing anything.

### Where the sequence lens does not apply

`route-compare` paid because a route is a genuinely multi-turn object that
nothing in H2 modelled. The obvious move is to point the same lens at every
other sequence in the game. Two were checked and neither is a defect.

**Company shape.** Splitting and merging companies is the clearest structural
decision a player makes across a game, and the corpus offered it constantly:

| offered | human took | H2 took | action |
| ---: | ---: | ---: | --- |
| 236 | 0 | 1 | `split-company` |
| 42 | 1 | 9 | `merge-companies` |
| 0 | 0 | 0 | `move-character-between-companies` |

H2 splits once in 236 offers where the human never splits at all — `defence`
already prices a split as the loss it usually is, and that is working. The merge
gap (9 against 1 in 42) is real but small, and 42 decisions across twelve games
is not where a 134-Elo deficit lives.

**Strike concentration.** Within an attack, whether to pile strikes onto one
character or spread them across the company is exactly the shape of decision
that looks defensible per-strike and matters in aggregate. Over 62 attributed
`assign-strike` decisions, 18 of them with somebody already carrying a strike:

```text
piled another strike onto a character already carrying one
  human 13 (72.2%)    h2 13 (72.2%)
```

**Identical.** The two sides agree on the defender only 33.9% of the time, and
agree exactly on the pattern. So the combat disagreement is not about the shape
of the attack.

It was not wholly about *which* character either, which the section below
corrects: on a third of those decisions H2 named no character at all.

That is worth recording as a boundary on the method. The route worked because it
spans turns, is invisible to the state, and H2 had no representation of it at
all. A sequence resolved inside one window, where both sides already behave the
same way, has nothing for a sequence instrument to find.

### The AI does not assign its own strikes

`assign-strike` is the fourth most common decision the corpus offers a human —
297 of 4892 attributed decisions across twelve games — and H2 agreed on 22.6% of
them. What it did instead was mostly not a different character:

```text
97  assign-strike → pass
97  assign-strike → assign-strike
19  assign-strike → cancel-attack
13  assign-strike → play-short-event
```

**A third of the time the AI declined to assign at all**, and `handleCombatPass`
says what that buys: *"Defender passed — n strike(s) remaining, attacker
assigns"*. Passing in the defender's own assignment step is not a way of
declining to act on the attack. It is a way of letting the opponent choose who
takes what is left of it.

Two defects, both in the attack window of `combat`, and the second explains the
count above.

**A six-strike attack priced as a one-strike attack.** `remainingStrikes`
counted unresolved *assignments*, which is right during resolution and wrong
during assignment: nothing has resolved yet, and the strikes nobody has handed
out — the ones the decision is actually about — are not in that count.

**Passing priced as the assignment the defence would have made for itself.**
Both candidates went through the same sequence enumeration, and it answers every
strike with the company's best remaining parrier. So `pass` was scored as the
attack the defender arranges, and `assign-strike X` as that same attack with the
first strike forced onto X. The first is the **maximum of the second over X**,
so passing could never score below the best assignment available. On a recorded
position — six strikes, one already assigned, the defender holding the rest, now
checked in as `combat/mid-assignment-window` — the two agreed to the last
decimal, and the documented uniform tie-break took it from there:

```text
RANKED (module combat)
  1. Assign strike to Aragorn II
     U = -0.56% win   E[Δtsd] -0.5  σ 0.5  (integrated)
  2. Pass (end your actions this phase)
     U = -0.56% win   E[Δtsd] -0.5  σ 0.5  (integrated)
  ├─ strikes faced: 1  [6 in the attack, 1 still to come]
```

Passing is now priced with the attacker choosing the targets, which is what the
rule gives him — reusing the attacker-chooses search already written for
Cave-drake rather than a second model of the same thing. The strikes already
assigned open the projected sequence for *every* candidate, so `forcedFirst`
becomes a `forced` list; `cancel-by-tap` and `halve-strikes` read it from the
same place, which is what keeps cancelling a pre-assigned Assassin (tw-8) attack
ranked above taking it. Same position:

```text
RANKED (module combat)
  1. Assign strike to Aragorn II
     U = -8.60% win   E[Δtsd] -7.0  σ 2.1  (integrated)
  2. Pass (end your actions this phase)
     U = -9.98% win   E[Δtsd] -8.2  σ 1.7  (integrated)
  ├─ strikes faced: 6  [6 in the attack, 6 still to come]
```

Twelve recorded human games, both trees verified before and after the run:

| | before | after |
| --- | --- | --- |
| overall agreement | 52.70% | **53.11%** (+20 decisions) |
| `assign-strike` | 22.6% | **29.6%** |
| `assign-strike` → `pass` | **97** | **63** |
| `pass` | 70.5% | 70.4% |

#### What was left was a tie, and a tie here is not a coin flip

The remaining passes were not the model preferring to hand the assignment over.
Sampled across a game's worth of them, **23 of 23 are exact ties** — the
attacker's greedy pick and the defence's best parrier name the same character,
usually because only one is left unassigned — and the uniform tie-break
(§*Not acting is a move, and a bad one*) takes half of them. After the pricing
fix `pass` is never scored strictly above the best assignment anywhere in the
corpus.

It cannot be. The defender's choice set *contains* whatever the attacker would
have done with the assignment, so keeping it cannot come out worse: handing it
over is weakly dominated, and a candidate that can at best match the alternative
should not be winning half the flips. That is a dominance argument rather than a
pricing one, and the projection has no way to express it — the two distributions
really are equal — so it is written down as a margin instead.
`concededAssignmentTsd` is an order of magnitude under the enumeration's own
bucket width (0.25 TSD), so it can never overturn a difference the model
resolved, and it is charged in proportion to `handedAssignmentPessimism`, so the
off-switch below still reverts one whole reading rather than half of one.

Measured with `concededAssignmentTsd` at zero against the shipped value, one
binary either side of the margin and nothing else changed. The sample is the
tool's own twelve-game draw re-attributed on the corpus as it stands now — 3533
decisions rather than the 4892 above, so the two tables are each internally
comparable and not comparable to each other:

| | margin off | margin on |
| --- | --- | --- |
| overall agreement | 57.34% | **57.66%** (+11 decisions) |
| `assign-strike` | 21.3% | **41.8%** |
| `assign-strike` → `pass` | **44** | **6** |
| `pass` | 65.8% | 64.9% |

`pass` agreement falls by fourteen decisions and `assign-strike` rises by
twenty-five, which is the trade the §*Not acting is a move* result predicts: the
agent passes less, so it disagrees more often with a human who passed. The six
that remain are in windows this branch does not claim — CvCC assigns in three
phases under different rules (CoE 8.38) and is left to the branch that models
it — or above the margin on the pricing; neither is explained here.

The one reason to hand the assignment over on purpose is real and this model
cannot produce it: letting the attacker take a more vulnerable character so that
he spares the one the company still needs untapped, for an influence attempt or
a faction. The attacker's pick is priced in the defending seat's *own* ledger —
the worst target for the defence is by construction the best one for him — so a
concession that trades the strike for tempo elsewhere would need the two seats
valuing the same character differently. It is recorded on the evaluation as an
assumption rather than approximated with a number.

Not gated. Both readings are one binary away:

```sh
npm run gate -w @meccg/sim -- --challenger h2 \
  --champion 'h2:all/handedAssignmentPessimism=0' --pairs 25 --rounds 4 --jobs 16
npm run gate -w @meccg/sim -- --challenger h2 \
  --champion 'h2:all/concededAssignmentTsd=0' --pairs 25 --rounds 4 --jobs 16
```

What the corpus can say it has said, and the rule the fix reads off
`handleCombatPass` is not a valuation this document needs a win rate to settle.
Whether it is worth Elo is a separate question, and the switches above are how
it gets asked.

### Why H2 scores two points: it is wounded, not slow

`scoring-loop` and `hand-flow` were built before H1 was removed from the agent
and had not been re-run since. Together they locate the scoring failure exactly,
and it is not where any per-decision instrument was looking.

The funnel, eight games:

```text
                        offered   taken   take-rate      heuristic offered
  plan-movement             322     157     48.8%              284
  enter-site                168      94     56.0%              202
  play-hero-resource         23      23    100.0%               39
  influence-attempt          20      17     85.0%                8
```

**H2 takes every scoring play it is offered.** All 23 of them. The valuation is
not the problem; it is offered 23 where Heuristics 1 gets 39, so the break is
entirely upstream.

`hand-flow` says it is not card flow either:

| | h2 | heuristic |
| --- | --- | --- |
| arrivals with nothing playable | 23.8% | 49.5% |
| mean playable cards at arrival | **1.14** | 0.70 |
| mean untapped in the arriving company | **1.04** | 2.33 |
| arrivals with nobody to tap | **44.0%** | 20.8% |

H2 arrives holding *better* cards than H1 and arrives empty-handed half as
often. Then 44% of the time it has nobody able to act. An item needs an untapped
character to carry it — `site.ts` publishes exactly that reason, *"no untapped
character in company"* — so the play is never offered.

#### The obvious fix was wrong, and the metric said so

`tapTempoCost` charges a flat fee for tapping and already prices the influence
attempt a tap forfeits, so the natural move was to price the *site play* it
forfeits too: a company with `p` playable cards and `u` untapped characters
plays `min(p, u)` of them, so tapping costs the marginal card whenever
`u <= p`. That was built.

It made the target metric **worse** — arrivals with nobody to tap went 44.0% to
50.6% — which is the signal to diagnose rather than gate. Splitting the company
by status over four games, every decision:

| | company size | untapped | tapped | wounded |
| --- | --- | --- | --- | --- |
| h2 | 2.66 | 1.17 (44.1%) | 0.57 (21.3%) | **0.92 (34.6%)** |
| heuristic | 2.20 | 1.41 (64.0%) | 0.56 (25.5%) | **0.23 (10.5%)** |

**H2 taps less than H1** — 21.3% against 25.5% — and its companies are *larger*.
The entire difference is wounds: **34.6% against 10.5%, more than three times as
many.** A wounded character cannot carry an item, attempt influence or play a
resource, so the company arrives at the right site, holding the right cards,
with a third of its strength unable to act.

So the scoring failure is downstream of **losing fights**, and tap pricing could
never have fixed it. That also explains why `hand-flow` looked like a tap
problem: wounded and tapped are both "not untapped", and only splitting them
apart distinguishes a choice the agent makes from damage it takes.

The lever is combat and what walks into it — worth 47 Elo by ablation, with
`defence` and the `health` module already present — not the tempo constants.

### Going home: the fix for the wounds

**The +33 is unreliable — see the correction at the top of this section.** The
behavioural figures (recoveries, wounded share, time at a haven) are from
self-play instrumentation and stand.

The wound finding above has a fix, and it is not about combat at all. Over six
games H2 takes *fewer* wounds than Heuristics 1 --- 4.3 a game against 5.7 ---
and recovers from almost none of them:

| per game | h2 | heuristic |
| --- | --- | --- |
| wounds taken | 4.3 | 5.7 |
| **recoveries** | **0.3** | **3.5** |
| decisions with a company at a haven | 24.1% | 46.4% |

Wounds accumulate because the company never goes home. Healing happens at a
haven and nowhere else a company can reach on its own, and H2 is at one half as
often as H1.

Two changes, both in `travel`, and the first is a correction to this document's
own earlier work:

**Havens are exempt from `revisitedSiteCost`.** That charge was added to stop a
company doubling back over sites it had already worked. Its own note said "a
haven is revisited on purpose" --- and then charged it anyway. The one site a
company is *meant* to return to was being priced like a mistake.

**A haven destination is credited with the wounds it heals**, at
`woundTempoCost` --- the same number the modules already charge for *inflicting*
a wound: "out of action until healed, fights at −2 meanwhile, and usually costs
the company a trip to a haven". Healing undoes exactly that, so it is worth
exactly that, and no new constant is invented to say so.

| | recoveries | wounded | time home | paired Elo (95% CI) | score |
| --- | --- | --- | --- | --- | --- |
| control (`master`) | 0.3 | 34.6% | 24.1% | −134 [−173, −97] | 31.6% |
| going home to heal | **1.2** | **28.0%** | **27.0%** | **−101 [−138, −66]** | **35.8%** |

**+33 Elo** against a standard error on the difference of about 27. Every
proximate metric moved with it, which is what distinguishes this from the tap
attempt that preceded it --- that one moved its target metric the wrong way and
was reverted before it reached a gate.

It is still far short of H1's 3.7 recoveries and 13.1% wounded, so the same
thread has more in it: nothing yet prices *when* to go home, only what a haven
is worth once movement is being planned to one.

### When to go home: not a *when* problem

The obvious reading of the healing result was that H2 lacks a rule for when to
turn back. It does not need one. A haven is among the candidates on **99.3% of
all movement decisions**, and on **100%** of the moves made with a wounded
character aboard. It was simply declining them:

| offered a haven with a wounded character aboard | h2 | heuristic |
| --- | --- | --- |
| went home | **10.5%** | 54.3% |

Availability was never the constraint, so nothing needed to decide *when*. What
needed fixing was what a haven is worth once it is already on the list.

#### A certainty should not carry the uncertainty discount

The haven credit was counted as `potential`, which `netTsdDelta` halves by
`potentialDiscount`. That discount exists for a stated reason — "a card in hand
is a card that might never be playable" — and it charges for the chance a
modelled gain never arrives. A haven has no such contingency: the company
arrives and the wounds are gone. Halving a certainty made the one reason to go
home worth less than a speculative play at a scoring site.

Counted as realized instead:

| | before | after | heuristic |
| --- | --- | --- | --- |
| went home when wounded | 10.5% | **18.2%** | 57.8% |
| recoveries per game | 1.2 | **1.8** | 3.5 |
| characters wounded | 28.0% | **26.6%** | 12.9% |
| paired Elo (95% CI) | −101 [−138, −66] | **−103 [−141, −68]** | |

**Strength-neutral** — two Elo apart on a standard error of about 27 — while
every behavioural metric moved toward the reference agent. Kept anyway, on the
grounds that applying an uncertainty discount to a guaranteed outcome is a
modelling error whether or not this gate can see it, and that anything built on
top of the haven price would inherit the error. It is recorded as neutral rather
than as a gain.

One incidental result worth noting: this was the **first gate all session with
zero incomplete games**. Every earlier run hit the `movement-hazard` deadlock at
least once.

#### What the gap still is

18.2% against 57.8% is a third of the way. Behaviour moved and strength did not,
which is the same pattern the discard work showed — and the honest reading is
that the remaining difference is not another mispriced term in `travel`. H1 goes
home because its evaluator is written to; H2 goes home when the arithmetic
happens to favour it. Closing that needs the thing the plan layer was built for
and has never delivered: a company that has *decided* to go home and stays
decided until it arrives.

### A correct fix that cost 87 Elo

**Unreliable — see the correction at the top of this section.** The 87 figure is a
difference between two gate runs from the broken harness, and `master`'s own
verified number is nothing like the control used here. Whether #2397 cost
anything is unknown; the reasoning below stands only as reasoning.

`enter-site` genuinely double-counted a tap. A site's automatic attacks resolve
as part of entering (CoE 2.V.ii), and the resource player "can only take actions
during a company's site phase after that company has successfully entered its
site" (2.V.ii.1) — so a lone defender cannot both parry the attack and tap to
play a card. The module priced it as though it could, which made a near-certain
loss of the character look like a profit. The fix deducted the attack's strikes
from the taps available before pricing what entering unlocks, and came with a
regression scenario captured from the reported game.

It was reviewed against the rules, the citation was checked and found *stronger*
than the one given, the regression test was confirmed to fail without the fix,
and the unit tests passed. **It was not gated.**

| tree | score | paired Elo (95% CI) |
| --- | --- | --- |
| before the fix | 35.8% | −101 [−138, −66] |
| after the fix | 25.3% | **−188 [−230, −151]** |

Confirmed as the only change in the range, and the intervals do not overlap:
**about 87 Elo**, some 3.2 standard errors. Re-measured a second way — holding a
later change fixed and reverting only this one — it is 59 Elo. Either way it is
the largest single regression measured in this project.

The likely mechanism is over-correction rather than error. It deducts *every*
strike of *every* automatic attack from the taps before pricing, so a site with
two strikes and three untapped characters loses two potential plays even when
the attack is trivial and would be parried without tapping. Entering sites is
the only way H2 scores at all, and its entry rate fell from 56% to 45.7% — which
read at review time as "now matches Heuristics 1", and therefore as a good sign.

#### The lesson is about review, not about the fix

Correctness and strength are different questions, and this document has said so
for every change made *to* it — three discard changes that were correct by
inspection and cost 41, 42 and 84 Elo; a total order that was exactly what the
measurement asked for and cost 84. The same standard was not applied to a change
arriving from outside, which was reviewed for correctness alone and endorsed on
that basis.

**A gate is not a formality for other people's changes.** Nothing about the
reasoning in that PR was wrong; the deduction is what the rules imply. It is
still worth 87 Elo to not do it, and no amount of reading the diff would have
revealed that.

The bug is real and should be fixed again, more narrowly — deducting a tap only
where the attack actually threatens the defenders, rather than wherever a site
prints one — and gated before it lands.

### The enter-site error is load-bearing

**Re-measured, and the conclusion holds.** Re-applied onto a verified `master`
and gated with the tree stamped on the run: **45.8%, −29 [−63, +4]** against
`master`'s **+46 [+14, +80]** — the fix costs **about 75 Elo**, some 3.3 standard
errors. The 87 and 100 figures below came from the broken harness and should not
be quoted, but the finding they supported is correct: the double-count is
load-bearing, removing it makes the agent substantially worse, and the revert was
right.

`evaluateEnterSite` prices the cards entering unlocks using the company's
*pre-combat* tap count. That is provably wrong: a site's automatic attacks
resolve as part of entering (CoE 2.V.ii), the resource player may only act
"after that company has successfully entered its site" (2.V.ii.1), and a
character that parries is not still free to tap for a play. One tap is credited
twice.

It has now been fixed twice, correctly, and both fixes are large regressions:

| | score | paired Elo (95% CI) | against its own control |
| --- | --- | --- | --- |
| deduct the strikes from taps (#2397) | 25.3% | −188 [−230, −151] | **−87** |
| the same, plus splitting the attack's harm into what entering *now* costs over entering later | 22.9% | −211 [−252, −174] | **−100** |

The second attempt was built specifically to repair the first. `travel` scores
`pass` at exactly zero, so a more expensive `enter-site` falls below it and a
company that never enters never scores — so the harm was re-priced as mostly
deferred rather than avoided, on the ground that the attack is faced whenever
the company enters. That reasoning still looks right and it made things worse.

**Two independent correct fixes, each costing about 90 Elo, is not two mistakes.
It is a measurement.** The error is compensating for something else.

#### The likely reason, untested

The plays displaced by the attack are not *lost*, they are **deferred**. The
company stays at the site; next turn its characters untap and the cards in hand
are still playable there. Pricing them as forfeited charges the full value of a
play that is merely postponed — the same "deferred, not avoided" error both
fixes corrected on the *harm* side while introducing it on the *play* side.

If that is right, the third attempt would be to deduct the taps and count the
displaced cards as `potential` rather than dropping them, which is the treatment
`travel` already gives cards that fit the site but not this turn's taps.

**Measured, and it is wrong.** Over eight games, resource plays by when they
happen relative to the company's arrival:

```text
                                      h2     heuristic
  … on the turn the company entered  87.0%     100.0%
  … on a LATER turn at that site     13.0%       0.0%
```

A company plays at a site on the turn it enters or not at all — Heuristics 1
never once played on a later turn, and H2 barely does. The displaced plays are
**lost, not deferred**, so pricing them as forfeited was right and the third
attempt is dead before it was built. Why two correct fixes each cost about 90
Elo therefore remains unexplained, and it is not this.

The prerequisite measurement cost one probe instead of a gate cycle and a third
regression, which is the whole argument for writing it down as a prerequisite.

Until then the double-count stays, and it stays *documented*: the model is wrong
here in a known way, it is worth about 90 Elo to leave it wrong, and nobody
should "fix" it a third time without reading this.

### Carrying the wound: measured, and not worth it

Heuristics 1 charges a wounded company for going anywhere but home — it floors a
healing destination and *halves* every non-healing one — and H2 had only the
credit half. Adding the matching charge at the same `woundTempoCost`, so a wound
healed is worth what a wound carried costs, moved the behaviour: characters
wounded fell 26.6% → 20.9%, below H1's own figure in the same games.

It is worth **−18 Elo**: 54.0%, +28 [−4, +60] against `master`'s +46 [+14, +80],
on a verified tree. Neutral to slightly negative, and not merged.

A figure of +157 was briefly claimed for this change. That was `master`'s own
number, measured twice by a harness that could not tell which tree it had read.

#### The cherry-pick that dropped a term

Re-applying it onto current `master` produced a change that did *nothing* — the
gate returned byte-identical results, 214W-163L-7D either way. The cherry-pick
had applied the computation and dropped its use: `master` had independently
changed the same line to add `attackHarm`, git merged both edits without a
conflict, and `persists` survived as a value displayed in the rationale but
absent from the arithmetic. Build, lint and fifteen tests passed, because a value
referenced anywhere is not an unused variable.

What caught it was the measurement coming back *exactly* unchanged on a run
stamped with the correct tree. Before the harness named its own tree, that
signature was indistinguishable from the mislabelling that invalidated a day of
comparisons, and the first instinct would have been to suspect the harness rather
than the code.

### The other work list: what a divergence costs

`coverage` ranks action types by how often they come up. That is the right
ordering for "which module to write next" and the wrong one for "where is the
strength going" — a type that appears two hundred times and costs nothing
outranks one that appears twenty times and loses the game.

`compare` can answer the second question and was throwing the answer away. The
driver has already ranked the candidates and publishes that ranking as
`considered` weights, so the gap between what it scored its own pick and what it
scored the shadow's is a **price** for taking the shadow's move. With `mc`
driving, those weights are mean playout TSD, so the price is score — measured by
playing both moves forward through the real reducer. It costs no extra rollouts.

```sh
npm run compare -w @meccg/sim -- --agents 'mc:rollouts=16/candidates=6/turns=1;h2' --games 2
```

Two things had to be got right before the number meant anything, and both were
wrong in the first version of this table.

**Units are per decision, not per agent.** `mc` cannot determinize a view in
combat, mid-chain, or with effects pending; there it delegates and returns the
*fallback's* weights, which are H1's unitless soup. The first table added those
to mean playout TSD and printed the sum as score — which is how
`resolve-strike` came to be reported at "8.95 TSD" when no rollout had ever
looked at it. Costs are now bucketed by `AgentDecision.weightUnit` and reported
one table per bucket. The split is not cosmetic: with `mc` driving it is exactly
the line between the decisions the rollouts have an opinion about and the ones
where the Monte-Carlo agent *is* Heuristics 1 wearing its name.

**The price is biased in the driver's favour**, because the driver chose the
argmax of its own noisy estimates, so disagreeing with it looks costly even when
the disagreement is the noise. The floor is measurable: drive with the same
agent on both sides. Two games each, `candidates=6/turns=1`:

| driver | shadow | divergences/game | priced | total tsd | per divergence |
|---|---|---|---|---|---|
| `mc:4` | `h2` | 248.5 | 270 | 314.50 | 1.16 |
| `mc:4` | `mc:4` | 88.0 | 166 | 297.75 | **1.79** |
| `mc:16` | `h2` | 237.5 | 242 | 101.75 | 0.42 |
| `mc:16` | `mc:16` | 81.0 | 149 | 111.06 | **0.75** |

**At both budgets the noise floor is higher per divergence than H2's actual
disagreements**, and the whole table shrinks by roughly √4 when the rollout
count goes up by 4 — which is what it should do if most of it is sampling error.
Read the control before reading the table; without it the 4-rollout run says H2
gives up 314 TSD across two games, and what it actually says is that a
four-rollout mean cannot tell H2's choices apart from its own variance.

What survives that subtraction is one row:

| action type | vs `h2` | floor | excess |
|---|---|---|---|
| **`pass`** | **58.75** | **17.38** | **+41.4** |
| `play-hazard` | 12.50 | 7.31 | +5.2 |
| `place-on-guard` | 6.50 | 10.13 | −3.6 |
| `play-short-event` | 1.00 | 11.88 | −10.9 |
| `plan-movement` | 7.13 | 19.44 | −12.3 |
| `activate-granted-action` | 5.31 | 22.88 | −17.6 |

`pass` is 58% of the total cost and the only type clearly above its own floor;
everything else H2 does differently is worth less than `mc` disagreeing with
itself. The divergences read the same way one after another — `mc` passes, H2
taps a character to activate something:

```text
   9.00  pass
         mc     Pass (end your actions this phase)
         h2     Activate remove-self-on-roll on Lure of Nature (Peath taps)
```

**H2 does not know how to do nothing**, and that is a consequence of the design
rather than an accident. A module prices an action *relative to doing nothing*,
`core/baseline.ts` owns `pass` at a flat zero, and the agent takes the argmax —
so any module returning +0.1% outranks passing, every time, and the tap it spent
is never charged against the turn it might have been wanted for.

Note also what this reorders. The coverage work list is led by
`play-short-event` and `play-hazard`; priced by rollouts and net of the floor
they are +5.2 and −10.9. The two lists are not measuring the same thing, and
only one of them is measuring strength.

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

### A card nobody prices is a card that cannot be played

`stage` owns `play-permanent-event` because a stage resource is one, and it
declined every permanent event it did not recognise — described in its own
docstring as *"leaving the decision exactly as covered as it was before"*. That
is not what declining does. The registry drops a candidate whose owner returns
null, so an unrecognised permanent event was not merely unpriced: it was **not
in the ranking at all**, and H2 could not take it however good it was.

`explain` says so plainly, and it is easy to read as a low score rather than an
absent one:

```text
RANKED (module travel, partial — play-permanent-event unscored)
  1. Enter site with Aragorn II's company
```

The card in that hand is Return of the King — three misc marshalling points,
and an effect list of `play-target`s and `play-condition`s the effect reader has
no family for.

Two things follow, and only the second is a valuation.

**The reading was duplicated.** A permanent event is an event: same zone, same
effect DSL, the same shadow price for the card it spends. `events` already reads
all of that through `event-value`, which was extracted for exactly this reason —
*"a second consumer needs the same number and a second copy would be a second
opinion"*. So the whole of what `events` does with a card is now `event-value`'s
`declaredEventEvaluation`, and `stage` calls it for the permanent events it does
not recognise. `events` is a two-line module again.

**A permanent event's printed points are on the table.** It stays in play, so
its marshalling points are scored the moment it lands — like an item or a
faction, and unlike a short event, which is in the discard pile before anything
is counted. That is a reading of *where the card goes*, so it is offered only to
the caller whose card goes there: `creditPoints` is set by `stage` and by
nothing else, and a short event with the same points is still declined.

Over 163 permanent-event offers in twelve recorded games:

| | before | after |
| --- | --- | --- |
| offers the module prices | 88 (54.0%) | **101 (62.0%)** |
| `play-permanent-event` agreement | 11.8% | **26.5%** |
| overall agreement | 52.70% | 52.78% |

Net **+4 decisions of 4892**, which is the honest size of it. The remaining 62
unpriced offers are cards like Gates of Morning and Fellowship — no points, and
an effect the reader has no family for — and they are still declined, which is
still the right answer for them and still means H2 cannot play them.

Not gated.

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

#### How far is that from the strongest agent in the package?

Both numbers on this page are against Heuristics 1 — H2 at +62, `mc` at around
+200 (§ *Flat Monte-Carlo*) — and subtracting two gates is not the same as
playing the match. Played directly, 50 paired side-swapped games:

```sh
npm run gate -w @meccg/sim -- --challenger h2 \
  --champion 'mc:rollouts=4/candidates=4/turns=1' --pairs 25 --rounds 1 --jobs 12
```

```text
  score:     10W-39L-1D (21.0%) over 50 rated games
  elo diff:  -230 [-384, -130]     (95% CI, challenger − champion)
  glicko-2:  -577 [-776, -378]
  failures:  0
```

**The modular AI loses four games in five to a four-rollout flat Monte-Carlo
agent**, and the gap is *wider* than the two H1 gates imply — subtraction
predicts about −140, the match says −230, and the interval does not reach it.
Transitivity is not owed to us; what the direct match adds is that the shortfall
is real and large, and that a paired 50-game run is already enough to see it.

That is the number this section should be read against from here. H2 is stronger
than the agent it was built to replace and much weaker than the cheapest thing
that looks one turn ahead, and the honest reading of the two together is that
pricing decisions well is not yet worth as much as checking them.

#### The first third of that gap: stop falling back to the weakest agent

H2 hands the decisions it cannot price to Heuristics 1. Measured over three
self-play games, that is **16.0% of contested decisions** — a covered ranking
that came out flat, or a partial view whose covered opinion did not clear
`partialCoverageMargin` — and **63.5% of those are views `mc` can determinize**,
so a rollout agent could actually search them rather than defer again.

The fallback was hard-wired. It is now `Heuristic2Options.fallback`, and the
CLI spec composes with `+`:

```sh
# the module tree, with a rollout search behind it instead of Heuristics 1
npm run gate -w @meccg/sim -- --challenger 'h2+mc:rollouts=8/candidates=8/turns=1' \
  --champion h2 --pairs 100 --rounds 1 --jobs 8
```

```text
  score:     121W-78L-1D (60.8%) over 200 rated games
  elo diff:  +76 [+28, +127]      (95% CI, challenger − champion)
  glicko-2:  +221 [+120, +322]
  failures:  0
```

**Both methods clear zero.** A 50-game run at a quarter of that budget
(`rollouts=4/candidates=4`) put it at +28 [−67, +127] — the same direction, and
the reason the budget is worth spending: the search only ever runs on the one
contested decision in six that reaches it, so a fallback can afford eight
rollouts where a whole-game agent has to ration them.

The two agents' blind spots turn out to be close to complementary. `mc` cannot
determinize a view in combat, mid-chain, or with effects pending, and defers
there — which is exactly where H2's modules are strongest. What each does badly,
the other declines to do at all.

`h2+mc` is **not** the default. `h2` still means the module tree with H1 behind
it, because every tool on this page depends on it being cheap, and because the
point of the design is the modules and not the search. The seam is what the
measurement needed, and the number above is what it bought: a third of the
−230 gap, from changing what happens when the modules say nothing.

#### What is left of the gap, and where it lives

The +76 above is measured against plain `h2`. Measured against the thing the
gap is *to*, `h2+mc` is still behind:

```sh
npm run gate -w @meccg/sim -- --challenger 'h2+mc:rollouts=8/candidates=8/turns=1' \
  --champion 'mc:rollouts=8/candidates=8/turns=1' --pairs 50 --rounds 1 --jobs 10
```

```text
  score:     33W-66L-0D (33.3%) over 99 rated games
  elo diff:  -120 [-200, -52]
  glicko-2:  -339 [-482, -196]
```

Read against the −230 of the direct match, the fallback bought about half the
gap and **120 Elo remain**. The shape of what remains is the uncomfortable part:
in `h2+mc` the modules decide about 84% of contested decisions and `mc` decides
the sixth they decline, while plain `mc` decides all of them — and plain `mc` is
120 Elo better. **H2's own decisions are, in aggregate, worse than asking the
rollouts.** That is not an argument for another module.

#### Speaking only when it has something to say

So the near-tie rule is worth revisiting, because the fallback is a parameter
now. H2 hands over a *flat* ranking — every candidate identical — and keeps
everything else, however thin the margin. That was right when the fallback was
Heuristics 1: a thin opinion beats the weight soup. Against a rollout search it
is backwards, and it is not a rare case. Of the decisions H2 keeps on a complete
view, measured over three self-play games:

| top-two gap ≤ | decisions | of those kept |
|---|---|---|
| 0.001 | 291 | 31.5% |
| 0.005 | 438 | 47.4% |
| 0.01 | 578 | 62.6% |

**Nearly a third of what H2 decides is settled by less than a thousandth of win
probability** — a coin flip its own numbers cannot call. `decisiveMargin` is how
far the best candidate must beat its runner-up before H2 keeps a decision it
fully covers; at the shipped 0 the clause cannot fire and nothing changes.

```sh
npm run gate -w @meccg/sim -- \
  --challenger 'h2:all/decisiveMargin=0.002+mc:rollouts=8/candidates=8/turns=1' \
  --champion 'h2+mc:rollouts=8/candidates=8/turns=1' --pairs 50 --rounds 1 --jobs 8
```

```text
  score:     59W-38L-2D (60.6%) over 99 rated games
  elo diff:  +75 [+8, +148]
  glicko-2:  +216 [+72, +359]
```

**Both methods clear zero**, for deferring about a quarter of the decisions H2
was keeping. It is the second-largest gain measured here and it agrees with the
section above: the marginal opinion is the one that is wrong, and the cheapest
way to stop being wrong is to stop having it.

A caution on the knob. It is not monotone-safe — at `decisiveMargin=0.01` the
agent hands over **71.3%** of contested decisions and is mostly its own
fallback, which is a different agent wearing H2's name rather than a better H2.
The value gated here is deliberately small.

#### Asking the fallback what it can actually search

The knob above is a proxy for confidence. There is a better question, and the
divergence bucketing already answered it: `mc` **cannot determinize a view in
combat, mid-chain, or with effects pending**, and there it silently hands the
decision to Heuristics 1. So "ask `mc`" means two different things depending on
the position, and the seam never said which.

`Agent.canDecide(context)` says which. `mc` answers with the same
`isDeterminizableView` test its own `chooseAction` uses, and `h2` gains a
composition operator that routes on it: `>` is `+` that also defers every
decision the fallback reports it can search for itself.

```sh
npm run gate -w @meccg/sim -- --challenger 'h2>mc:rollouts=4/candidates=4/turns=1' \
  --champion 'mc:rollouts=4/candidates=4/turns=1' --pairs 50 --rounds 1 --jobs 12
```

```text
  score:     53W-45L-1D (54.0%) over 99 rated games
  elo diff:  +28 [-40, +99]
  glicko-2:  +82 [-61, +225]
  failures:  1 — a `move-to-company` defect fixed on another branch
```

**H2 now beats the agent this section spent its length chasing**, though by how
much is not pinned down: the interval includes zero.
Against the same champion, on the same decks, the progression is:

| agent | score vs `mc:4/4/1` | elo diff |
|---|---|---|
| `h2` | 21.0% | −230 [−384, −130] |
| `h2:combat,kill,hand,fetching+mc` | 46.5% | −24 [−94, +43] |
| `h2>mc` | **54.0%** | **+28 [−40, +99]** |

An earlier build of `>` measured 62.2% / +87 [+19, +162] and is not the number
quoted, because it **stalled**: two of its 98 games ran to the decision limit
cycling `split-company → plan-movement → merge-companies`, the loop § *Does it
win?* records as fixed. Excluding company-shape decisions from the yield (below)
ends the stall, and the table row is that build. The two samples are ~100 games
each and their intervals overlap heavily, so the drop from +87 to +28 is not
resolvable here — what is certain is that the +87 was measured on an agent that
does not finish every game.

The middle row is the same idea done by hand — name the modules whose windows
`mc` cannot search and let it decide the rest — and it is worth recording
because it is what suggested the general form. Naming modules is the wrong
granularity, though: whether the rollouts can search a decision is a property
of the *position*, not of the action type, which is why asking per decision
beats a hand-picked list by another 111 Elo.

None of this makes the modules better. It makes them stop competing where they
lose: `>` defers **80.3%** of contested decisions, and what H2 keeps is the
fifth of the game where `mc` was never searching in the first place — where its
answer was Heuristics 1 all along, and the modules beat Heuristics 1. The two
agents were never really rivals on the same ground.

##### What must never be yielded, and one broader rule that failed

`split-company`, `merge-companies` and `move-to-company` are kept whatever the
fallback says. Company shape is priced by `defence` as a difference of **one**
potential, `Σ harm(company)` over the whole board, exactly so that a shape
change and its undo cannot both come out positive. A one-turn rollout cannot see
that: `mc` scores splitting a company and merging it straight back at the same
mean TSD to the decimal, and the argmax of that tie oscillates. The engine's
`regress` flag does not catch it, because the planned destination alternates
between two sites and every lap is therefore a state it has not seen.

The obvious general form of that rule was tried first and **is wrong**: hand
back every decision the fallback scored flat, on the grounds that a tie is not
an opinion. It ends the stall and costs the whole gain — **38.9%, about −79 Elo
over 90 games**. At four rollouts with common random numbers `mc` reports
exactly equal means on a large share of *all* decisions, so that rule is not a
tie-break but a policy change back toward plain `h2`, which is the −230 agent.
The exclusion is deliberately the narrow family that demonstrably cycles.

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

### Gating a constant, not just a decision

`sweep` varies a tunable on **one scenario** and prints where the ranking
changes. That answers "is this number on a decision boundary" and cannot answer
"does the number matter", because a constant that flips a decision here and
there may still leave the agent exactly as strong. The second question needs a
strength gate, and a gate could not ask it: `gate` spawns `tsx` children and
hands each one an agent *spec*, so anything it varies has to survive being
written as a string.

So the `h2` spec grammar carries the constants now:

```text
h2[:<modules>][@<temperature>][/<tunable>=<value>...][+<fallback agent>]
```

```sh
npm run gate -w @meccg/sim -- --challenger 'h2:all/tapTempoCost=0.6' \
  --champion h2 --pairs 100 --rounds 1 --jobs 10
```

An unknown name throws at launch rather than being ignored — a dropped
parameter would rate the shipped defaults against themselves and report a dead
heat, which is indistinguishable from a real answer. The overrides are part of
the agent's name (`h2/tapTempoCost=0.6`) for the same reason.

The first constant put through it was `tapTempoCost`, because two separate
things pointed at it: the tunable's own documentation calls 0.3 a value sitting
on a decision boundary, and pricing H2's disagreements with `mc` by `mc`'s own
rollouts leaves `pass` as the one action type clearly above the estimator's
noise floor — H2 spends a tap, the rollouts decline. Four points, 200 paired
side-swapped games each, all against the shipped 0.3:

| `tapTempoCost` | score | elo diff (95% CI) |
|---|---|---|
| 0.15 (½×) | 48.5% | −10 [−59, +37] |
| 0.3 | — | reference |
| 0.6 (2×) | 49.8% | −2 [−50, +46] |
| 1.2 (4×) | 48.0% | −14 [−62, +34] |

**Nothing moves across an 8× range.** Every interval contains zero; pooled over
all 600 games the challengers score 48.8%, which is about −8 Elo and still not
separable from parity. The three point estimates all sitting a little below the
reference is the only hint of structure, and it is far too weak to read as 0.3
being optimal — what it does rule out is the value being badly wrong in either
direction.

So the decision-boundary worry is true and does not matter: the constant flips
individual decisions and does not change who wins. And the `pass` excess is
**not** an under-charged tap. If the cost is right, what is left is the gain —
which is the same place § *Does any of it predict anything?* ends up, from a
different direction.

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
