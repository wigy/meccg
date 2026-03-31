# Plan: Calling the Council & End Game

## Context

The game currently has no way to end. The type scaffolding exists (`Phase.FreeCouncil`, `Phase.GameOver`, `FreeCouncilPhaseState`, `GameOverPhaseState`, `CallFreeCouncilAction`, `freeCouncilCalled`, `deckExhaustionCount`), and partial scoring logic exists (`computeTournamentBreakdown` handles steps 2-4), but nothing is wired up. The reducer stubs are empty TODOs. This plan implements the full end-game flow per CoE rules section 10 (lines 696-718).

## Scope Decision: Short Game Only

Only implement the **Short ("2-deck") Game** rules for now. The game length variants (Starter/Long/Campaign) follow the same pattern with different thresholds — they can be added later by parameterizing the call conditions. No `gameLength` config field needed yet.

Short game call conditions:
- **Manual call:** MP >= 25 AND exhaustions >= 1, OR exhaustions >= 2
- **Auto-end:** Both players have exhausted their deck twice each

---

## Implementation: 4 Parts

### Part A: Deck Exhaustion

**Why first:** Calling the council depends on `deckExhaustionCount`, which is never incremented.

**Files:**
- `packages/shared/src/engine/reducer.ts` — two TODO sites (~lines 3240, 3979)

**What to build:**
When `player.playDeck.length === 0` after drawing:
1. Return discarded site cards to the player's location deck
2. *(Skip sideboard exchange for now — interactive step, can be added later)*
3. Shuffle the discard pile into a new play deck (using RNG)
4. Increment `deckExhaustionCount`
5. Log the exhaustion event

Extract a helper function `exhaustPlayDeck(state, playerIndex)` since it happens in two places (movement/hazard draw and end-of-turn reset-hand).

### Part B: Calling the Council (End-of-Turn Signal-End)

**Files:**
- `packages/shared/src/engine/legal-actions/end-of-turn.ts` — `signalEndStepActions()`
- `packages/shared/src/engine/reducer.ts` — `handleEndOfTurnSignalEnd()`
- `packages/shared/src/types/state.ts` — add `lastTurnFor` to `GameState`
- `packages/shared/src/engine/init.ts` — initialize `lastTurnFor: null`

**What to build:**

1. **Add `lastTurnFor: PlayerId | null` to `GameState`** — tracks who gets one more turn after a call. Null means no call has been made.

2. **Offer `call-free-council` in `signalEndStepActions()`** when the active player meets Short game conditions:
   - `(computeTournamentScore(state, playerIdx) >= 25 && player.deckExhaustionCount >= 1) || player.deckExhaustionCount >= 2`
   - Only offer if `freeCouncilCalled` is false for this player

3. **Handle `call-free-council` action in reducer:**
   - Set `freeCouncilCalled = true` on the calling player
   - Set `lastTurnFor` to the opponent's ID
   - Otherwise proceed as if `pass` — swap active player, increment turn, go to Untap

4. **Handle turn transition with last-turn tracking:**
   In `handleEndOfTurnSignalEnd` when processing `pass`:
   - If `lastTurnFor === activePlayer` (the opponent just finished their last turn) → transition to `Phase.FreeCouncil` instead of next turn
   - If both players have `deckExhaustionCount >= 2` → transition to `Phase.FreeCouncil` (auto-end)

### Part C: Free Council Phase

**Files:**
- `packages/shared/src/types/state.ts` — expand `FreeCouncilPhaseState`
- `packages/shared/src/engine/legal-actions/free-council.ts`
- `packages/shared/src/engine/reducer.ts` — `handleFreeCouncil()`
- `packages/shared/src/state-utils.ts` — add step 5 (duplicate reveals) and step 6 (avatar penalty)

**State expansion — `FreeCouncilPhaseState`:**
```
step: 'corruption-checks' | 'duplicate-reveals' | 'done'
currentPlayer: PlayerId        // who is making checks / revealing now
checkedCharacters: string[]    // instance IDs already checked
```

**Step 1 — Corruption Checks:**
- Start with the player who took the last turn (the one whose end-of-turn triggered the council)
- For each player, offer corruption-check actions for each non-avatar character (already implemented in `freeCouncilActions`)
- When a player passes (all characters checked or they choose to stop), switch to the other player
- When both done, advance to `'duplicate-reveals'`

**Step 5 — Duplicate Reveals:**
- New action type: `reveal-duplicate` with `{ card: CardInstanceId }` — player reveals a hand card matching an opponent's unique card in play
- Both players get a chance to reveal, then pass
- Each reveal reduces opponent's final score by 1

**Steps 2-4, 6-7 — Automated Scoring:**
- When duplicate reveals are done, compute final scores:
  - `computeTournamentBreakdown()` already handles steps 2-4
  - Apply step 6: if avatar eliminated, subtract 5 from misc
  - Apply step 5 deductions from duplicate reveals
  - Step 7: compare totals
- Transition to `Phase.GameOver`

### Part D: Game Over Phase

**Files:**
- `packages/shared/src/engine/reducer.ts` — add `handleGameOver()` (no-op, terminal state)
- `packages/shared/src/engine/legal-actions/` — game-over returns empty actions (already configured)

**What to build:**
- `GameOverPhaseState` already has `winner` and `finalScores` — just populate them correctly when transitioning from Free Council
- The reducer returns unchanged state for any action (game is over)
- Clients can read the phase state to display results

---

## Implementation Order

1. **Part A** (deck exhaustion) — prerequisite for everything
2. **Part B** (calling the council) — depends on A for exhaustion count
3. **Part C** (Free Council phase) — the endgame sequence
4. **Part D** (Game Over) — simple terminal state

## New Action Types Needed

- `reveal-duplicate` — for Free Council step 5

## New State Fields

- `GameState.lastTurnFor: PlayerId | null`
- Expanded `FreeCouncilPhaseState` with step/currentPlayer/checkedCharacters

## Files Modified (summary)

| File | Changes |
|---|---|
| `packages/shared/src/types/state.ts` | Add `lastTurnFor` to GameState, expand FreeCouncilPhaseState |
| `packages/shared/src/types/actions.ts` | Add `RevealDuplicateAction` |
| `packages/shared/src/types/phases.ts` | Add `reveal-duplicate` to FreeCouncil legal actions |
| `packages/shared/src/engine/init.ts` | Initialize `lastTurnFor: null` |
| `packages/shared/src/engine/reducer.ts` | Deck exhaustion helper, call-free-council handling, Free Council logic, Game Over |
| `packages/shared/src/engine/legal-actions/end-of-turn.ts` | Offer call-free-council when eligible |
| `packages/shared/src/engine/legal-actions/free-council.ts` | Multi-step actions (corruption checks + duplicate reveals) |
| `packages/shared/src/state-utils.ts` | Add avatar elimination penalty to scoring |

## Verification

- Implement the 16 `test.todo()` stubs in `packages/shared/src/tests/rules/15-ending-game.test.ts` as we go (via PR per CLAUDE.md policy)
- Manual testing: start a game, accumulate 25+ MP, exhaust deck, verify call-free-council appears, verify opponent gets last turn, verify Free Council sequence runs
- Run `npm test`, `npm run test:nightly`, `npm run lint` before committing

## Deferred (out of scope)

- Sideboard exchange on deck exhaustion (interactive multi-step, add later)
- Game length variants (Starter/Long/Campaign) — just parameterize thresholds later
- Winning with The One Ring (separate victory condition)
- Ringwraith/Balrog Sudden Call restriction
- Fallen-wizard/Balrog MP special rules
- Web client UI for Free Council and Game Over screens
- Tiebreaker rounds
