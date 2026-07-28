# Heuristics 2: Modular, Probabilistic, Explainable AI

*Status: in progress, 2026-07-27. Supersedes nothing yet — Heuristics 1
(`packages/sim/src/ai/`) stays in place and remains the fallback until each
H2 module has independently cleared a gate.*

*Implementation (`packages/sim/src/ai/h2/`): **P0 shipped** — core, the
`standing` service, the fitted `W`, the scenario store, and the `explain` /
`scenarios` / `fit-winprob` CLIs. **P1 in progress** — the `combat` module's
strike window (tap mode, support, strike events from hand) and the attack
window before it (`assign-strike`, `choose-strike-order`, `cancel-attack`,
`cancel-by-tap`, `halve-strikes`), plus the calibration harness of §6.2, which
validates the strike window's claims against the reducer. The attack is
resolved **strike by strike**, carrying the company's condition between
strikes, so the degradation §3.4 relies on is modelled rather than assumed
away. Still outstanding in P1: the `kill` module on top of it, and the
strength gate.*

*The character-value coarseness recorded here earlier is **fixed**: a
`character-value` service now prices a tap by what that particular character
forgoes — an influence attempt requires an untapped character with free direct
influence (`reducer-site.ts`), so tapping the company's best influencer costs
the attempt, scaled by what a faction point is worth in the standing and
therefore correctly zero at the half-total cap. Elimination additionally
prices the follower mind that reverts to the general influence pool. It is a
service on the shared layer per §4, computed from the standing and the roster
rather than from the consumer's decision, so `combat` subtracts it without
`factions` ever being asked about the combat.*

*An open concern about `combat`, from the horizon test and the sweeps
together. The horizon test (§6.4) reports essentially **zero** correlation
between `combat`'s predicted Δtsd and the realized score change at any horizon
— +0.03 at horizon 3 over 263 predictions, the largest sample and the flattest
line of any module. Separately, `sweep --over tunable:tapTempoCost` flips the
decision on `combat/creature-with-body` between 0.0 and 0.5, so the shipped
0.3 sits **on a decision boundary**; `woundTempoCost` by contrast changes
nothing across 0–6 on that position. Read together: the constant that decides
combat's most common choice — tap to fight or stay untapped — is unvalidated
and marginal, while the module's valuation does not track the score at all.
That may be benign, since combat is largely about avoiding loss and its tempo
terms never enter the score; or the tempo constants may be doing work the
marshalling points should. Note also that agreement with Heuristics 1 is **not** evidence either way.
H1 is the weight soup this design exists to replace; converging on its choices
is as likely to mean H2 has acquired its faults as that both found the same
truth. `compare` measures how much behaviour differs so a gate can be sized —
it is not a quality signal, and combat agreement rising from 87.2% to 94.4%
should be read as "there is less for a gate to measure here", nothing more.
Resolving the concern needs a horizon test with more combat-heavy samples, or
a gate that isolates the tap price by running `h2` against itself at two
settings.*

*Two corrections to this document, found by reading the engine:*

- *§3.3 says an eliminated character converts to TSD via lost character MP,
  lost item MP, "plus the opponent's kill MP". The engine sends an eliminated
  character to its **owner's** out-of-play pile
  (`eliminateCombatantFromStrike`); kill MP exists only for defeating
  creatures. Crediting the attacker would systematically overrate defence, so
  the module does not.*
- *Kill MP is all-or-nothing per attack: the creature reaches the kill pile
  only when **every** strike is defeated (`combat-finalize.ts`), and never
  from a detainment attack (CoE 3.II.3) or a site's automatic attack. A single
  parried strike is therefore potential, not income — which is exactly what
  §2.3's `potential` term is for.*

## 1. Motivation

Heuristics 1 scores actions with per-phase evaluators that return **unitless
weights on incomparable scales**: `resolve-strike` returns 20, a movement
destination returns `max(10, mp * 20) + draws*2 - danger`, a body check
returns 100. The numbers are tuned relative to each other by hand inside a
single evaluator and are meaningless across evaluators. Consequences:

- No way to say *why* an action was chosen beyond "it had weight 40".
- No way to improve one area without perturbing others.
- No notion of risk, so the AI plays identically whether it is 40 points
  ahead or 40 behind.
- The heuristic is the behavioural-cloning teacher, and `docs/ai-training-system.md`
  §6 records that BC is bounded by the teacher (a 1520-game BC model still lost
  to RL by −81 Elo). Lifting the teacher lifts the whole learned stack.

Heuristics 2 replaces the weight soup with a **common currency**: every module
answers the same question — *how does this action change my probability of
winning, and how confident is that?* — and shows its work.

## 2. Core design

### 2.1 The common currency: ΔTSD, then ΔP(win)

Every module evaluates a candidate action by producing an **outcome
distribution**: a small enumerated set of outcomes with probabilities that sum
to 1, each carrying a **tournament-score differential** (TSD).

```text
TSD = computeTournamentScore(self.mp, opp.mp) - computeTournamentScore(opp.mp, self.mp)
```

TSD is computed with the real `computeTournamentScore` from
`packages/shared/src/state-utils.ts`, applied to *hypothetical* MP totals. This
matters and is a genuine upgrade over H1's `mp * 20`: marginal MP is **not
linear**. Under CoE §10.3 a marginal point can be worth 2 (opponent has 0 in
that source, so it doubles), 1, or **0** (the source is already at the
half-total cap). H1 cannot see any of this; H2 gets it for free by calling
the engine's own scorer on a projected total.

