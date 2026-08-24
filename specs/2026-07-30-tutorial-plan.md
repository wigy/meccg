# Spec: Guided Tutorial — Character Draft to End of Opponent's Turn

## Overview

A scripted, fully deterministic teaching game in the browser UI. A new player
presses **Play tutorial** in the lobby and is walked step by step through one
complete game opening: the pre-game setup (character draft → initiative roll)
and three full rounds of play — acting as resource player on their own turns
and as hazard player on the Mentor's. The tutorial ends at the end of the
Mentor's third turn.

Both players' draft pools, deck order, and hands are **pre-arranged** so the
script knows exactly which cards are available at every step. Each step shows
an instruction panel explaining the rule, highlights the expected action, and
**waits for the player to perform it**. The opponent is a scripted agent
playing a predetermined action list.

This fills the roadmap item "Guided tutorials — scripted scenarios that walk
through drafts, movement, combat, corruption, influence, chain of effects"
(`specs/roadmap.md` §6 Learning Tool) and the bare `Tutorial` EPIC in
`TODO.md`.

---

## What the codebase already gives us

- **Deterministic engine.** Pure reducer (`packages/shared/src/engine/reducer.ts`),
  all randomness through seeded Mulberry32 `RngState` (`packages/shared/src/rng.ts`).
  `cheatRollTotal` (`state.ts`) forces any 2d6 roll — already settable via the
  dev `CheatRollMessage` (`game-session.ts:handleCheatRoll`).
- **Dev machinery in every lobby game.** `launcher.ts` always passes `--dev`,
  so save/load/undo/cheat-roll/summon/swap-hand messages are available.
- **Scripted headless play.** `packages/sim/src/runner.ts:playGame` drives both
  sides through `computeLegalActions → projectPlayerView → agent → reduce`.
  Perfect substrate for a CI test that replays the whole tutorial.
- **Setup banners and phase meter.** `render-board.ts:setupStepPrompt` and
  `render-phase-meter.ts` already display per-step titles — the tutorial panel
  is a richer sibling of these.
- **Spawned-client plumbing.** `launcher.ts` already spawns AI clients
  (`ai-client.ts`, `pseudo-ai-client.ts`) with `--deck` args; a scripted
  tutorial opponent is one more variant.

**What is missing** (verified by exploration):

- No way to bypass deck shuffling. `createGame` shuffles in
  `initPlayerPreDraft` (`init.ts` ~264) and the `shuffle-play-deck` setup
  action re-shuffles (`reducer-setup.ts` ~1122). `createGameQuickStart` skips
  the draft entirely, so it cannot be used — the tutorial *teaches* the draft.
- No `setHand`/deck-ordering admin action; only whole-hand swap and
  single-card summon.
- No tutorial/scenario/onboarding code anywhere.

---

## Design summary

| Concern | Decision |
|---|---|
| Determinism of decks | New `GameConfig.orderedDecks?: boolean` — shuffles become no-ops; deck array order = draw order |
| Determinism of dice | Tutorial controller queues `cheatRollTotal` before every roll, per script step |
| Opponent | Spawned text-client with a new `ScriptAgent` playing a fixed action list |
| Player gating | Server-side: tutorial controller filters projected legal actions to the current step's expected action(s) |
| Script location | `@meccg/shared` (`src/tutorial/`) — pure data + matchers, consumed by game-server (gating, rolls) and browser (instruction panel) |
| Decks | Two checked-in tutorial decks with explicit play-deck order, bundled with the tutorial module (NOT in the `data/decks/` catalog — they must not appear in deck listings); **certified cards only** |
| Entry point | Lobby "Play tutorial" → `launchGame(player, 'Mentor', { tutorial: true })`; the human's join is built from the fixed tutorial deck automatically |
| Mentor's hand | Stays hidden (normal projection) — no tutorial-mode exception |
| Auto-pass | Forced off for the tutorial session, so no narrated step is skipped |
| CI guard | A sim-based test replays the entire script headless with ScriptAgents on both sides |

### Why not the alternatives

- **Pre-seeded save file** (`SAVE_DIR` injection): works only for a
  mid-game state; the tutorial must start *before* the draft, and `createGame`
  already produces that state — only the shuffle needs bypassing.
