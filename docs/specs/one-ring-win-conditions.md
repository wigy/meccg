# Spec: The One Ring winning condition for every alignment

Status: **Draft** · Author: planning pass · Date: 2026-06-08

## 1. Goal

Make winning the game with **The One Ring** (`tw-347`) work correctly for **all four
alignments**, and **record how the game was won** in the game result records.

Today only the Ringwraith (Minion) path is partially wired, and it does not
actually force a win. The other three alignments are not implemented at all, and
no result record distinguishes a One Ring win from a normal marshalling-point win.

## 2. Background — the four win conditions (CoE rule 10.39 / MELE §1)

Each alignment has a different way of winning with The One Ring. Card text from
`data/cards.json`:

| Alignment | Card | ID | Trigger / condition |
|-----------|------|----|---------------------|
| **Minion** (Ringwraith) | *(positional — no card)* | — | Ringwraith's company bears The One Ring at **Barad-dûr** (`tw-374` hero / `le-352` minion). Immediate win. |
| **Hero** (Wizard) | **Cracks of Doom** | `tw-205` | Only playable if The One Ring is at **Mount Doom** (`tw-414`/`le-393`) during the site phase. Bearer makes a corruption check **modified by −4**. On success, the Ring is destroyed and **its bearer's player wins**. |
| **Hero** (Wizard) | **Gollum's Fate** | `tw-247` | Only playable if The One Ring **and Gollum** (`tw-246`) are both at Mount Doom during the site phase. The Ring is destroyed and the **bearer's player wins** (no roll). |
| **Fallen-wizard** | **A New Ringlord** | `wh-60` | Played on the Fallen-wizard while he bears The One Ring at one of your Wizardhavens. Each end-of-turn phase, if the FW bears the Ring at a Ruins & Lairs where Information is playable, roll 2d6 **+1 per *A New Ringlord* in play**: `<6` FW eliminated; `>9` **you win**. |
| **Balrog** | **Challenge the Power** | `ba-52` | Playable on The Balrog if he bears The One Ring. Roll 2d6 **+1 per sage in his company and per other *Challenge the Power* in play**: `<7` Balrog eliminated; `7–8` discard; `9–10` gain 2 MP and the Ring affects the Balrog; `>10` **you win**. Cannot be duplicated on a given turn. |

Alignment enum lives in `packages/shared/src/types/common.ts` (`Wizard`, `Ringwraith`,
`FallenWizard`, `Balrog`).

## 3. Current implementation & gaps

### 3.1 What exists

- `checkOneRingWin(state)` — `packages/shared/src/engine/reducer-end-of-turn.ts:292`.
  Returns the Ringwraith's id when its company bears `tw-347` at Barad-dûr.
- It is called from the end-of-turn `signal-end` step
  (`reducer-end-of-turn.ts:331`) on `pass`, and on a hit calls
  `transitionToFreeCouncil(state, oneRingWinner)`.
- Win-condition cards are referenced only in deck validation
  (`deck-validation.ts:62,64`) and the rules test
  `tests/rules/10-corruption-influence-endgame/rule-10.39-winning-with-one-ring.test.ts`.

### 3.2 Gaps (why this is broken / incomplete)

1. **The "win" is not actually forced.** `transitionToFreeCouncil(state, winner)`
   only uses `winner` as `lastTurnPlayer` (who runs corruption checks first —
   `reducer-end-of-turn.ts:545`). The real winner is then **recomputed purely from
   marshalling points** in `computeFinalScoresAndEnd`
   (`reducer-free-council.ts:390-392`). A Ringwraith with the Ring at Barad-dûr but
   fewer MP would still *lose*. There is no "forced winner" channel in the state.
2. **One Ring wins should be immediate**, not routed through Free Council
   corruption checks. Current code runs the whole Free Council flow.
3. **No win reason is recorded.** `GameOverPhaseState`
   (`state-phases.ts:751`) has only `winner` / `finalScores` / `finishedPlayers`,
   and the games.json record (`game-session.ts:732-743`) has no field saying the
   game was won by The One Ring vs. by scoring.
4. **Three alignments unimplemented.** `tw-205`, `tw-247`, `wh-60`, `ba-52` do not
   exist as card definitions in `packages/shared/src/data/*.json`, and there is no
   `win-game` effect in the DSL (`docs/card-effects-dsl.md`).
5. **The existing rule-10.39 test is weak** — it only asserts the phase becomes
   `FreeCouncil`, not that the Ringwraith actually wins.

## 4. Design

### 4.1 Win-reason data model (foundation)

Add a structured win reason carried into the terminal state and the records.

In `packages/shared/src/types/common.ts` (or a small new `win.ts`):

```ts
/** How a finished game was decided. */
export type WinReason =
  | { kind: 'marshalling-points' }                 // normal CoE §10.3 endgame scoring
  | { kind: 'one-ring'; alignment: Alignment; card: CardDefinitionId | null };
  //   card = the played win card (tw-205/tw-247/wh-60/ba-52);
  //   card = null for the Ringwraith positional win (MELE §1)
```