TSD is not the final utility, because a point is worth much more when the
score is close than when the game is decided. Modules therefore convert
through an empirical **win-probability model**:

```text
W(tsd, turn, phase) -> probability the player eventually wins
U(action) = Σ_outcomes p_i · W(tsd_now + Δtsd_i, turn) − W(tsd_now, turn)
```

Note the expectation is taken over `W` applied to each outcome, **not** `W` of
the mean. This is the whole trick, and it is what makes the user's risk
requirement *emergent rather than hand-tuned*:

- When trailing, the current point sits on the **convex** limb of the sigmoid,
  so spreading outcomes (variance) raises `E[W]` — the module automatically
  prefers the gamble.
- When leading, the point sits on the **concave** limb, so variance lowers
  `E[W]` — the module automatically prefers the safe line.

`W` is fitted from the existing replay corpus (§6.3), not guessed.

### 2.2 The risk knob

An explicit risk posture is still kept, for three reasons: the CLI must be able
to sweep it, tests must be able to pin it, and a human operator may want to
override the fitted curve.

```text
RiskPosture = {
  lambda: number,          // −1 = maximally risk-averse … +1 = maximally risk-seeking
  source: 'fitted' | 'override',
  standing: { tsd, turnNumber, deckRemaining, callableMp, oppCallableMp, ... }
}
```

Default `lambda` is *derived* from the local curvature of `W` at the current
standing, so `fitted` mode and the sigmoid are the same thing expressed twice.
Modules that cannot afford a full distribution (a cheap fallback path) use the
mean-variance shortcut `U ≈ μ + λ·σ`; modules that can, integrate `W` directly.
Both must report which they used.

A **Risk Oracle** service owns all of this and is a shared dependency of every
module — matching the requirement that "essentially all modules take in
risk-level".

### 2.3 Realized vs potential value, and the greed trap

`docs/ai-training-system.md` §10 records a measured failure: blending the raw
score differential into search leaf values *hurt* play (search fell to 2 wins in
12 games), because maximising immediate spread is greedy in a game where MP are
bought with corruption risk and capped by the doubling rule. H2 walks straight
into this trap unless the design forbids it.

Mitigation, mandatory for every module: each outcome's Δ is decomposed into

```text
Δtsd = realized            // MP that actually move now
     + γ · potential       // MP unlocked (playable card reaches its site, item
                           //   reaches a haven to be stored, character freed up)
     − tempo               // turns/taps/cards spent to get there
```

with a single global discount `γ` and an explicit `tempo` term in TSD units.
The anti-greed property is *tested*, not assumed (§6.4): a module's predicted
Δ must correlate with the realized TSD change 3 turns later across the replay
corpus. A module that scores well on immediate MP but fails the horizon test is
rejected.

### 2.4 Explanation as a first-class output

Every evaluation returns a `Rationale` tree alongside the number. This is a
hard requirement, not a debug nicety — the CLI, the golden tests and the tuning
workflow all read it.

```ts
interface Rationale {
  readonly label: string;              // "P(wound | tap to face strike)"
  readonly value: number | string;
  readonly unit?: 'p' | 'tsd' | 'mp' | 'turns' | 'winprob';
  readonly note?: string;              // rule citation, e.g. "CoE 3.iv.3"
  readonly tunable?: string;           // name of the constant that produced it
  readonly children?: readonly Rationale[];
}

interface Evaluation {
  readonly action: GameAction;
  readonly module: string;
  readonly outcomes: readonly { p: number; label: string; dtsd: number }[];
  readonly expectedTsd: number;
  readonly sigmaTsd: number;
  readonly utility: number;            // ΔP(win)
  readonly rationale: Rationale;
  readonly assumptions: readonly string[];  // e.g. "opponent plays no cards into this combat"
}
```

Two invariants enforced by lint-level tests:

- **No anonymous constants.** Any number that is not derived from card data,
  the view, or a probability table must come from a named field of a single
  typed `Tunables` object, and its `tunable` name must appear in the rationale.
- **Probabilities sum to 1** (within 1e-9) and every outcome is reachable.

## 3. Module catalogue

A module owns a set of action types, declares its dependencies on other
modules, and is independently testable. Modules fall into three layers.

### 3.0 Layers

