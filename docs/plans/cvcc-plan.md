# Company vs Company Combat (CvCC) — Engine & UI

## Context

CvCC is a core MECCG mechanic where one player's company attacks another player's company at the same site. The rules are fully documented in `docs/coe-rules.md` (3.V) and test skeletons exist in `rule-8.38` through `rule-8.42`. The `AttackSource` type already has a `'company-attack'` variant, but no engine logic, legal actions, or UI support exists yet.

CvCC reuses the combat sub-state machine but differs from creature combat in several key ways:

- **Per-strike prowess**: each strike has the attacking character's prowess, not a single value
- **Both sides roll**: attacker rolls 2d6 + prowess too (not just defender)
- **Attacker can be wounded**: if defender wins, attacker character gets body check
- **Three-phase strike assignment**: defender-untapped → attacker-untapped → defender-any
- **Both sides choose -3**: both attacker and defender can opt to stay untapped
- **Attacker taps**: winning attacker taps (unless -3)
- **No excess strikes**: each strike is backed by a specific attacking character (no -1 prowess overflow)

## Phase 1: Type Foundation

No behavioral changes — extend types so everything compiles.

### Files: `packages/shared/src/types/state.ts`

1. Add `'declare-company-attack'` to `SiteStep` union
2. Add `'defender-any'` to `assignmentPhase` union type on `CombatState` (currently: `'defender' | 'attacker' | 'done'`)
3. Add `isCvCC: boolean` to `CombatState` (discriminator for CvCC-specific logic)
4. Add `'attacker-character'` to `bodyCheckTarget` union type on `CombatState` (currently: `'character' | 'creature' | null`)
5. Add `attackingCharacterId?: CardInstanceId` to `StrikeAssignment` (which attacking char commits this strike)
6. Add `attackerResult?: 'success' | 'wounded' | 'eliminated'` to `StrikeAssignment`
7. Add `attackerTapToFight?: boolean` to `StrikeAssignment` (tracks attacker's -3 choice)

**Note:** `SitePhaseState` already has `opponentInteractionThisTurn: 'influence' | 'attack' | null` — use this instead of adding separate booleans. Set it to `'attack'` when a company attack is declared.

### Files: `packages/shared/src/types/actions.ts`

1. Add `DeclareCompanyAttackAction` interface:

   ```typescript
   { type: 'declare-company-attack'; player: PlayerId;
     attackingCompanyId: CompanyId; targetCompanyId: CompanyId }
   ```

2. Add to `GameAction` union
3. Add optional `attackingCharacterId?: CardInstanceId` to `AssignStrikeAction` (for CvCC attacker phase)

### Files: `packages/shared/src/types/phases.ts`

1. Add `'declare-company-attack'` to the site phase legal action list

### Initialization

Update all `CombatState` construction sites (creature combat, auto-attack, agent) to set `isCvCC: false`. The `detainment` field should be `false` for CvCC combats.

## Phase 2: CvCC Initiation (Site Phase)

### Files: `packages/shared/src/engine/legal-actions/site.ts`

1. Add `declareCompanyAttackActions()` handler for `step === 'declare-company-attack'`:
   - Only the active (resource) player can declare
   - Find opponent companies at the same site as the current company
   - Check: `siteState.siteEntered === true`
   - Check: `siteState.opponentInteractionThisTurn === null` (no prior attack or influence this turn)
   - Check alignment restrictions (use helper from Phase 2 reducer work)
   - Return `declare-company-attack` action per valid target, plus `pass`
2. Wire into `siteActions()` dispatcher alongside the existing step cases

### Files: `packages/shared/src/engine/reducer.ts`

1. Add alignment validation helper `canAttackAlignment()` — implement the full matrix from rule 8.41 (Wizard, Ringwraith, Fallen-wizard covert/overt, Balrog)
2. **Modify play-resources pass flow**: Currently, pass at `play-resources` calls `advanceSiteToNextCompany()` directly (line ~4483). Change this to transition to `step: 'declare-company-attack'` instead, so the player gets the opportunity to attack before moving on.
   - Must respect the existing `pendingResourceAction` / `awaitingOnGuardReveal` workflow: the declare-company-attack step should only be reached after all on-guard windows and pending actions have fully resolved.
3. Add `handleDeclareCompanyAttack()`:
   - Validate eligibility (same site, entered, `opponentInteractionThisTurn === null`, alignment)
   - Create `CombatState` with `isCvCC: true`, `strikesTotal = attackingCompany.characters.length`, `strikeProwess = 0` (unused for CvCC), `creatureBody = null`, `detainment = false`
   - Set `opponentInteractionThisTurn = 'attack'` on `SitePhaseState`
4. Handle `pass` during `declare-company-attack` → `advanceSiteToNextCompany()`

## Phase 3: CvCC Strike Assignment

### Files: `packages/shared/src/engine/legal-actions/combat.ts`

Modify `assignStrikeActions()` for `combat.isCvCC`:

- **Phase `'defender'`**: Defender picks their untapped characters to face strikes (same as creature combat, but `excessStrikes` is not used — each strike is one attacking character). `pass` transitions to attacker phase.
- **Phase `'attacker'`**: Attacker picks one of their untapped characters AND a target defending character. The action carries both `characterId` (defender) and `attackingCharacterId` (attacker). Can target:
  - A defender already named in phase 1 who lacks an attacker pairing
  - An unassigned defending character
  - `pass` transitions to `'defender-any'` if unpaired strikes remain, else `'done'`
- **Phase `'defender-any'`**: Defender assigns remaining unpaired attackers to any of their characters (including tapped/wounded). No pass — must assign all remaining.

### Files: `packages/shared/src/engine/reducer.ts`

1. Modify `handleAssignStrike()` to accept `attackingCharacterId` and store it in `StrikeAssignment`
2. Modify `handleCombatPass()` for CvCC: `'defender'` → `'attacker'` → `'defender-any'` → `'done'`
3. Validate that in attacker phase, the `attackingCharacterId` belongs to the attacking company and is untapped and not already committed to another strike

## Phase 4: CvCC Strike Order & Resolution

### Choose-Strike-Order

The existing `choose-strike-order` phase (via `nextStrikePhase()` / `chooseStrikeOrderActions()`) already lets the defender pick which strike to resolve next when multiple unresolved strikes remain. This works for CvCC without changes — the defender picks the order, and when only one strike remains it auto-selects.

### Files: `packages/shared/src/engine/legal-actions/combat.ts`

Modify `resolveStrikeActions()` for `combat.isCvCC`:

- **Attacker resolves first** (step 3): when `playerId === combat.attackingPlayerId`, offer tap/untap (-3) choice for the attacking character
- **Defender resolves second** (step 4): when `playerId === combat.defendingPlayerId`, offer tap/untap (-3) choice + support from untapped characters not facing strikes
- This means the resolve-strike phase becomes a **two-step sub-phase** for CvCC:
  - Sub-step 1: attacker chooses -3 or not → store `attackerTapToFight` on the strike assignment
  - Sub-step 2: defender chooses -3 or not + support → both roll

Track this with `attackerTapToFight` on `StrikeAssignment`: when `undefined`, attacker hasn't chosen yet.

**Support in CvCC**: The existing `SupportStrikeAction` allows untapped characters without strikes to support the defender. For CvCC, both sides should be able to support:
- Defender's untapped characters not facing strikes can support the defending character (+1 each)
- Attacker's untapped characters not committed to strikes can support the attacking character (+1 each)
- Support actions should be available during the respective player's sub-step

### Files: `packages/shared/src/engine/reducer.ts`

Modify `handleResolveStrike()` for CvCC:

1. **Attacker's turn** (sub-step 1): Store `attackerTapToFight` on the current strike assignment. Don't roll yet — return to resolve-strike phase for the defender.
2. **Defender's turn** (sub-step 2): Both roll.
   - Compute defender prowess (same as creature combat, using defender's `tapToFight`)
   - Compute attacker prowess from `strike.attackingCharacterId`'s effective stats, applying -3 if `!attackerTapToFight`, -1 if tapped, -2 if wounded
   - Both roll 2d6 + prowess
   - Compare totals:
     - **Defender wins**: strike fails, defender taps (unless -3), attacker wounded → `bodyCheckTarget: 'attacker-character'`
     - **Attacker wins**: strike succeeds, attacker taps (unless -3), defender wounded → `bodyCheckTarget: 'character'`
     - **Tie**: both tap (unless -3), no wound, no body check

## Phase 5: CvCC Body Check & Finalization

### Files: `packages/shared/src/engine/legal-actions/combat.ts`

Modify `bodyCheckActions()`:

- When `bodyCheckTarget === 'attacker-character'`: the **defending** player rolls body check (they won). Look up attacking character's body from `strike.attackingCharacterId`.

### Files: `packages/shared/src/engine/reducer.ts`

1. Modify `handleBodyCheckRoll()` to handle `'attacker-character'`:
   - Look up attacking character from `strike.attackingCharacterId`
   - Roll against attacker character's body value
   - On fail: wound/eliminate the attacking character (from attacker's player state)
   - Store result in `strike.attackerResult`
2. Modify `finalizeCombat()` for CvCC:
   - No creature card to move (no `creatureInstanceId` — existing code already handles this by only moving creature cards when `creatureInstanceId` is non-null)
   - Eliminated characters from either side count as kill MP for the opponent
   - Clear combat, return to site phase → `advanceSiteToNextCompany()`

## Phase 6: UI

### Files: `packages/lobby-server/src/browser/combat-view.ts`

The main entry point is `renderCombatView()`. Modify it for CvCC:

1. **Attacker row**: When `attackSource.type === 'company-attack'`, render the attacking company's characters as columns (like defender row) instead of a single creature card. Each column shows the character card image, prowess/body badge, and combat result overlays.

2. **Strike arrows**: For CvCC, draw arrows from individual attacking character elements to defender character elements using `strike.attackingCharacterId`.

3. **Phase banner**: For CvCC, show "Company vs Company Combat" label. During resolve-strike, show both sides' prowess/need explanations.

4. **Action buttons**: During CvCC resolve-strike:
   - Attacker's turn: show "Tapped"/"Untapped" for their -3 choice
   - Defender's turn: show "Tapped"/"Untapped" for their -3 choice (same as creature combat)

5. **Site phase UI**: Add rendering for the `declare-company-attack` step — show opponent companies at the same site as clickable targets.

## Verification

1. `npm run build` — type-check passes after each phase
2. Implement tests in `rule-8.38` through `rule-8.42` as each phase completes:
   - Phase 2: `rule-8.40` (initiation), `rule-8.41` (alignment)
   - Phase 3: `rule-8.38` (strike assignment order)
   - Phase 4: `rule-8.39` (strike sequence, both roll, choose-strike-order integration)
   - Phase 5: `rule-8.42` (hazard restrictions), body check tests
3. Manual testing: start a game with two players at the same site, verify CvCC flow end-to-end in the browser UI
4. `npm test` and `npm run test:nightly` pass before pushing

## Key Files

| File | Changes |
|------|---------|
| `packages/shared/src/types/state.ts` | `CombatState`, `StrikeAssignment`, `SiteStep` extensions |
| `packages/shared/src/types/actions.ts` | `DeclareCompanyAttackAction`, `AssignStrikeAction` extension |
| `packages/shared/src/types/phases.ts` | Add CvCC actions to site phase |
| `packages/shared/src/engine/reducer.ts` | Initiation handler, 3-phase assignment, dual-roll resolution, attacker body check, finalization |
| `packages/shared/src/engine/legal-actions/site.ts` | `declareCompanyAttackActions()`, wire into dispatcher, modify play-resources pass flow |
| `packages/shared/src/engine/legal-actions/combat.ts` | CvCC branches in assign, resolve, body-check action generators |
| `packages/lobby-server/src/browser/combat-view.ts` | Attacker row as characters, CvCC arrows, banner, buttons |
| `packages/shared/src/tests/rules/08-combat/rule-8.38-*.test.ts` | Tests for each rule |