- **Client-side-only gating**: fragile — a stray click would desync the
  script. Server-side filtering keeps the game on rails no matter what the
  client sends, and the reason string doubles as UI feedback.
- **Pseudo-AI mode** (human plays both sides): teaching two seats at once is
  confusing for a first game; the hazard-player role is taught properly on
  the Mentor's turns instead.

---

## Engine change: ordered decks

Add `orderedDecks?: boolean` to `GameConfig` (`init.ts`). When set:

- `initPlayerPreDraft` keeps `playDeck` in the given order (skip `shuffle`).
- `handleDeckShuffle` / the `shuffle-play-deck` action advances the step
  without shuffling (the action itself remains — the tutorial explains what
  it normally does).

Index 0 stays "top of deck" (`playDeck.slice(0, n)` draws), so **the deck
array in the tutorial deck file is literally the draw order**: cards 1–8 are
the opening hand, card 9 is the first movement/hazard draw, and so on.

One placement rule needs pinning: characters added during
`character-deck-draft` (`add-character-to-deck`) must join the play deck at
a deterministic position — the **bottom** — when `orderedDecks` is set, so
the arranged draw order (hand, M/H draws, refills) is unaffected.

This is a small, purely additive change with a unit test
(`orderedDecks: true` → deck order preserved through setup, deck-draft
additions land at the bottom).

---

## Tutorial script model

New package dir `packages/shared/src/tutorial/`:

```ts
interface TutorialStep {
  id: string;                     // 'draft-first-pick', 'mh-declare-path', ...
  match: StateMatcher;            // { phase, setupStep?, mhStep?, siteStep?, turnNumber?, predicate? }
  title: string;                  // short heading for the panel
  body: string;                   // the rule explanation (markdown)
  expect?: ActionMatcher[];       // actions the HUMAN may take; omitted = watch-only step
  opponentActions?: ActionMatcher[]; // what the ScriptAgent plays while this step is active
  cheatRolls?: number[];          // 2d6 totals queued (FIFO) while this step is active
}

interface ActionMatcher {
  type: GameAction['type'];       // e.g. 'draft-pick'
  card?: CardDefinitionId;        // definition referenced by the action, when relevant
  site?: string;                  // for declare-path / select-starting-site
  // matched against computeLegalActions output; must match >= 1 viable action
}
```

- `TUTORIAL_SCRIPT: TutorialStep[]` — the ordered curriculum (below).
- `matchStep(view | state, script, cursor)` — pure function returning the
  active step; used identically by server and browser so they can never
  disagree.
- Steps advance monotonically; a step is complete when the game state no
  longer matches it (the expected action was taken).

### Gating semantics

While a step is active, the tutorial controller post-processes the human's
projected legal actions: every viable action **not** matched by `expect`
becomes `viable: false, reason: 'Tutorial: follow the current instruction'`.
`fillNotPlayable` tooltips then explain the block for free in the existing UI.
Watch-only steps (opponent acting) gate everything except mandatory responses
the script expects (e.g. `assign-strike` during a scripted attack).

The **existing undo dev message** is surfaced as a "Restart step" button if
the player ends up confused (v1: whole-step undo via `stateHistory`).

---

## Runtime architecture

```text
Lobby "Play tutorial"
  └─ lobby.ts: startTutorialGame(player)
       └─ launcher.ts: launchGame(player, 'Mentor', { tutorial: true })
            ├─ game-server + TutorialController (gating, cheat rolls, step cursor)
            └─ text-client tutorial-opponent-client (ScriptAgent, deck bundled from @meccg/shared tutorial module)
Browser
  └─ tutorial-panel.ts: renders active step title/body, highlights expected
     action, shows progress (step N of M), "Restart step" button
```

