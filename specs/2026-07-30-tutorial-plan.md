# Spec: Guided Tutorial — Character Draft to End of Opponent's Turn

## Overview

A scripted, fully deterministic teaching game in the browser UI. A new player
presses **Play tutorial** in the lobby and is walked step by step through one
complete game opening: the pre-game setup (character draft → initiative roll),
their own first turn (untap → end-of-turn), and the opponent's first turn —
where they learn the hazard-player role. The tutorial ends when the opponent's
turn ends.

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
| Decks | Two checked-in tutorial decks with explicit play-deck order; **certified cards only** |
| Entry point | Lobby "Play tutorial" → `launchGame(player, 'Mentor', { tutorial: true })`; the human's join is built from the fixed tutorial deck automatically |
| CI guard | A sim-based test replays the entire script headless with ScriptAgents on both sides |

### Why not the alternatives

- **Pre-seeded save file** (`SAVE_DIR` injection): works only for a
  mid-game state; the tutorial must start *before* the draft, and `createGame`
  already produces that state — only the shuffle needs bypassing.
- **Client-side-only gating**: fragile — a stray click would desync the
  script. Server-side filtering keeps the game on rails no matter what the
  client sends, and the reason string doubles as UI feedback.
- **Pseudo-AI mode** (human plays both sides): teaching two seats at once is
  confusing for a first game; the hazard-player role is taught properly in
  Part 3 on the opponent's turn instead.

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

This is a two-site, purely additive change with a unit test
(`orderedDecks: true` → deck order preserved through setup).

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
            └─ text-client tutorial-opponent-client (ScriptAgent, --deck tutorial-mentor)
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

Two new catalog files, picked up automatically by `listDecks`/`findDeckById`:

- `data/decks/tutorial-hero.json` — the human. Hero alignment, wizard avatar,
  starting site Rivendell.
- `data/decks/tutorial-mentor.json` — the scripted opponent ("Mentor"). Also
  hero alignment (avoids CvCC/minion rules noise in a first game).

Deck files carry the play deck **in tutorial order** (see draw budget below).
`validateDeck` only warns, so the undersized (~30 card) tutorial decks start
fine; mark them `approved: false` so they are excluded from normal
matchmaking deck lists (extend `listApprovedDecks` filtering to the lobby
deck picker if not already the case).

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

| # | Role requirement | Candidate | Teaches |
|---|---|---|---|
| P1 | Mid-mind warrior character | Thorin II | first draft pick |
| P2 | Mid-mind warrior/scout | Gimli | second pick |
| P3 | Low-mind scout | Glóin | third pick, ~19/20 mind total |
| P4 | Character that would exceed 20 mind | Legolas | mind-limit rejection (`mind-limit` rule) → goes to deck in character-deck-draft |
| P5–P6 | Two starting minor items | Cram, Miruvor | item draft (`assign-starting-item`, `MAX_STARTING_ITEMS = 2`) |

The Mentor's pool is chosen with **no overlap** with the human's pool so the
draft-collision rule never fires (it is explained in text only — v1 keeps the
happy path).

### Human play deck, in order

Opening hand = cards 1–8. Draw counts at each later point are fixed by the
chosen sites' light/dark box numbers; the table shows the *purpose* each slot
must serve — exact counts are finalized at implementation once the
destination site is locked (see Open questions).

| Slot | Role requirement | Candidate | Used in step |
|---|---|---|---|
| 1 | Low-mind character playable at a Haven under GI | Bilbo | Organization: `play-character` |
| 2 | Hazard-phase defensive short-event | Concealment | M/H: shown as "you could respond" (optional play) |
| 3 | Major item playable at the destination site | Sword of Gondolin (or equivalent) | Site phase: `play-hero-resource` after `enter-site` |
| 4 | Resource long-event (certified) | *(implementation pick)* | Long-event phase: `play-long-event` |
| 5–7 | Inert filler (resources not usable turn 1) | e.g. faction, ally | teaches "not every card is playable now" tooltips |
| 8 | Dead card | any | End-of-turn: voluntary `discard-card` |
| 9–10 | M/H draw-step cards (any) | — | M/H `draw-cards` (mandatory first draw) |
| 11+ | **Hazards for the opponent's turn**: one creature keyed to the Mentor's movement path + one on-guard-able hazard event | Wilderness creature (e.g. Wolves) + corruption/event hazard | Part 3: `play-hazard`, `place-on-guard` |
| … | EOT reset-hand refills | — | draw up to `HAND_SIZE` (8) |