- **Services** — compute shared quantities, own no actions, called by everyone.
- **Acquisition modules** — one per marshalling-point *source*. Each answers
  the same two questions at two levels: *strategic* ("is this source worth
  chasing at all this game, and which targets?") and *tactical* ("act on it
  now?"). This split is the direct consequence of the tournament rules:
  §10.3 doubles and caps **per source**, so each source has its own marginal
  value curve and its own enabling requirements. Bundling them into one
  "resources" module would average away exactly the structure that decides play.
- **Situational modules** — own a bounded sub-game (a strike, a move, a
  corruption check).

### 3.1 Services

| Module | Provides | Notes |
|---|---|---|
| `standing` | TSD now, per-source breakdown, marginal value of +1 MP **in each source** (0, 1 or 2 after doubling and the half-cap), risk posture | The single place `computeTournamentBreakdown` is probed. Every acquisition module asks it "what is a point of faction MP actually worth to me right now?" — frequently the answer is **zero**, and no H1 evaluator can ever know that. |
| `exposure` | Two things. **How much**: site-path length, region types, hazard limit, opponent's hand size. **What kind**: a belief distribution over hidden cards — the opponent's hand and each face-down on-guard card — inferred from their discard pile, cards already played, alignment and deck archetype | Feeds `travel`, `hazards`, `health`, `combat`, and every acquisition module's tactical level. The belief half is the only place hidden-information inference lives; see §3.6 |
| `budget` | Free general influence, per-character free DI (`freeDi`), mind costs, item slots, taps available this turn | The hard constraints every acquisition module competes for |

### 3.2 Acquisition modules (one per MP source)

| Module | Strategic question | Tactical question | Key probability |
|---|---|---|---|
| `items` | Which items in deck/hand are worth chasing, given site requirements, corruption cost and the item cap | Play now, carry, transfer, or store at a haven? | P(reaching the site alive), P(failing the corruption check), P(losing the bearer) |
| `factions` | Which factions are reachable at all — each needs a character with enough **free DI** at a specific site, optionally boosted | Attempt the influence check now, or wait for more DI / a boost card? | P(2d6 + free DI + modifiers ≥ `influenceNumber`), read off the same table the engine uses (`reducer-site.ts`) |
| `allies` | Which allies the site deck can actually reach, and whether the mind/influence they cost is better spent on characters | Play now vs. hold; accept the combat-elimination exposure allies carry | P(site reached), P(ally eliminated given its resistance) |
| `misc` | Whether any misc MP source (stage points, one-off events, stored sites, hoard) is live for this deck | Take the misc opportunity now? | Source-specific; usually deterministic, which makes this the cheapest module |
| `kill` | Is this a kill-point deck — are our companies strong enough that fighting is *income* rather than cost? | **Fight or cancel** the attack that is on the table | Straight from `combat`: P(defeat the creature) × its kill MP vs. P(wound/death) × our loss |
| `characters` | Roster plan: who to bring, mind budget, when a character is worth playing purely for its own MP | Play / recruit / replace now? | Overlaps `health`; see below |

The `factions` case is worth spelling out because it is the clearest example of
the whole design. The engine resolves a faction play as `2d6 + free DI +
modifiers ≥ influenceNumber`, where the modifiers stack from region
restrictions, site-bound cards, game-wide effects, agent bonuses and a *paid*
bonus (discarding an item on declare, e.g. Smaug Roused). The module can
therefore compute, exactly:

- P(success) now, per candidate influencing character;
- P(success) if we wait one turn for a tapped character to untap, or move a
  higher-DI character into the company;
- the value of spending a boost card, in TSD units, against spending it later;
- and — via `standing` — whether the faction MP is worth 2 points (opponent has
  no faction MP, so it doubles), 1, or 0 (our faction source is already at the
  half-cap).

That last term flips the decision outright in real positions, and it is
invisible to H1.

The `kill` module is likewise a thin but high-value layer on `combat`: once
`combat` returns a calibrated outcome distribution for a strike, "fight or
cancel" is a one-line comparison — `E[kill MP gained] − E[our MP lost] − tempo`
versus the cost of the cancel card and what else that card could have cancelled
later. Keeping it separate from `combat` matters because it is a *portfolio*
decision (are we banking kill MP this game?) while `combat` is a tactical one.

### 3.3 Situational modules

| Module | Owns | Depends on | Why it is a good boundary |
|---|---|---|---|
| `combat` | `assign-strike`, `choose-strike-order`, `resolve-strike`, `support-strike`, `body-check-roll`, `cancel-*`, `halve-strikes`, **and every card play available to us inside the combat** — `play-strike-event`, `play-short-event`, `cancel-attack`, `protect-from-assignment`, `cancel-weapon-effects`, `modify-attack`, `tap-item-for-strike`, `tap-ally-body-check-boost`, `flee-from-strike`, `convert-creature-to-ally` | `hand` (card shadow price) | Closed-form: 2d6 vs prowess, then body check. Our own hand is perfect information, so the card options are enumerable, not estimated — only the *opponent's* hand cards are a belief problem (§8). |
| `travel` (travel agency) | `plan-movement`, `move-company`, site selection | `combat`, `exposure`, `corruption`, all acquisition modules | Destination value = what the acquisition modules say is playable there − expected combat loss − exposure − corruption |
| `health` | heal/untap/transfer/store actions, haven trips, character replacement | `combat`, `travel`, `budget` | Wounded/tapped characters are a resource with a known restore cost; replacement has a mind/influence price |
| `corruption` | corruption-bearing plays, item store/drop, `corruption-check` pending | `standing` | Pure probability: check modifiers vs. corruption points; expected MP loss on failure vs. MP gain from carrying |
| `hazards` | hazard play during the opponent's movement/site phases, on-guard placement and reveal | `combat`, `kill`, `exposure`, `hand` | Denial, not damage. Evaluates **bundles** under the hazard limit — see §3.4 and §3.6 |
| `hand` | end-of-turn discard, reset-hand, sideboard exchange; exposes the card **shadow price** service | `standing`, `hazards` | The hazard/resource mix is one shared budget — see §3.5 |
| `endgame` | Free Council call, Sudden Call, deck-exhaustion race, doubling denial, half-cap awareness | all | Sets the clock, and owns the *levers* on the scoring nonlinearities |

Notes on the three the request named first:

- **`combat`.** The dice half is exact: enumerate assignment/order/tap-mode
  choices, apply the modifier stack from `combat-strike.ts` (stay-untapped
  penalty, tapped −1, wounded −2, excess strikes, support +1 each, creature race
  modifiers), read the 2d6 tail, then the body check. Outcomes per character:
  `unharmed | tapped | wounded | eliminated`. Elimination converts to TSD via
  lost character MP, lost carried-item MP, *plus* the opponent's kill MP —
  three terms H1 does not model at all.

  **Our own hand cards are in scope from v1, not deferred.** When we are the
  *defending* side, the cards we can play into the combat are as much a part of
  the decision as the tap-mode choice, and they are the main lever we have over
  a bad attack: cancelling the attack outright, protecting a character from
  assignment, halving strikes, a strike/short event, tapping an item or ally for
  a strike or a body-check boost, `modify-attack`, fleeing. H1's blindness here
  is precisely why it loses characters it did not have to lose. There is no
  hidden information involved — our hand is fully visible to us — so the module
  **enumerates the legal card plays alongside the non-card options and scores
  them in the same units**. A card play is only chosen when its expected TSD
  saving beats the card's shadow price from `hand` (§3.5); that is the entire
  cost side, and it is why `combat` depends on `hand` rather than treating cards
  as free.

  Concretely, the combat decision is a small sequential search over *our*
  options: at each decision point (assignment, pre-strike card window, tap mode,
  body check) the module branches over the legal card plays plus "play nothing",
  evaluates each branch's downstream distribution with the same closed-form
  machinery, and commits to the first action of the best line. The branching
  factor is bounded by the number of combat-relevant cards actually in hand,
  which is small; enumeration is capped and the cap is reported in the rationale
  (§9), same discipline as the hazard bundles.

  What remains assumed is only the **opponent's** side: v1 assumes the attacker
  plays no cards into our defence. That single assumption is recorded in
  `assumptions` and later relaxed by the `hand-cards` belief refinement (§8).
- **`travel` (travel agency).** Explicitly a *recommendation engine over the
  site deck*, not a single-step scorer: it must plan the round trip, because MP
  are frequently only banked at a haven (store item, heal, reset). Its
  destination value is now assembled from the acquisition modules rather than
  computed inline — `travel` asks "what would `items`/`factions`/`allies` pay
  to be standing here?" and subtracts the cost of getting there. Output is a
  ranked destination list with per-destination rationale, which is directly
  what the CLI prints.
- **`health`.** Restore-vs-replace: expected cost of a haven trip (turns,
  exposure) vs. the cost of playing a fresh character (mind, influence, hand
  card) vs. the MP swing of losing the wounded one. H1's
  `hasHealingAvailable`/`hasUntapSource` in `evaluators/common.ts` become inputs
  to this module rather than boolean gates. `health` owns the *tactical* half of
  character management; `characters` owns the strategic half (roster plan), and
  they share the `budget` service.

### 3.4 `hazards`: a bundle problem, not an action problem

Hazard play does not fit the per-action evaluation seam, and pretending it does
would reproduce H1's central weakness. Three properties force a different shape.

**The objective is denial, not damage.** The opponent's MP this turn comes
almost entirely from resource plays during their site phase, and those plays
need *untapped characters to tap*. A company that arrives at its site tapped
and wounded scores nothing, whether or not anyone died. So the module's target
quantity is "untapped characters surviving to the site phase", and its utility
is the **negative of the opponent's expected MP gain**, converted through
`standing` — which correctly reports that denying a faction the opponent cannot
score anyway is worth zero.

**Value is supermodular — bundles beat sums.** Two attacks landed together are
worth far more than the same two attacks in separate turns, because the defence
degrades within a combat: a character that tapped facing the first strike faces
the second at −1, a wounded one at −2, support comes only from untapped
characters, and excess strikes carry their own penalty. Every one of those
modifiers already lives in `combat-strike.ts` and is therefore already in the
`combat` module's model, so `hazards` gets the interaction term for free —
*provided it evaluates the bundle as a unit* rather than scoring each hazard in
isolation. Scoring individually is exactly how you end up dribbling one attack
per turn into a company that shrugs each one off.

**The budget is the hazard limit.** `effectiveHazardLimit` in
`packages/shared/src/engine/hazard-limit.ts` is the per-company cap, fixed at
reveal and modifiable afterwards. That makes bundle selection a knapsack with a
supermodular value function.

Design consequence — **plan then execute**:

1. When the opponent reveals movement, `hazards` enumerates candidate bundles
   from the hand against each target company, subject to the hazard limit.
   Enumeration is beam-searched with an explicit width tunable and a hard cap,
   because the subset space is exponential and this runs in mass self-play.
2. It scores each bundle by running it through `combat` as one combined
   engagement, producing the company's post-combat untapped/wounded/dead
   distribution, then converts to *denied* opponent MP.
3. It **commits a plan**, cached on the module context for that company's M/H
   phase. Each individual hazard-play action is then scored by how well it
   advances the committed plan, and the plan is recomputed only when the state
   deviates from it (a cancel, an on-guard reveal, a hazard-limit change).

**The kill-MP carve-out you named is the sign correction.** Attacking hands the
opponent kill MP whenever they defeat the creatures, so raw denial overstates
the gain. `hazards` nets this out by calling the `kill` module with the sign
flipped: `denied MP − P(creature defeated) × its kill MP`. This is the term
that decides whether a big attack on a strong company is actually a *gift*, and
it is the reason `kill` is listed as a dependency rather than a sibling.

Bundle planning also gives the CLI something worth printing: `explain --module
hazards` shows the ranked bundles with the defender's degradation curve, not a
list of single cards.

### 3.5 `hand`: yes, allocation deserves its own module

Yes — and it should be one module that also exposes a *service*, because its
primary product is a **price**, not a decision.

The scarcity is real and cross-cutting. One deck holds both hazards and
resources, so every card kept as a hazard is a resource not played, and vice
versa. Every acquisition module already faces the question "is this card worth
spending?" — and if each answers it privately, they will answer inconsistently.
That inconsistency *is* how H1's weight soup came about. So:

- `hand` computes a **shadow price** per card: the reservation value in TSD
  units of holding it rather than spending it now, given the standing, the
  turn, the deck remaining, and what `hazards` expects to need next turn.
- Every other module subtracts that price when it proposes to spend a card.
  A resource play must beat *both* the opponent's denial value of the hazard it
  displaces and doing nothing.
- The sharpest consumer is `combat` on defence: "spend this card or lose the
  character" is exactly a price comparison, and it is the case where the price
  must not be a private guess. The same number that tells `hazards` to hold a
  creature back tells `combat` whether cancelling this attack is worth it.
- The target hazard/resource mix is not a constant. It falls out of the risk
  posture: leading means denial is worth more than income (protect the lead);
  trailing means the reverse. This is the same sigmoid curvature from §2.1
  applied to a different budget, which is a good sign the framing generalises.

It also owns genuine actions, which is why it is a module and not a pure
service: the end-of-turn **discard step** and **reset-hand** step
(`reducer-end-of-turn.ts`, steps 1–2), plus sideboard exchanges.

The alternative — folding hand economy into `resources`/`budget` — was
rejected because the price must be *one* number that all consumers share, and
because hazard reservation is a forward-looking quantity that only `hazards`
can estimate. Making it explicit gives it a place to be calibrated (§6.4: does
a high shadow price actually predict a valuable hazard turn?).

### 3.6 On-guard cards: no, split three ways instead

On-guard looks like it wants a module, but the decision decomposes cleanly into
three parts that each already have an owner — and the one part that would need
a new module cannot be measured yet.

**Placement belongs in `hazards`.** Per `specs/2026-04-03-on-guard-plan.md`,
placement costs one card and **counts against the same hazard limit** as an
open hazard, one per company. So a face-down card is literally one fewer open
attack. Pricing it in a separate module would double-spend the budget that
§3.4's bundle knapsack is allocating. It is a *placement option inside the
bundle*, and it adds one dimension the planner must model: **delayed
resolution**. An on-guard creature resolves at the site phase, after the
company has already spent untapped characters facing the open attacks — so the
same creature is worth more on-guard than played openly against a fresh
company. That is §3.4's supermodularity again, crossing a phase boundary, and
the bundle planner gets it right only if placement and open play are chosen
together.

**Reveal belongs in `hazards` too, and is nearly free.** At reveal the hazard
player has full information about their own card, so it is an ordinary
conditional: reveal iff `combat` says the resulting strike improves denial net
of the kill MP it hands over. No new machinery.

**The defender's side belongs in `exposure`, and this is the real work.** "Is
this site worth entering with an unknown card sitting on it?" is an *inference*
problem, not a bluffing one: estimate what the face-down card is from public
information — the opponent's discard pile, what they have already played, their
alignment, how much hazard limit they spent elsewhere. `travel`, `health` and
`combat` all consume that distribution. It is also cleanly testable, which is
the strongest argument for putting it here: predict the identity distribution
of each face-down card, then score the prediction against the card actually
revealed across the replay corpus (log-loss plus a reliability diagram, exactly
as for `W` in §6.3). Note the generalisation — the opponent's *hand* is the same
kind of hidden threat, so one belief service covers both.

**Bluffing is deferred, and the ordering is forced.** Any card may be placed
face-down, so a dead resource card makes a free bluff that returns to hand at
the end of the site phase, costing only hazard-limit budget — which links
straight to `hand`: the cheapest bluff is the lowest-shadow-price card.
Tempting, but deterrence value exists **only against an opponent who infers**.
H1, the BC models and the RL champion do not model on-guard at all, so against
the entire current rating pool a bluff has a deterrent value of exactly zero,
and a bluff module would show no gate improvement. By our own ship criterion
(§6.5) it could never be promoted. Deception therefore cannot be built until
inference ships, and when it is built it must be measured in **H2-vs-H2 mirror
gates**, not against the existing pool. That is a different experiment from
every other module in this plan, which is why it stays out of v1 rather than
being scheduled late.

### 3.7 Why this decomposition and not another

Three properties make a module boundary good here, and each row above satisfies
at least two: (a) it has its own **probability model** that can be calibrated in
isolation against the reducer (§6.2); (b) it owns a **distinct constraint**
(free DI, mind, item slots, hazard limit, taps); (c) it maps to a **separate
MP source**, hence its own marginal-value curve under §10.3. The acquisition
layer exists because of (c) — it is the tournament rules' own decomposition,
not an invented one.

## 4. Architecture

```text
packages/sim/src/ai/h2/
  core/
    types.ts          Evaluation, Rationale, OutcomeDist, ModuleContext
    tsd.ts            hypothetical MP totals -> TSD (wraps computeTournamentScore)
    winprob.ts        W(tsd, turn) sigmoid + fitted coefficients (JSON, versioned)
    risk.ts           Risk Oracle: standing -> RiskPosture, utility integration
    dice.ts           2d6 tail tables, body-check tables, convolutions
    tunables.ts       the single typed constants object
    rationale.ts      builders + text/JSON renderers
    registry.ts       action-type -> module ownership map, dependency wiring
  services/
    standing/ exposure/ budget/
  modules/
    combat/ travel/ health/ corruption/ hazards/ hand/ endgame/  (situational)
    items/ factions/ allies/ misc/ kill/ characters/             (acquisition)
  agent.ts            createHeuristic2Agent(enabledModules)
  scenarios/          fixed sample set (checked in, JSON)
```

Rules:

- Modules consume **only** `PlayerView` + card pool + legal actions, exactly
  like every other agent. No `GameState` access, no cheating.
- Modules are **pure and deterministic**. Randomness only via
  `AgentContext.random`, and no module needs it in v1. The one sanctioned
  exception is the **plan cache** (§3.4, and the strategic cadence in open
  question 4): a module may memoise a committed plan on the `ModuleContext`,
  keyed by a view signature, provided recomputing from scratch yields the
  identical plan. A test asserts exactly that for every cached plan.
- Cross-module calls go through declared **services** (typed interfaces on
  `ModuleContext`), never direct imports, so a module can be tested with a stub
  `combat` service.
- The dispatcher owns action types via `registry.ts`. Any action type with no
  H2 owner falls through to the **H1 evaluator for that phase**. This hybrid
  fallback is what makes per-module shipping and per-module measurement
  possible.
- Existing invariants stay: the cycle guard (`state-signature.ts`) and the
  weighted-sampling seam. H2 returns utilities; the agent converts to a
  distribution (softmax with a temperature tunable) so the noisy variants and
  the BC teacher pipeline keep working unchanged.

### 4.1 Agent registration

`resolveAgent` in `cli/common.ts` gains `h2`, with a module selector for
ablation:

```sh
h2                        # all shipped modules
h2:combat                 # combat module only, H1 everywhere else
h2:combat,kill,factions   # subset
h2:all@0.5                # all modules, sampling temperature 0.5
```

## 5. CLI tooling

New workspace scripts in `packages/sim/package.json`. All output is designed to
be read by a human and diffed by a test.

### 5.1 `explain` — the primary tool

```sh
npm run explain -w @meccg/sim -- --scenario combat/orc-ambush-3v1
npm run explain -w @meccg/sim -- --game alice-vs-bob-1753600000000 --seq 412 --player p1
npm run explain -w @meccg/sim -- --scenario travel/moria-detour --module travel --risk +0.6
```

Flags:

- `--scenario <id>` — from the checked-in fixed sample set.
- `--game <gameIdOrPath> --seq <stateSeq>` — from a live game log
  (`~/.meccg/logs/games/<gameId>.jsonl`, one `state` record per `stateSeq`,
  written by `game-server/src/ws/game-log.ts`). `--hash <h>` optionally asserts
  the snapshot's content hash, so a scenario reference is verifiable and a
  stale reference fails loudly instead of silently explaining a different
  position. This is the "seq id + game hash" addressing the request asks for.
- `--player <p1|p2>` — whose decision to explain (defaults to active player).
- `--module <name>` — restrict to one module's opinions.
- `--risk <λ>` — override the fitted posture.
- `--top <n>` — how many candidates to expand fully (default 5).
- `--json` — machine-readable `Evaluation[]`, for tests and tooling.

Output shape:

```text
Scenario: combat/orc-ambush-3v1   turn 14, movement-hazard, p1 to act
Standing: TSD −7 (p1 22 / p2 29), turn 14/~30 → risk λ = +0.42 (trailing, fitted)

RANKED
  1. resolve-strike Gimli tap-to-fight        U = +2.4% win   E[Δtsd] +1.8  σ 3.1
  2. play-short-event <attack canceller>      U = +1.6% win   E[Δtsd] +3.1  σ 1.4
                                              (card price −1.2 tsd, from `hand`)
  3. resolve-strike Gimli stay untapped       U = +0.9% win   E[Δtsd] +0.4  σ 4.6
  4. support-strike Legolas → Gimli           U = −0.3% win   E[Δtsd] −0.2  σ 2.2

  #1 resolve-strike Gimli tap-to-fight
  ├─ need 8 vs strike prowess 11              [CoE 3.iv]
  │  ├─ base prowess 7, tapped −0, wounded −0, support +1  → effective 8
  │  └─ P(roll ≥ 8 on 2d6) = 41.7%
  ├─ outcomes
  │  ├─ 41.7%  strike defeated, Gimli taps        Δtsd  +0.0  (tempo −0.3)
  │  ├─ 44.4%  Gimli wounded                      Δtsd  −1.1  (potential −0.8 γ)
  │  └─ 13.9%  body check 9 vs body 4 → death     Δtsd  −6.0
  │     ├─ character MP −2, carried items MP −1
  │     └─ opponent kill MP +3                    [CoE 10.3]
  ├─ E[Δtsd] = +1.8   σ = 3.1
  └─ utility = W(−5.2, t14) − W(−7.0, t14) = +2.4% win
  our own hand cards were enumerated (3 combat-relevant, see #2); cap not hit
  assumptions: opponent plays no cards into this combat; no on-guard reveal
```

### 5.2 `scenarios` — build and maintain the fixed sample set

```sh
npm run scenarios -w @meccg/sim -- list [--module combat]
npm run scenarios -w @meccg/sim -- capture --game <id> --seq 412 --as combat/orc-ambush-3v1
npm run scenarios -w @meccg/sim -- capture --seed 7 --decks a,b --at 'turn=14,phase=movement-hazard'
npm run scenarios -w @meccg/sim -- verify        # every scenario still loads & explains
```

A captured scenario stores the full `GameState`, the acting player, a
description, the source reference (`gameId#seq` + content hash, or
`seed/decks/decision`), and an optional human-authored **expectation** ("Gimli
should tap to fight"). Scenarios are the unit of per-module regression testing.
`capture --seed` lets scenarios be generated from self-play without a live game
at all, which keeps the corpus cheap to grow.

### 5.3 `sweep` — decision boundaries

```sh
npm run sweep -w @meccg/sim -- --scenario travel/moria-detour --over risk --from -1 --to 1
npm run sweep -w @meccg/sim -- --scenario combat/orc-ambush-3v1 --over tunable:woundTempoCost
```

Prints the chosen action as a function of one axis, so the effect of the risk
posture (and of any tunable) on a real position is visible rather than
theorised. This is the tool that turns "trailing implies more risk" from an
intention into something observable.

### 5.4 `plan` — the strategic view

`explain` answers "what should I do with this decision". `plan` answers the
other half — the general approach — by asking every acquisition module for its
strategic assessment without reference to any single legal action:

```sh
npm run plan -w @meccg/sim -- --game <id> --seq 412 --player p1
```

```text
Standing: TSD −7 (p1 22 / p2 29), turn 14. Marginal value of +1 MP by source:
  character 1   item 2 (opponent has 0 → doubles)   faction 0 (at half-cap)
  ally 1        kill 2 (opponent has 0 → doubles)   misc 1

PORTFOLIO
  items      chase   E[+6.0 tsd]  2 reachable targets, 1 needs a haven trip
  kill       chase   E[+4.4 tsd]  companies strong enough; 2 cancels in hand
  allies     hold    E[+1.2 tsd]  reachable but competes for the same mind budget
  factions   drop    E[+0.0 tsd]  faction source already capped by the half-rule
  ...
```

The `drop` line is the point of the whole design: H1 would happily spend a turn
and a risky influence check on a faction worth exactly zero points.

### 5.5 `compare`

```sh
npm run compare -w @meccg/sim -- --scenario-set combat --agents heuristic,h2:combat
```

Per-scenario side-by-side of H1's and H2's choice with both rationales, plus an
agreement rate. Cheap, and it catches "H2 is now doing something insane in an
area nobody was looking at".

## 6. Testing strategy

Each module is validated at four independent levels. Level 2 is the one that
makes "modules are independently tested and improved" real.

### 6.1 Unit tests

Standard vitest, colocated (`modules/combat/combat.test.ts`), covering the
probability maths against hand-computed values and the tunables' edge cases.

### 6.2 Calibration tests — predicted probability vs. the real reducer

A module claims `P(wounded) = 44.4%`. The harness takes the scenario's
`GameState`, runs N seeded rollouts through the **real reducer** with a policy
that respects the module's assumptions (the opponent plays no cards; our own
card plays are replayed exactly as the module chose them), and asserts the
empirical frequency lies inside the binomial CI of the claim. Card-play lines
are calibrated the same way as dice lines — a claimed "cancelling this attack
saves 3.1 tsd" must survive the reducer.

This reuses infrastructure that already exists: seeded `RngState`, the pure
reducer, and `search/determinize.ts` for sampling hidden information. A module
whose probabilities are wrong is caught immediately and unambiguously, which is
exactly the property H1's weights can never have.

```sh
npm run calibrate -w @meccg/sim -- --module combat --rollouts 5000
```

### 6.3 Fitting and validating `W`

Fit `W(tsd, turn)` on the existing replay corpus (the value-head analysis in
`docs/ai-training-system.md` §9 already establishes that raw score
differential predicts the winner at 0.56 / 0.63 / 0.68 / 0.79 sign accuracy by
game quarter, so the signal is real and the fit target is known). Hold out
games; report Brier score and a reliability diagram. Ship the coefficients as a
versioned JSON next to the code with the corpus size recorded, mirroring how
weights files are handled today.

Guard rail from §9 of that document: **value sample size is games, not
decisions**. The fit must be evaluated on held-out *games*.

### 6.4 Horizon test — the anti-greed check

For each module, over replayed games: correlate the module's predicted `Δtsd`
for the action actually taken against the realized TSD change 1, 3 and 5 turns
later. A module must show positive correlation at horizon 3, otherwise it is
optimising immediate spread — the failure mode already recorded in §10 of the
training doc.

### 6.5 Strength gates — per-module ablation

The existing paired-seed, side-swapped gate is the promotion statistic. Every
module ships only when it clears it:

```sh
npm run gate -w @meccg/sim -- --challenger h2:combat --champion heuristic --games 400
npm run gate -w @meccg/sim -- --challenger h2:combat,travel --champion h2:combat --games 400
```

This produces a per-module Elo table — the direct answer to "modules are
independently tested and improved". A module that does not clear its own gate
does not get enabled by default, even if its calibration is perfect.

Per project policy, full suites and long gates are run by the reviewer and
branch CI, not during development.

## 7. Phasing

Every phase is independently shippable because unowned action types fall
through to H1.

| Phase | Content | Exit criterion |
|---|---|---|
| P0 | `core/` (types, tsd, dice, rationale, tunables, registry) + `standing` service, `W` fit, scenario store, `explain` + `scenarios` CLIs, calibration harness | `explain` runs on a captured scenario; `W` Brier reported on held-out games; `standing` reports correct marginal MP value per source on hand-built cases |
| P1 | `combat` — including enumeration of our own defensive card plays — then `kill` on top of it | Calibration within CI at 5000 rollouts, card-play lines included; `gate h2:combat vs heuristic` lower bound > 0; a defence-scenario subset where H1 loses a character it could have saved, on which H2 must not; `kill` gated separately on top |
| P2 | `exposure` (both halves: limits **and** the hidden-card belief model) + `budget` services, then `travel` | Belief model scored by log-loss against actually-revealed on-guard cards in the replay corpus; horizon-3 correlation positive; gate vs `h2:combat,kill` |
| P3 | `factions` + `items` (the two richest acquisition modules) | Faction P(success) calibrated against the reducer; gate |
| P4 | `health` + `corruption` | as above |
| P5 | `allies` + `characters` + `misc` | as above; `misc` may ship without a gate if it clears calibration and shows no regression |
| P6 | `hazards` (bundle planner) + `hand` (shadow prices) — shipped together | Bundle beam search inside the perf budget; denial calibrated against the reducer; gate. `hand` cannot be validated before `hazards` exists, since the price depends on hazard demand |
| P7 | `endgame`, `sweep`/`compare` polish, lobby exposure as a selectable opponent | Full `h2` clears the gate vs `heuristic` and vs the current RL champion |
| P8 | Re-export BC training data with H2 as teacher | BC-on-H2 vs BC-on-H1 gate |

`combat` in P1 needs a card shadow price before `hand` exists in P6. It uses a
flat provisional price from `tunables.ts` (one number, sweepable, and named in
the rationale so a P1 explanation never hides which price it used); P6 replaces
that call with the real `hand` service and re-runs the P1 gate to confirm the
substitution is an improvement rather than a silent behaviour change.

`factions` is pulled forward to P3 rather than left in a generic "resources"
phase: it has the cleanest closed-form probability of any acquisition module,
it exercises the `standing` marginal-value path end to end, and faction MP is a
large fraction of the score in the approved hero decks.

P8 is the payoff beyond hand-written play: per `docs/ai-training-system.md` §6,
imitation is bounded by the teacher, so a stronger, better-calibrated teacher
raises the ceiling of the entire learned stack.

## 8. Deferred / explicitly out of scope for v1

- **The *opponent's* hand cards in combat.** *Our* card plays are in scope from
  v1 (§3.3) — when we defend, `combat` enumerates and scores every card we can
  legally play into the combat. What is deferred is the other side: v1 assumes
  the attacker plays nothing into our defence. Refinement: a `hand-cards` layer
  that mixes in `P(opponent holds a relevant card)` estimated from their discard
  pile, deck composition and the hazard limit, feeding off the `exposure` belief
  model. Only after the base module is calibrated.
- **Bluffing / deception.** On-guard *inference* is in scope (`exposure`
  beliefs) and *placement* is in scope (`hazards` bundles); deliberately
  placing a worthless card to deter is not — see §3.6 for why the ordering is
  forced and why it needs a mirror-gate experiment rather than the standard
  one. Same ceiling PIMC search hits (§11 of the training doc).
- **Opponent modelling.** All modules assume an opponent playing the same
  heuristic. No adaptation in v1.
- **Non-hero alignments.** Minion / Fallen-wizard / Balrog play is untested by
  the current training pipeline; H2 must not *break* on them (falls back to H1)
  but is not tuned for them in v1.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Greedy MP maximisation, already measured as harmful | §2.3 decomposition + §6.4 horizon test as a ship gate |
| Performance: the heuristic agent drives mass self-play (~2000 decisions/game) | Budget: median decision < 1 ms, p99 < 20 ms. Precomputed 2d6 tables, bounded enumeration with an explicit cap, memoised per-decision view derivations. Add a perf assertion to `bench`. |
| `W` overfits a narrow deck distribution | Fit on held-out *games*; record corpus composition; re-fit when the approved deck set changes |
| Module sprawl / hidden coupling | Ownership registry is the single source of truth; cross-module access only via declared services; a test asserts no module imports another module directly |
| H2 regresses areas H1 handled acceptably | Hybrid fallback + per-module ablation gates + `compare` on the scenario set |
| Tuning by vibes returns | Every constant lives in `tunables.ts`, appears in the rationale, and is sweepable via `sweep --over tunable:<name>` |
| Combat card-play enumeration multiplies the branching factor at every decision point in a strike | Only combat-relevant cards in hand are candidates (a legality filter, not a heuristic one), the sequential search is depth- and width-capped by a tunable, and the cap is reported in the rationale so a truncated search is never mistaken for exhaustive. The perf budget in the row above is measured with card enumeration on. |
| Hazard bundle enumeration is exponential in hand size | Beam search with a width tunable and a hard cap; plan committed once per company per M/H phase rather than per action; the cap is reported in the rationale so a truncated search is never mistaken for an exhaustive one |
| The `hand` shadow price becomes a second weight soup | It is a single number in TSD units with one owner, consumed by everyone; §6.4 calibrates it against whether a high price actually predicted a valuable hazard turn |

## 10. Open questions

1. **Where does H2 live?** Proposed `packages/sim/src/ai/h2/`. If the lobby is
   to run it against humans without pulling the sim's training dependencies, it
   may belong in `@meccg/shared` instead. Deferred to P0; the module code has no
   sim-specific dependencies either way.
2. **Sampling vs. argmax.** H1 samples from weights, which the BC pipeline
   depends on (soft targets). H2 proposes softmax over utilities with a
   temperature tunable — needs a decision on the default temperature before P7.
3. **Scenario corpus size.** Start at ~10 per module, hand-curated. Whether to
   auto-mine "interesting" positions (high branching, close TSD) from replays
   is a P2 question.
4. **Strategic recompute cadence.** The acquisition modules' strategic level
   (the `plan` portfolio) is expensive relative to a single decision and barely
   changes within a turn. Proposal: recompute once per own organization phase
   and cache on the module context, invalidated by turn number plus a coarse
   view signature; the tactical level runs every decision. Needs measurement
   against the §9 performance budget before it is fixed.