- **TutorialController** (`packages/game-server/src/ws/tutorial-controller.ts`):
  owned by `GameSession` when launched with `--tutorial`. Hooks:
  - after every reduce: recompute active step via `matchStep`; queue the
    step's `cheatRolls` into `state.cheatRollTotal` as rolls are consumed;
  - in projection post-processing: apply gating to the human's legal actions;
  - joins: builds both players' `JoinMessage`s from the checked-in tutorial
    decks (the human's deck selection UI is bypassed), passing
    `orderedDecks: true` into `GameConfig`.
- **ScriptAgent** (`packages/text-client/src/agents/script-agent.ts` or
  `packages/sim/src/agents/`): holds the opponent's flattened action list
  (all `opponentActions` in script order); each turn it plays the next
  matcher that matches a viable legal action, else passes. It asserts loudly
  if the expected action is not legal — that is a script bug.
- **Browser** (`packages/lobby-server/src/browser/tutorial-panel.ts`): imports
  `TUTORIAL_SCRIPT` + `matchStep` from shared, renders the panel from the
  player view alone. Highlighting reuses the existing card-tooltip/instruction
  -line affordances; expected-action cards get a pulsing outline.
- **Protocol**: no new message types needed for v1 — the script is static data
  in shared, both ends compute the cursor from the state. (A
  `tutorial-progress` field could be added to the view later if drift is ever
  observed.)

---

## Tutorial decks

Two files bundled with the tutorial module — deliberately **not** in the
`data/decks/` catalog, so they never appear in deck listings (browser deck
picker, `listDecks`, AI deck selection):

- `packages/shared/src/tutorial/tutorial-hero.json` — the human. Hero
  alignment, wizard avatar, starting site Rivendell.
- `packages/shared/src/tutorial/tutorial-mentor.json` — the scripted
  opponent ("Mentor"). Also hero alignment (avoids CvCC/minion rules noise
  in a first game).

The TutorialController loads them directly when building the two
`JoinMessage`s; they never pass through the deck catalog or player deck
store. Deck files carry the play deck **in tutorial order** (see draw budget
below). `validateDeck` only warns, so the undersized (~30 card) tutorial
decks start fine.

**Hard constraint: certified cards only.** Every card in both decks must be
fully certified (no deferred/stubbed effects) — verify each id and
`certified` field against `data/cards.json` / `packages/shared/src/data/*`
at implementation time. Source candidates preferentially from the
challenge-deck card set (`data/decks/challenge-deck-*.json`), whose
certification is tracked in `specs/roadmap.md`. **Never infer card
properties from card text — read them from data.** Card names below are
*candidates with the required role*; the role is the requirement, the name is
a suggestion to be verified or substituted.

### Human draft pool (character draft + item draft)

The pool is an all-Elf Rivendell company (verified against
`tw-characters.json`, all certified):

| # | Card (verified) | Teaches |
|---|---|---|
| P1 | Glorfindel II (tw-161, mind 8, DI 2) | first draft pick |
| P2–P3 | Elladan (tw-143, mind 4), Elrohir (tw-144, mind 4) — warriors, body 8 | second/third pick; running total 16 mind. One twin takes the tutorial's scripted wound and recovers |
| P4 | Elrond (tw-145, mind 10) | mind-limit rejection: 16+10 = 26 > 20 (`mind-limit` rule) → goes to deck in character-deck-draft |
| P5 | Gildor Inglorion (tw-158, mind 4, "+2 prowess against Orcs") | deliberately left undrafted → character-deck-draft |
| P6–P7 | Two starting minor items: Dagger of Westernesse (tw-206, +1 prowess), Shield of Iron-bound Ash (tw-327, +1 body) — both certified | item draft (`assign-starting-item`, `MAX_STARTING_ITEMS = 2`). NOT Star-glass (tw-330): it cancels Undead attacks and would defuse the Barrow-downs lesson |

Stopping at 16 mind is itself part of the lesson: it leaves 4 of the 20
general influence free, which is exactly what lets Arwen (mind 3) come into
play in the organization phase. The company's skills are load-bearing:
Glorfindel II and Arwen are **sages** (Marvels Told in round 3 requires
one), and the twins are warriors with body 8 (the scripted wound is
survivable).

The Mentor's pool is chosen with **no overlap** with the human's pool so the
draft-collision rule never fires (it is explained in text only — v1 keeps the
happy path).

### The game plan (three rounds)

Verified against card data and the region adjacency graph:

- **Round 1** — Rivendell → **Barrow-downs** (Rhudaur → Cardolan, 2 regions):
  play a major item; the Undead automatic-attack (1 strike, 8 prowess)
  wounds Elladan, who then makes a body check and Barrow-downs' forced
  corruption check. On the Mentor's turn: play a hazard creature.
- **Round 2** — **split the company**: wounded Elladan travels home to
  Rivendell; the rest go to the **Old Forest** (same region) and play the
  ally **Goldberry** ("Playable at Old Forest"). On the Mentor's turn: play
  a corruption card and a hazard long-event.
- **Round 3** — Elladan **heals at Rivendell during untap**; the main
  company travels Old Forest → **Edoras** (Cardolan → Enedhwaith → Gap of
  Isen → Rohan — exactly 4 regions, the region-movement maximum) and plays
  the faction **Riders of Rohan** (influence check > 9); the Mentor reveals
  on-guard **Foolish Words** (-4); the player responds with **Marvels Told**
  (sage ritual) — the chain of effects. On the Mentor's turn: play **River**
  so its site phase does nothing.

### Human deck: what must be in hand, when

With `orderedDecks`, the deck array is the draw order: opening hand = cards
1–8, then M/H draw steps and end-of-turn refills consume the deck in
sequence. Exact slot indices depend on the sites' light/dark draw numbers
and are finalized at implementation; what is fixed is **when each key card
must be in hand**. Filler slots are inert resources that demonstrate the
"not playable now" tooltips, plus one dead card for the voluntary-discard
lesson.

All key cards verified certified:

| Card | Must be in hand by | Role |
|---|---|---|
| Arwen (tw-122) | opening hand | organization: character play at her home site Rivendell |
| Star of High Hope (td-154) | opening hand | long-event: environment, +1 prowess to Elves (+2 with Gates of Morning) |
| Sword of Gondolin (tw-336) | opening hand | major item at Barrow-downs (warrior only, +2 prowess, 2 MP) |
| Orc-guard (tw-072) or similar creature | Mentor's turn-1 M/H | your first hazard: creature keyed to the Mentor's path |
| Gates of Morning (tw-243) | drawn in the turn-1 M/H draw step | played immediately: sweeps hazard environments, Star of High Hope → +2 |
| Goldberry (tw-245) | turn-2 site phase | ally at Old Forest |
| Lure of the Senses (tw-60) | Mentor's turn-2 M/H | corruption: 2 CP on a Mentor character, check at its next untap |
| Minions Stir (tw-61) | Mentor's turn-2 M/H | hazard long-event (non-environment — your own Gates of Morning does not cancel it) |
| Riders of Rohan (tw-317) | turn-3 site phase | faction at Edoras, influence check > 9 |
| Marvels Told (td-134) | turn-3 site phase | response: tap a sage to discard Foolish Words (ritual corruption check) |
| River (tw-84) | Mentor's turn-3 M/H | site hazard: the Mentor's company must do nothing during its site phase |

### Mentor deck constraints

| Requirement | Why |
|---|---|
| Foolish Words (td-25) in hand by the human's turn-3 M/H | placed on-guard at Edoras; revealed on the influence attempt (-4) |
| Company contains **no ranger** | a ranger could tap to cancel River — it must stick |
| A non-Ringwraith character | legal target for Lure of the Senses |
| A character able to defeat the human's Orc creature | round-1 combat resolves with a Mentor kill (both sides score MP) |
| Characters, movement and one item for three narrated turns | the watch-only organization/site beats |

---

## Curriculum

Each row is one or more `TutorialStep`s. "You" = the human. All dice are
scripted via `cheatRolls`.

### Part 1 — Setup (`Phase.Setup`, all eight `SetupStep`s)

| Step | State | Instruction & expected action |
|---|---|---|
| 1 | `character-draft` | What the draft is; general influence = 20 mind budget. **Pick Glorfindel II** (`draft-pick`). Mentor picks simultaneously (scripted). |
| 2–3 | `character-draft` | Pick Elladan, then Elrohir (16 mind). Panel shows the running mind total. |
| 4 | `character-draft` | Try Elrond — the panel explains the pick is blocked by the `mind-limit` rule (26 > 20; tooltip shows the reason). **Stop drafting** (`draft-stop`) — the 4 unused mind stays free as general influence. |
| 5 | `item-draft` | Starting minor items: **assign the two minor items** to characters (`assign-starting-item` ×2, max 2). |
| 6 | `character-deck-draft` | Undrafted characters can join your deck: **add Elrond and Gildor Inglorion to the deck** (`add-character-to-deck` ×2), then `pass`. |
| 7 | `starting-site-selection` | Havens; wizards start at Rivendell. **Select Rivendell** (`select-starting-site`). (Panel notes: two-site avatars — Ringwraiths, Balrog — would next get a `character-placement` step; skipped here.) |
| 8 | `deck-shuffle` | **Shuffle your deck** (`shuffle-play-deck`) — panel explains this normally randomizes; in the tutorial the order is fixed. |
| 9 | `initial-draw` | **Draw your opening hand** (`draw-cards`, 8 = `HAND_SIZE`). Panel tours the hand. |
| 10 | `initiative-roll` | Both roll 2d6 (`roll-initiative`); cheat rolls make **you win and go first**. |

### Part 2 — Round 1: wounds happen

**Your turn — journey to the Barrow-downs:**

| Step | State | Instruction & expected action |
|---|---|---|
| 11 | `Untap` | Phase order overview (the phase meter is introduced). Nothing is tapped yet — **untap** (`untap`). Mentor silently passes its sideboard option (scripted; explained later in step 24). |
| 12 | `Organization` | Play characters, form companies, plan movement. **Play Arwen** from hand (`play-character`) — her home site is Rivendell, and characters come into play at their home site; the 4 mind left unused in the draft covers her mind of 3 as general influence (explains direct vs general influence). |
| 13 | `Organization` | **Declare movement** (`plan-movement`) to **Barrow-downs** — a two-region journey (Rhudaur → Cardolan); region movement and site paths explained. Then `pass`. |
| 14 | `LongEvent` | Long-events last until your next long-event phase. **Play Star of High Hope** (`play-long-event`) — an environment that gives every Elf in your company +1 prowess. Then `pass`. |
| 15 | `MovementHazard` / `select-company` | **Select your company** (`select-company`). |
| 16 | `reveal-new-site` | **Reveal your destination** (`declare-path`, region movement). Panel shows the region path on the map. |
| 17 | (auto) `set-hazard-limit` | Watch-only: the hazard limit = max(company size, 2) — here 4; panel points at the limit indicator. |
| 18 | `draw-cards` | Both players draw based on the site's draw numbers. **Draw** (`draw-cards`; first draw is mandatory) — you draw **Gates of Morning**. Then `pass`. |
| 19 | `play-hazards` | **Play Gates of Morning** (resource permanent events are legal here): hazard environments are swept away and Star of High Hope now gives +2 — card synergy in action. The Mentor passes: a quiet first journey. **Pass.** |
| 20 | `reset-hand` | Both hands refill to hand size (`resolveHandSize`); watch-only or `pass`. |
| 21 | `Site` | **Enter Barrow-downs** (`select-company`, `enter-site`) and face its automatic-attack: **Undead, 1 strike of 8 prowess**. **Assign the strike to Elladan** (`assign-strike`; his prowess is 5 + 2 = 7) and **resolve** (`resolve-strike`) — cheat-rolled to fail: Elladan is **wounded**, makes his **body check** (body 8; cheat-rolled: wounded, not eliminated), and Barrow-downs then forces a **corruption check** on him (cheat-rolled: passes). Tapping, wounding, body checks and a first glimpse of corruption in one fight. |
| 22 | `Site` / `play-resources` | **Play Sword of Gondolin on Elrohir** (`play-hero-resource`): taps Elrohir and the site; item marshalling points explained. Then `pass` — the site phase ends. |
| 23 | `EndOfTurn` | `discard`: **discard the dead card** (`discard-card`), `pass`. `reset-hand`: **draw back up to 8** (`draw-cards`). `signal-end`: `pass` — your turn ends; panel explains Free Council exists but is far off. |

**The Mentor's turn — your first hazard play:**

| Step | State | Instruction & expected action |
|---|---|---|
| 24 | `Untap` | Roles swap: the Mentor untaps (scripted). **Your hazard-player option**: fetching from your sideboard now would halve your hazard limit all turn — decline (`pass`). |
| 25 | `Organization`/`LongEvent` | Watch-only, narrated: the Mentor plays a character and declares movement. You have no actions in these phases. |
| 26 | `MovementHazard` | Mentor reveals its path. **You draw** (`draw-cards`), then **play your Orc creature** on the Mentor's company (`play-hazard`) — creature keying to regions explained. The Mentor defends (scripted rolls): its character taps and defeats the Orc, and the Mentor takes the **kill marshalling points** — both sides score in this game. |
| 27 | `play-hazards` | Note the hazard-limit count (1 used). **Pass**; hands reset. |
| 28 | `Site` | Watch-only: the Mentor enters its site and plays an item (narrated). |
| 29 | `EndOfTurn` | Both reset hands. Round 1 ends. |

### Part 3 — Round 2: heal, split, allies

**Your turn:**

| Step | State | Instruction & expected action |
|---|---|---|
| 30 | `Untap` | **Untap** — but Elladan stays wounded: healing happens at Havens during untap. Time to send him home. |
| 31 | `Organization` | **Split the company** (`split-company`): Elladan alone toward Rivendell; Glorfindel II, Elrohir and Arwen toward the Old Forest. **Declare movement for both companies** (`plan-movement` ×2 — Old Forest is in the same region; Rivendell is two regions back). Multi-company play explained. Then `pass`. |
| 32 | `LongEvent` | Star of High Hope is **discarded now** — long-events last exactly until your next long-event phase. `pass`. |
| 33 | `MovementHazard` | Each company runs the M/H steps in turn (`select-company`, `declare-path`, draws, `pass`). The Mentor passes on both — but the panel notes a lone wounded character is exactly what hazard players prey on: escorts matter. |
| 34 | `Site` | Old Forest company: **enter and play Goldberry** (`play-hero-resource`) — allies, ally marshalling points, and Old Forest's "healing effects affect all characters" text. Elladan at Rivendell: nothing to do (`pass`). |
| 35 | `EndOfTurn` | Reset hand; `pass`. |

**The Mentor's turn — corruption and long-events:**

| Step | State | Instruction & expected action |
|---|---|---|
| 36 | `Untap`–`LongEvent` | Watch-only: the Mentor untaps and moves out again. |
| 37 | `MovementHazard` | **Draw**, then **play Lure of the Senses** on a Mentor character (`play-hazard`) — 2 corruption points; the check comes due at the end of its next untap phase. Then **play Minions Stir** (`play-hazard`) — a hazard long-event; note your own Gates of Morning doesn't touch it (it is not an environment). Hazard limit: 2 used. **Pass.** |
| 38 | `Site`/`EndOfTurn` | Watch-only: the Mentor's site phase and end of turn. |

### Part 4 — Round 3: factions and the chain of effects

**Your turn — the capstone:**

| Step | State | Instruction & expected action |
|---|---|---|
| 39 | `Untap` | **Untap** — Elladan, at a Haven, **heals** during your untap phase. The round trip pays off. |
| 40 | `Organization` | **Declare movement** Old Forest → **Edoras**: Cardolan → Enedhwaith → Gap of Isen → Rohan — exactly four regions, the region-movement maximum. Elladan stays at Rivendell. Then `pass`. |
| 41 | `LongEvent`/`MovementHazard` | `pass`, then run the M/H steps. During `play-hazards` the Mentor **places a card on-guard** at Edoras (scripted `place-on-guard`) — face-down, counts against the hazard limit; you'll meet it soon. **Pass.** |
| 42 | `Site` | **Enter Edoras** and **attempt the Riders of Rohan** (faction influence attempt: tap Glorfindel II; needs a check greater than 9). The Mentor **reveals Foolish Words** (`reveal-on-guard`): the attempt would take -4. **Respond with Marvels Told** — the chain of effects: tap the sage Arwen to force Foolish Words' discard; she makes the ritual's corruption check (cheat-rolled: passes). The influence roll (cheat-rolled 8, + 2 direct influence = 10) succeeds: the faction joins and scores faction marshalling points. On-guard cards, responses and influence in one scene. |
| 43 | `EndOfTurn` | Reset hand; `pass`. |

**The Mentor's turn — hazards that aren't creatures:**

| Step | State | Instruction & expected action |
|---|---|---|
| 44 | `Untap` | Watch-only: the corruption check from Lure of the Senses comes due (cheat-rolled: the Mentor passes it — the panel explains what failure would have meant). |
| 45 | `MovementHazard` | **Draw**, then **play River on the Mentor's destination site** (`play-hazard`) — its company must do nothing during its site phase. A ranger could tap to cancel it; the Mentor has none. **Pass.** |
| 46 | `Site` | Watch-only: the Mentor enters its site… and does nothing (River). Hazards need not kill to hurt. |
| 47 | `EndOfTurn` | Both reset hands. **Tutorial complete.** Summary panel: your marshalling points (item + ally + faction) vs the Mentor's (kill), the three ways to win, pointers to `docs/player-guide.md` and a real game against the AI. |

Not covered (deliberately, keeps v1 focused): character-vs-character
influence, agents, CvCC, gold rings and the One Ring, Free Council, deck
exhaustion, draft collisions, under-deeps. Each is one sentence of "you'll
meet this later" in the relevant panel.

---

## Testing

1. **Unit**: `orderedDecks` preserves deck order through
   `initPlayerPreDraft` and `shuffle-play-deck`.
2. **Unit**: `matchStep` cursor advances correctly over a recorded state
   sequence; gating filter blocks/allows the right actions per step.
3. **Integration (the load-bearing one)**: a sim-based test
   (`packages/sim` or shared tests) plays the *entire* script headless —
   ScriptAgent for the Mentor, and a "HumanScriptAgent" that always takes the
   step's expected action for the human — asserting every expected action is
   viable when its step activates and the game reaches the final step. This
   keeps the curriculum legal as the engine evolves; it runs in the normal
   suite (fast: one six-turn game).
4. **Deck lint**: a test asserting every card in both tutorial decks is
   certified (reads the card data; fails the build if a card loses
   certification).

---

## File plan

| File | Purpose |
|---|---|
| `packages/shared/src/tutorial/script.ts` | `TUTORIAL_SCRIPT`, step/matcher types |
| `packages/shared/src/tutorial/match.ts` | `matchStep`, action matching, gating filter (pure) |
| `packages/shared/src/engine/init.ts` | `GameConfig.orderedDecks` |
| `packages/shared/src/engine/reducer-setup.ts` | no-op shuffle when `orderedDecks` |
| `packages/game-server/src/ws/tutorial-controller.ts` | gating, cheat-roll queue, join construction |
| `packages/game-server/src/ws/game-session.ts` | `--tutorial` flag wiring |
| `packages/text-client/src/agents/script-agent.ts` | Mentor's scripted agent |
| `packages/lobby-server/src/games/launcher.ts` | `LaunchOptions.tutorial` |
| `packages/lobby-server/src/lobby/lobby.ts` | `start-tutorial` message |
| `packages/lobby-server/src/browser/tutorial-panel.ts` | instruction panel + highlights |
| `packages/shared/src/tutorial/tutorial-hero.json`, `.../tutorial-mentor.json` | arranged decks (outside the deck catalog) |

---

## Phased delivery

### Phase 1 — Deterministic substrate

`orderedDecks` engine flag + unit test; tutorial deck files (cards verified
against data, certified-only, ordered); ScriptAgent; headless run of the full
setup + two turns with both sides scripted (no UI, no gating yet). This
proves the arranged decks and script are legal end to end.

### Phase 2 — Script + controller

`TUTORIAL_SCRIPT` content, `matchStep`, gating filter; TutorialController in
game-server; cheat-roll queue; launcher/lobby `tutorial` option; the
integration test from Testing §3.

### Phase 3 — Browser experience

`tutorial-panel.ts` (instruction panel, expected-action highlight, progress,
restart-step via undo); lobby "Play tutorial" button; polish pass on all 31
step texts.

### Phase 4 — Follow-ups (separate specs)

More chapters (corruption, influence/factions, agents, Free Council), puzzle
mode reusing the same script/gating machinery, "Why?" tooltips on arbitrary
actions (roadmap §6).

---

## Open questions

1. **Restart granularity.** V1 restarts a step via dev undo (`stateHistory`
   pop). Is whole-tutorial restart (relaunch) acceptable as the only fallback
   when undo crosses a phase boundary awkwardly?
2. **Mentor route and company.** The Mentor's exact characters, sites and
   creature-keying regions are chosen at implementation under the "Mentor
   deck constraints" table (no ranger, a Lure target, a path the human's
   Orc creature can key to).