### Mentor play deck, in order

| Slot | Role requirement | Used in step |
|---|---|---|
| 1 | Creature keyed to the human's movement path (Wilderness) | M/H turn 1: scripted `play-hazard` → combat lesson |
| 2 | Hazard event suitable for `place-on-guard` | placed on-guard at the human's destination |
| 3+ | Own resources for turn 2: one character, one item playable at its destination | narrated resource play on the opponent's turn |

---

## Curriculum

Each row is one or more `TutorialStep`s. "You" = the human. All dice are
scripted via `cheatRolls`.

### Part 1 — Setup (`Phase.Setup`, all eight `SetupStep`s)

| Step | State | Instruction & expected action |
|---|---|---|
| 1 | `character-draft` | What the draft is; general influence = 20 mind budget. **Pick Thorin II** (`draft-pick`). Mentor picks simultaneously (scripted). |
| 2–3 | `character-draft` | Pick Gimli, then Glóin. Panel shows running mind total. |
| 4 | `character-draft` | Try Legolas — the panel explains the pick is blocked by the `mind-limit` rule (tooltip shows the reason). **Stop drafting** (`draft-stop`). |
| 5 | `item-draft` | Starting minor items: **assign Cram and Miruvor** to characters (`assign-starting-item` ×2, max 2). |
| 6 | `character-deck-draft` | Undrafted characters can join your deck: **add Legolas to the deck** (`add-character-to-deck`), then `pass`. |
| 7 | `starting-site-selection` | Havens; wizards start at Rivendell. **Select Rivendell** (`select-starting-site`). (Panel notes: two-site avatars — Ringwraiths, Balrog — would next get a `character-placement` step; skipped here.) |
| 8 | `deck-shuffle` | **Shuffle your deck** (`shuffle-play-deck`) — panel explains this normally randomizes; in the tutorial the order is fixed. |
| 9 | `initial-draw` | **Draw your opening hand** (`draw-cards`, 8 = `HAND_SIZE`). Panel tours the hand. |
| 10 | `initiative-roll` | Both roll 2d6 (`roll-initiative`); cheat rolls make **you win and go first**. |

### Part 2 — Your turn (turn 1, you are the *resource player*)

| Step | State | Instruction & expected action |
|---|---|---|
| 11 | `Untap` | Phase order overview (the phase meter is introduced). Nothing is tapped yet — **untap** (`untap`). Mentor silently passes its sideboard option (scripted; explained later in step 24). |
| 12 | `Organization` | Play characters, form companies, plan movement. **Play Bilbo** from hand at Rivendell (`play-character`) — explains direct vs general influence. |
| 13 | `Organization` | **Declare movement** (`plan-movement`): choose the scripted destination (a 2–3 Wilderness-region journey from Rivendell to a site with an automatic-attack and playable major items — canonical candidate: Moria; see Open questions). Then `pass`. |
| 14 | `LongEvent` | Long-events last until your next long-event phase. **Play the long-event** from hand (`play-long-event`), then `pass`. |
| 15 | `MovementHazard` / `select-company` | **Select your company** (`select-company`). |
| 16 | `reveal-new-site` | **Reveal your destination** (`declare-path`, region movement). Panel shows the region path on the map. |
| 17 | (auto) `set-hazard-limit` | Watch-only: the hazard limit = max(company size, 2) — here 4+? computed live; panel points at the limit indicator. |
| 18 | `draw-cards` | Both players draw based on the site's draw numbers. **Draw** (`draw-cards`; first draw is mandatory), then `pass`. |
| 19 | `play-hazards` | The Mentor plays a creature on your company (scripted `play-hazard`). Combat sub-state: **assign strikes** (`assign-strike`), **resolve** (`resolve-strike`) — cheat-rolled so one character taps and defeats the creature (kill marshalling points explained). Panel mentions your Concealment as the kind of card that could have responded. |
| 20 | `play-hazards` | The Mentor places a card **on guard** at your destination (scripted `place-on-guard`) — face-down, counts against the hazard limit. Mentor passes; **you pass**. |
| 21 | `reset-hand` | Both hands refill to hand size (`resolveHandSize`); watch-only or `pass`. |
| 22 | `Site` | **Enter the site** (`select-company`, `enter-site`). The on-guard card is revealed or returned (scripted). Face the site's **automatic-attack**: combat again, this time you resolve strikes yourself with the panel quiet — reinforcement. |
| 23 | `Site` / `play-resources` | **Play the major item** (`play-hero-resource`): taps a character and the site; item marshalling points explained. Then `pass` — panel explains the site phase ends. |
| 24 | `EndOfTurn` | `discard`: **discard the dead card** (`discard-card`), `pass`. `reset-hand`: **draw back up to 8** (`draw-cards`). `signal-end`: `pass` — your turn ends; panel explains Free Council exists but is far off. |

