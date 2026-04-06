# Combat Implementation Plan

## Current State

The codebase already has significant scaffolding:

- `CombatState` type defined in `state.ts` with phases, strike assignments, attack sources
- Action types `assign-strike`, `resolve-strike`, `support-strike` defined
- `formatCombat` and `describeAction` already handle combat formatting
- `08-combat.test.ts` exists with `test.todo()` entries
- Creature play in M/H phase has a **placeholder** that skips combat and discards directly

## Phase 1 — Core Combat Engine

### State Additions

Extend `CombatState` with: `defendingPlayerId`, `attackingPlayerId`, `excessStrikes`, `bodyCheckTarget`.

New sub-phases: `'choose-strike-order'` and `'resolve-attack'` alongside existing `'assign-strikes' | 'resolve-strike' | 'body-check'`.

### New Action Types

- `BodyCheckRollAction` — triggers opponent rolling 2d6 for the body check
- `ChooseStrikeOrderAction` — defending player picks which assigned strike resolves next

### Legal Actions

New file `combat.ts` in `engine/legal-actions/`. Intercept in `computeLegalActions` — if `state.combat` is non-null, route to combat handler instead of phase handler.

Each sub-phase computes different choices:

- **assign-strikes**: One action per eligible untapped character. After defender passes, attacker assigns remaining.
- **choose-strike-order**: One action per unresolved strike assignment.
- **resolve-strike**: Tap-to-fight vs stay-untapped (-3 prowess), plus support options.
- **body-check**: Opponent gets a roll action.
- **resolve-attack**: Auto-advance, no player actions.

### Reducer

Replace the creature placeholder in M/H reducer to create `CombatState`. Implement the sub-phase state machine:

1. **assign-strikes** → validate character is in defending company, not already assigned. Add `StrikeAssignment`.
2. **choose-strike-order** → set `currentStrikeIndex` to chosen strike.
3. **resolve-strike** → compute effective prowess (base + modifiers), roll 2d6, compare vs strike prowess:
   - Roll > strike prowess: strike fails, character taps (unless -3 applied), body check against creature if it has body
   - Roll < strike prowess: strike succeeds, character wounded, body check against character
   - Roll = strike prowess: ineffectual, character taps
4. **body-check** → roll 2d6, if roll > body: entity fails (character eliminated or creature defeated)
5. **resolve-attack** → evaluate overall outcome:
   - All strikes defeated → creature to defender's MP pile (kill points)
   - Any strike not defeated → creature to hazard player's discard pile
   - Handle character elimination (move to eliminatedPile)
   - Clear `state.combat = null`, return to enclosing phase

### Two Combat Entry Points

1. **Creature hazards during M/H phase**: Replace the placeholder at reducer line ~2299
2. **Automatic attacks during site phase**: Wire into the automatic-attacks step

### Combat Exit

- **M/H phase**: Returns to `play-hazards` step
- **Site phase**: Returns to `automatic-attacks` step with counter incremented

## Phase 2 — Combat Modifiers

| Modifier | Effect |
|---|---|
| Tapped | -1 prowess |
| Wounded | -2 prowess |
| Stay untapped | -3 prowess (no tap) |
| Support | +1 prowess per supporting character |
| Excess strikes | -1 prowess per excess strike |
| Detainment | Tap instead of wound, no body checks, no MP |

## Phase 3 — UI

### Web UI

New `renderCombatInfo()` function showing:

- Creature card image (or "Automatic Attack" text with prowess/strikes)
- Strike assignment grid: which character faces which strike
- Prowess calculation breakdown during resolution
- Dice roll results
- Outcome display ("Strike defeated!", "Character wounded!", "Character eliminated!")

Company view enhancements during combat:

- Characters with assigned strikes: red/orange border
- Resolved strikes: green (defeated) or red (wounded/eliminated) indicators
- Prowess/body stats displayed prominently

CSS classes:

- `.combat-active` — highlight the attacking creature
- `.strike-assigned` — character has a pending strike
- `.strike-defeated` — green glow for defeated strike
- `.character-wounded` — red tint for wounded characters
- `.character-eliminated` — greyed out / crossed out

Action buttons already work via existing `describeAction` cases for combat actions.

### Text UI

`formatCombat` already renders combat state. Add command parsers for:

```text
assign-strike <characterInstId>
resolve-strike [tap|untap]
support-strike <supporterId> <targetId>
body-check-roll
choose-strike-order <strikeIndex>
```

## Phase 4 — Advanced

- Character elimination cleanup (item transfer, follower handling)
- Kill MP tracking
- On-guard creature combat during site phase
- Agent combat

## Testing Strategy

All tests in `packages/shared/src/tests/rules/08-combat.test.ts`, implementing existing `test.todo()` entries.

### Test Helper Additions

- `buildCombatState()` — constructs a game state mid-combat
- `buildMovementHazardState()` — creates state in M/H `play-hazards` step with a moving company

### Key Test Cases (priority order)

1. Creature play triggers combat (state.combat non-null with correct strikes/prowess)
2. Strike assignment — untapped characters only, at most one strike each
3. Opponent assigns remaining strikes after defender passes
4. Excess strikes become -1 prowess modifiers
5. Character defeats strike (high roll, character taps, body check vs creature)
6. Strike wounds character (low roll, character wounded, body check vs character)
7. Tie — ineffectual, character taps
8. Body check — character eliminated (roll > body)
9. Body check — character survives (roll <= body)
10. All strikes defeated → creature to MP pile
11. Any strike not defeated → creature to discard pile
12. Tapped character -1 prowess penalty
13. Wounded character -2 prowess penalty
14. Support +1 prowess
15. Automatic attack combat from site entry
16. Detainment handling
17. Combat exit returns to enclosing phase

## Implementation Sequence

1. Enhance types + new actions
2. `combat.ts` legal actions (intercept before phase dispatch)
3. Combat reducer sub-phase handlers
4. Wire entry points (M/H creature play, site auto-attacks)
5. Tests (implement `test.todo()` entries in `08-combat.test.ts`)
6. Web UI combat panel + CSS
7. Text UI action parsers