## Implementation notes (feat/tutorial)

Where the built tutorial deviates from the plan above, the implementation is
authoritative (every deviation was forced by engine reality and is locked in
by the integration test):

- **Script model.** `matchStep`-over-state became an ordered list of
  **beats** — 212 prescribed actions (`TUTORIAL_BEATS`) grouped under 45
  presentation steps (`TUTORIAL_STEPS`). The server tracks the cursor and
  attaches a `TutorialProgress` snapshot to `PlayerView.tutorial`; the
  browser renders from that and never computes the cursor itself.
- **Mentor.** Played inside `GameSession` by the `TutorialController` — no
  spawned ScriptAgent client. The session starts when the human joins;
  tutorial games are never saved; dev operations are refused (restart =
  relaunch the tutorial, replacing the undo-based restart-step idea).
- **Decks** are TypeScript modules (`packages/shared/src/tutorial/decks.ts`)
  rather than JSON, so every slot carries its teaching purpose as a comment.
- **The first creature** is Orc-lieutenant (tw-073, 1 strike, keys to
  wilderness) instead of Orc-guard — a five-strike creature is a poor first
  lesson and Orc-guard cannot key to wilderness paths at all.
- **The Mentor's company** is Thorin II, Gimli and Glóin (19 mind, no
  rangers) routing Rivendell → Moria (Glamdring) → Lórien → Dimrill Dale.
  Moria's four-strike automatic-attack yields a bonus lesson: the hazard
  player (the human!) assigns the strikes beyond the defender's choices.