Extend `GameOverPhaseState` (`state-phases.ts:751`):

```ts
export interface GameOverPhaseState {
  readonly phase: Phase.GameOver;
  readonly winner: PlayerId | null;
  readonly finalScores: Readonly<Record<string, number>>;
  readonly finishedPlayers: readonly string[];
  readonly winReason: WinReason;          // NEW
}
```

`finalScores` is still computed (for display) on a One Ring win; only `winner` is
forced and `winReason` records the cause.

### 4.2 A single `winGame` engine primitive

Refactor `computeFinalScoresAndEnd` (`reducer-free-council.ts:333`) so the
score-computation is reusable, then add:

```ts
/**
 * Build the terminal GameOver state. For a One Ring win, `forcedWinner` is set
 * and scoring does NOT decide the winner; final scores are still computed for
 * the result screen. For a normal endgame, pass forcedWinner = undefined and the
 * higher score wins (existing behaviour).
 */
function endGame(
  state: GameState,
  reason: WinReason,
  forcedWinner?: PlayerId,
): GameState
```

- `computeFinalScoresAndEnd` becomes `endGame(state, { kind: 'marshalling-points' })`.
- One Ring wins call `endGame(state, reason, winnerId)` and **skip Free Council
  entirely** (transition straight to `GameOver`). This corrects gap #1 and #2.

All four alignment paths funnel through `endGame(..., forcedWinner)`, guaranteeing
a single, well-logged "winner is forced because of The One Ring" code path
(`logHeading`/`logResult` per the shared logging policy).

### 4.3 A `win-game` DSL effect

Add a terminal effect type to the card DSL (document in `docs/card-effects-dsl.md`):

```jsonc
{ "type": "win-game", "via": "one-ring" }   // resolves to endGame(forcedWinner = controller)
```

The reducer maps this to `endGame(state, { kind:'one-ring', alignment, card }, controller)`.
This is the shared mechanism behind Cracks of Doom / Gollum's Fate / A New Ringlord
/ Challenge the Power so each card only declares its **conditions** and **roll
thresholds**, not bespoke win plumbing.

### 4.4 Per-alignment trigger points

| Alignment | Where the check fires | Implementation |
|-----------|----------------------|----------------|
| **Ringwraith** | end-of-turn `signal-end` on `pass` (existing `checkOneRingWin`) | Replace the `transitionToFreeCouncil` call with `endGame(state, { kind:'one-ring', alignment: Ringwraith, card: null }, winner)`. Keep the Barad-dûr / `tw-347` detection. |
| **Hero — Gollum's Fate** | site phase, on play of `tw-247` | Card play-condition: One Ring (`tw-347`) **and** Gollum (`tw-246`) in the acting company at Mount Doom (`tw-414`/`le-393`). Effect: `win-game` (no roll). |
| **Hero — Cracks of Doom** | site phase, on play of `tw-205` | Play-condition: One Ring at Mount Doom. Effect: enqueue a **corruption check with `check-modifier corruption −4`** on the Ring's bearer; on **success** → `win-game`; on failure → normal corruption resolution (Ring may be lost). Needs a "corruption-check-success ⇒ effect" hook (see §4.5). |
| **Fallen-wizard — A New Ringlord** | on play (staging on the FW at a Wizardhaven) **and** an end-of-turn scan | Staged/persistent card. Reuse the existing end-of-turn scanner pattern (see `docs/card-effects-dsl.md` "end-of-turn scanner"). Each end-of-turn: if FW bears `tw-347` at an R&L where Information is playable, roll 2d6 +1 per in-play `wh-60`; `>9` → `win-game`; `<6` → eliminate FW. |
| **Balrog — Challenge the Power** | on play of `ba-52` | Play-condition: The Balrog bears `tw-347`; once-per-turn guard. On play roll 2d6 +1 per sage in company + per other in-play `ba-52`; `>10` → `win-game`; `9–10` → +2 MP & keep; `7–8` → discard; `<7` → eliminate Balrog. |

Helpers already available to lean on: `sage-in-company` notion exists in the cost
evaluator (`cost-evaluator.ts:68`); Barad-dûr/One Ring constants in `card-ids.ts`
(`THE_ONE_RING`, `BARAD_DUR_HERO`, `BARAD_DUR_MINION`). New constants needed:
`MOUNT_DOOM_HERO = tw-414`, `MOUNT_DOOM_MINION = le-393`, `GOLLUM = tw-246`, and the
four win-card ids (promote to `card-ids.ts` only once referenced by >1 file, per the
package policy).

### 4.5 Corruption-check-success hook (Cracks of Doom only)

Cracks of Doom needs "on a successful corruption check, win". The corruption-check
resolution path (`reducer-free-council.ts` `resolveCorruptionCheck`, and the
end-of-turn corruption scanner) must support attaching a follow-up effect keyed to
the check outcome. Simplest scoped approach: the enqueued corruption check carries
an `onSuccess: { type:'win-game', ... }` effect that the resolver runs when the
check passes. This is a small, contained extension to the corruption-check payload.