### Part 3 — Opponent's turn (turn 2, you are the *hazard player*)

| Step | State | Instruction & expected action |
|---|---|---|
| 25 | `Untap` | Roles swap: the Mentor untaps (scripted). **Your hazard-player option**: fetching from your sideboard now would halve your hazard limit all turn — decline (`pass`). |
| 26 | `Organization`/`LongEvent` | Watch-only, narrated: the Mentor plays a character and declares movement. You have no actions in these phases. |
| 27 | `MovementHazard` | Mentor reveals its path. **You draw** (`draw-cards`), then **play your creature** on the Mentor's company (`play-hazard`) — keying to regions explained. Combat resolves (Mentor defends, scripted rolls — its character taps). |
| 28 | `play-hazards` | **Place your hazard on guard** at the Mentor's destination (`place-on-guard`). Note the hazard-limit count (2 of N used). Then **pass**. |
| 29 | `Site` | The Mentor enters its site. **Reveal your on-guard card** (`reveal-on-guard`) when prompted — or the panel explains why it whiffs if the keying doesn't apply. Mentor plays an item (narrated). |
| 30 | `EndOfTurn` | Both reset hands (`draw-cards`/`pass`). Turn passes back to you. |
| 31 | — | **Tutorial complete.** Summary panel: marshalling-point totals, the three ways to win, pointers to `docs/player-guide.md` and a real game against the AI. |

Not covered (deliberately, keeps v1 focused): corruption checks, influence
attempts, factions/allies, agents, CvCC, Free Council, deck exhaustion,
draft collisions, under-deeps. Each is one sentence of "you'll meet this
later" in the relevant panel.

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
   suite (fast: one ~2-turn game).
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
| `data/decks/tutorial-hero.json`, `data/decks/tutorial-mentor.json` | arranged decks |

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

1. **Destination site.** Moria is the canonical Rivendell-reachable teaching
   site (automatic-attack + major items playable), but the final choice must
   be validated against the movement map (`packages/shared/src/movement-map.ts`),
   the site's draw numbers (they fix the deck-order draw budget), and
   certification of its automatic-attack. Any Wilderness-path site with an
   automatic-attack and item playability works.
2. **Long-event candidate.** Needs a certified hero resource long-event that
   is sensible on turn 1; if none fits, step 14 becomes explain-and-pass and
   the long-event moves to a later chapter.
3. **Combat outcome for step 19.** Tap-and-defeat is the gentlest first
   combat. Should the site-phase automatic-attack (step 22) instead wound a
   character to teach body checks, or is that chapter-2 material?
4. **Restart granularity.** V1 restarts a step via dev undo (`stateHistory`
   pop). Is whole-tutorial restart (relaunch) acceptable as the only fallback
   when undo crosses a phase boundary awkwardly?
5. **Mentor visibility.** During watch-only steps, should the Mentor's hand
   be revealed to the human (teaching aid) or stay hidden (realism)? Hidden
   is the default projection; revealing would need a projection exception in
   tutorial mode.
6. **Auto-pass interaction.** The existing auto-pass feature
   (`docs/player-guide.md`) could skip steps the tutorial wants to narrate —
   the controller should force it off for the tutorial session.