- **Marvels Told timing.** A permanent on the chain cannot be targeted, so
  the Foolish Words reveal resolves first: the influence roll is made at
  −4 (needing — and scripted to get — a perfect 12), and Marvels Told then
  removes Foolish Words so future attempts are clean. The chain, response
  windows and ritual corruption check are all still taught, plus one more
  truth: sometimes you play through the hazard.
- **Wound mechanics as built:** Elladan faces the Undead untapped (tapped he
  could not fail); the body check is rolled by the opponent; Barrow-downs'
  corruption check follows. Starting minor items are Dagger of Westernesse
  and Shield of Iron-bound Ash (Star-glass would cancel the Undead attack).
- The tutorial ends at the Mentor's turn-6 end-of-turn; final tally human
  12 MP (6 character + 2 item + 3 faction + 1 ally) vs Mentor 10
  (7 character + 2 item + 1 kill).
- **Chapter one (2026-08-17).** What ships is the player's own first turn:
  the script (`TUTORIAL_STEPS` / `TUTORIAL_BEATS`) now stops at the
  `eot-1-end` End Turn, where a centered completion card recaps the chapter
  (`TUTORIAL_COMPLETION`) and offers a single "Exit Tutorial" button — the
  only control left, since the gate demotes every human action once the
  script is exhausted. The rest of the curriculum (the Mentor's turns and
  rounds 2–3) moved to `LATER_CHAPTER_STEPS` / `LATER_CHAPTER_BEATS`: still
  replayed by both tutorial tests as a continuation of chapter one, so it
  stays engine-verified until it is released as chapters of its own.

Resolved:

- **Destination sites** → Barrow-downs (round 1: minor/major items, Undead
  automatic-attack that wounds and forces a corruption check), Old Forest
  (round 2: Goldberry, healing text), Edoras (round 3: Riders of Rohan).
  Region geometry verified against the adjacency data: Rivendell →
  Barrow-downs = 2 regions; Barrow-downs → Old Forest same region;
  Barrow-downs → Rivendell = 2 regions; Old Forest → Edoras = 4 regions
  (the maximum).
- **Combat outcome** → the Barrow-downs Undead wounds Elladan in round 1
  (body check + corruption check taught immediately; healing taught in
  rounds 2–3).
- **Long-event candidate** → Star of High Hope (td-154, certified), paired
  with Gates of Morning (tw-243) drawn during the first move.
- **Mentor visibility** → hand stays hidden (normal projection).
- **Auto-pass** → forced off for the tutorial session.