### 4.6 Result recording

- **Engine → record:** `game-session.ts` `recordGameResult` (`:732`) adds
  `winReason` (and a denormalised `winCard` / `winAlignment` for convenience) read
  from `goState.winReason`. This satisfies the "recorded in game result records"
  requirement.

  ```ts
  const entry = {
    ...existing,
    winReason: goState.winReason.kind,                 // 'one-ring' | 'marshalling-points'
    winCard: goState.winReason.kind === 'one-ring' ? goState.winReason.card : null,
  };
  ```

- **UI:** `packages/lobby-server/src/browser/render-game-over.ts` shows a banner
  like "<player> wins with The One Ring (Cracks of Doom)" when
  `winReason.kind === 'one-ring'`, instead of the scoring-table winner line.

## 5. Files to change

Engine / shared:

- `packages/shared/src/types/common.ts` (or new `win.ts`) — `WinReason` type.
- `packages/shared/src/types/state-phases.ts` — `GameOverPhaseState.winReason`.
- `packages/shared/src/engine/reducer-free-council.ts` — refactor to `endGame()`;
  corruption-check `onSuccess` hook.
- `packages/shared/src/engine/reducer-end-of-turn.ts` — Ringwraith path → `endGame`
  with forced winner; FW end-of-turn scan for `wh-60`.
- `packages/shared/src/engine/` (site-phase / card-effect resolver) — `win-game`
  effect; play-conditions for `tw-205`, `tw-247`, `ba-52`.
- `packages/shared/src/data/tw-resources.json` — add `tw-205`, `tw-247`.
- `packages/shared/src/data/wh-resources.json` (new) — add `wh-60`.
- `packages/shared/src/data/ba-resources.json` (new) — add `ba-52`.
- `packages/shared/src/card-ids.ts` — Mount Doom + Gollum + win-card constants.
- `docs/card-effects-dsl.md` — document `win-game` and the corruption `onSuccess`.

Server / UI:

- `packages/game-server/src/ws/game-session.ts` — record `winReason`.
- `packages/lobby-server/src/browser/render-game-over.ts` — One Ring win banner.

## 6. Testing plan

Per the package testing philosophy (rules-as-spec + per-card nightly tests):

- **Strengthen** `rule-10.39-winning-with-one-ring.test.ts`:
  - Ringwraith at Barad-dûr with the Ring **wins even with fewer MP** (assert
    `phaseState.winner === ringwraith` and `winReason.kind === 'one-ring'`),
    closing gap #5.
  - One sub-test per alignment (currently `test.todo` style) asserting the forced
    winner and `winReason`.
- **Card tests** (`tests/cards/`, nightly), one per card:
  - `tw-205` Cracks of Doom — playable only with Ring at Mount Doom; −4 check;
    success ⇒ win, failure ⇒ no win.
  - `tw-247` Gollum's Fate — requires Ring + Gollum at Mount Doom; immediate win.
  - `wh-60` A New Ringlord — staging condition; end-of-turn roll thresholds (`>9`
    win, `<6` eliminate); +1 per copy in play.
  - `ba-52` Challenge the Power — roll thresholds (`>10` win, `9–10` +2 MP, `7–8`
    discard, `<7` eliminate); +1 per sage / per copy; once-per-turn.
- **Record test:** a game-server-level check that a One Ring win writes
  `winReason: 'one-ring'` (+ `winCard`) to `games.json`.

## 7. Suggested sequencing

1. **Phase 1 — Win plumbing & records (foundation).** `WinReason`,
   `GameOverPhaseState.winReason`, `endGame()` refactor, fix the Ringwraith path to
   force the win, record `winReason` in `games.json`, UI banner, strengthen the
   10.39 Ringwraith test. *This alone makes one alignment correct and fully
   satisfies the "recorded in result records" requirement.*
2. **Phase 2 — `win-game` DSL effect + corruption `onSuccess` hook.**
3. **Phase 3 — Hero cards** (`tw-247` simplest first, then `tw-205`).
4. **Phase 4 — Fallen-wizard** (`wh-60`, end-of-turn scanner + staging).
5. **Phase 5 — Balrog** (`ba-52`).

Each phase is independently shippable and testable.

## 8. Open questions / decisions

1. **Bypass Free Council on a One Ring win?** Recommended: **yes** — a One Ring win
   is immediate (MELE §1); skip corruption checks and go straight to `GameOver`
   with the forced winner. (Current code wrongly routes through Free Council.)
2. **`winReason` granularity in records:** store just `kind`, or also `card` /
   `alignment`? Recommended: store all three (cheap, useful for stats).
3. **"Information is playable at an R&L" and Wizardhaven detection** for A New
   Ringlord — confirm existing site-attribute helpers cover this, or add them.
4. **Failed Cracks of Doom corruption check** — confirm the standard consequence
   (corruption-check failure handling already in the engine) is what we want, or
   whether the card specifies a different outcome.
