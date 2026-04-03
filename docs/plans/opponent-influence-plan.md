# Influence Checks vs Opponent's Cards

## Context

The game currently supports faction influence attempts (playing your own factions from hand with a 2d6 roll). The rules (CoE section 8, rules 10.10-10.16) define a separate mechanic: **influencing an opponent's in-play cards** to discard them. This involves two dice rolls (attacker + defender), modifier calculations (DI, GI, controller DI), and optional identical-card reveals. Test skeletons exist at `tests/rules/10-corruption-influence-endgame/rule-10.10` through `10.16` (all `.todo()`).

This plan covers engine (shared package) and UI (lobby-server browser).

## Key Design Decisions

1. **New action type `opponent-influence-attempt`** — separate from existing `influence-attempt` (which handles playing factions from hand). The mechanics are fundamentally different: two rolls, targets opponent's in-play cards, results in discard not play.

2. **Both rolls in a single reducer call** — the defender has no strategic choice about their roll, so no reason to split into two actions. The reducer calls `roll2d6()` twice, emitting two `DiceRollEffect` entries.

3. **Identical card reveal as an optional field on the action** (`revealedCardInstanceId?`). Legal action generation produces two action variants (with/without reveal) for character/ally/faction targets, and only with-reveal for items.

4. **New `opponentInteractionThisTurn` field on `SitePhaseState`** — tracks whether influence or CvCC attack has been made this turn (mutual exclusivity rule).

5. **Phased delivery** — Phase 1: characters and allies (no reveal). Phase 2: identical card reveal + post-success play. Phase 3: factions, items, cross-alignment penalties.

---

## Phase 1: MVP — Character & Ally Influence

### Step 1: Add `mind` to ally card types

Allies need a `mind` field for the comparison value.

**`packages/shared/src/types/cards.ts`**
- Add `readonly mind: number;` to `HeroAllyCard` (~line 237) and `MinionAllyCard` (~line 610)

**`packages/shared/src/data/tw-resources.json`** (and other ally data files)
- Add `mind` values from authoritative `data/cards.json` to each ally entry

**`packages/shared/src/types/cards.ts`** — update `isAllyCard()` type guard if needed

### Step 2: New action type

**`packages/shared/src/types/actions.ts`** — add after `InfluenceAttemptAction` (line ~635):

```typescript
export interface OpponentInfluenceAttemptAction {
  readonly type: 'opponent-influence-attempt';
  readonly player: PlayerId;
  readonly influencingCharacterId: CardInstanceId;
  readonly targetPlayer: PlayerId;
  readonly targetInstanceId: CardInstanceId;
  readonly targetKind: 'character' | 'ally' | 'faction' | 'item';
  readonly revealedCardInstanceId?: CardInstanceId;  // Phase 2
  readonly explanation: string;
}
```

Add to `GameAction` union. Register `'opponent-influence-attempt'` in `SiteStep` action types in `types/phases.ts`.

### Step 3: State tracking

**`packages/shared/src/types/state.ts`** — add to `SitePhaseState` (~line 907):

```typescript
readonly opponentInteractionThisTurn: 'influence' | 'attack' | null;
```

Initialize as `null` in all `SitePhaseState` construction sites in `reducer.ts`.

### Step 4: Legal action generation

**`packages/shared/src/engine/legal-actions/site.ts`** — new function `opponentInfluenceActions()` called during `play-resources` step.

Guards (return empty if any fail):
- `state.turnNumber <= 2` (first turn for either player)
- `!siteState.siteEntered`
- `siteState.opponentInteractionThisTurn !== null`

Logic:
1. Get untapped characters in active company
2. Get opponent player index, find opponent companies at same site (compare `currentSite.definitionId`)
3. For each opponent character at same site:
   - Skip if avatar (`mind === null`) or controlled by avatar
   - For each untapped influencer: generate action with explanation
4. For each opponent ally on characters at same site:
   - Skip if controlling character is avatar
   - Generate action per (influencer, ally) pair

Explanation string includes: influencer's unused DI, opponent's unused GI, target's mind, controller's unused DI.

Uses existing `availableDI()` from `organization.ts` for DI calculations.

### Step 5: Reducer handler

**`packages/shared/src/engine/reducer.ts`** — new `handleOpponentInfluenceAttempt()`:

1. Validate: character untapped + in active company, site entered, no prior interaction, target exists at same site, not avatar-controlled
2. Tap influencing character
3. Roll attacker 2d6 via `roll2d6(state)`
4. Calculate modifier:
   - `+` influencer's unused DI (`availableDI()`)
   - `-` opponent's unused GI (`GENERAL_INFLUENCE - opponent.generalInfluenceUsed`)
   - `-` controller's unused DI (if target under DI, not GI)
5. Roll defender 2d6 via `roll2d6(updatedState)` (uses RNG from step 3)
6. Subtract defender roll from total
7. Compare to target's mind value
8. **Success**: discard target + all non-follower cards it controlled (items, allies). Followers of a discarded character become uncontrolled (fall to GI if room, else discard)
9. **Failure**: nothing beyond tapping the influencer
10. Set `opponentInteractionThisTurn = 'influence'`
11. Return two `DiceRollEffect` entries (attacker label, defender label)

Wire into `handleSitePlayResources()` (~line 4191).

### Step 6: Discard cascade helper

Extract a reusable `discardCharacterCascade()` function:
- Move target character to opponent's discard pile
- Move all items on the character to discard pile
- Move all allies on the character to discard pile
- For followers: attempt to place under GI (check `GENERAL_INFLUENCE - generalInfluenceUsed >= follower.mind`), otherwise discard them too
- Remove character from company; clean up empty companies

### Step 7: Action description

**`packages/shared/src/format.ts`** — add `'opponent-influence-attempt'` case in `describeAction()`.

### Step 8: UI — targeting opponent's cards

**`packages/lobby-server/src/browser/render.ts`**:
- New module state: `selectedInfluencerForOpponent: CardInstanceId | null`
- During `play-resources`, detect `opponent-influence-attempt` actions in viable actions
- When player's untapped character is clicked and has opponent-influence actions: set as selected influencer, show targeting instruction "Click an opponent's card to attempt influence"
- Re-render to highlight targetable opponent cards

**`packages/lobby-server/src/browser/company-view.ts`**:
- In opponent company rendering, when `selectedInfluencerForOpponent` is set:
  - Find matching actions where `influencingCharacterId === selectedInfluencer`
  - Add `company-card--influence-target` CSS class to targetable cards
  - Click handler dispatches action and clears selection

### Step 9: UI — dual dice display

**`packages/lobby-server/src/browser/app.ts`** — the effect handler already processes `DiceRollEffect` entries. Two effects will trigger two `rollDice()` calls. Verify the dice animation system queues properly (attacker = black dice, defender = red dice per existing variant convention).

### Step 10: Tests

Replace `.todo()` in test files with real tests. Each test: build state -> `computeLegalActions()` or `reduce()` -> assert.

**`rule-10.10-influence-attempt-declaration.test.ts`**:
- Cannot influence on first turn
- Cannot influence if company hasn't entered site (`siteEntered: false`)
- Cannot influence if already made opponent interaction this turn
- Cannot target avatar or avatar-controlled card
- Only untapped characters can attempt

**`rule-10.11-influence-attempt-targets.test.ts`**:
- Character at same site is valid target
- Ally at same site is valid target
- Character at different site is NOT valid
- Avatar is NOT valid

**`rule-10.12-influence-attempt-resolution.test.ts`**:
- Successful influence discards target character
- Successful influence on ally discards ally
- Failed influence only taps influencer
- Modifier math: attacker DI, opponent GI, defender roll, controller DI all applied correctly
- Discard cascade: items/allies on character discarded, followers survive

---

## Phase 2: Identical Card Reveal + Post-Success Play

### Step 11: Legal actions with reveal variants

For each (influencer, target) pair against character/ally:
- Check if player has identical card in hand (same `name`, any alignment)
- Generate action WITH `revealedCardInstanceId` (comparison value = 0)
- Generate action WITHOUT reveal (comparison value = mind)

### Step 12: Reducer reveal handling

- If `revealedCardInstanceId` set and target is non-item: comparison value = 0
- Remove revealed card from hand
- On success: play revealed card with influencing character (no site tap, no influence check). For characters: must have enough GI/DI to control, but ignore playability restrictions
- On failure: move revealed card to discard

### Step 13: UI reveal choice

When both reveal/non-reveal actions exist for a target, show tooltip menu: "Influence (reveal {cardName})" vs "Influence (no reveal)". Reuse `showResourceTargetMenu()` pattern.

### Step 14: Tests for rule 10.13

---

## Phase 3: Factions, Items, Cross-Alignment

### Step 15: Faction targets
- Target opponent's in-play factions when influencer is at a site where faction is playable
- Comparison value = faction's `influenceNumber`

### Step 16: Item targets
- Same site + no permanent-event on item + MUST reveal identical item from hand
- Comparison value = controlling character's mind (NOT zeroed by reveal)

### Step 17: Cross-alignment penalties (rule 10.15)
- -5 modifier when player alignments cross (wizard<->ringwraith, wizard<->balrog, etc.)

### Step 18: Tests for rules 10.14-10.16

---

## Critical Files

| File | Changes |
|------|---------|
| `packages/shared/src/types/actions.ts` | New `OpponentInfluenceAttemptAction`, update `GameAction` union |
| `packages/shared/src/types/state.ts` | Add `opponentInteractionThisTurn` to `SitePhaseState` |
| `packages/shared/src/types/cards.ts` | Add `mind` to ally card types |
| `packages/shared/src/types/phases.ts` | Register new action type for site phase |
| `packages/shared/src/engine/legal-actions/site.ts` | New `opponentInfluenceActions()` function |
| `packages/shared/src/engine/legal-actions/organization.ts` | Reuse `availableDI()` |
| `packages/shared/src/engine/reducer.ts` | New `handleOpponentInfluenceAttempt()` + discard cascade |
| `packages/shared/src/format.ts` | Action description |
| `packages/shared/src/data/tw-resources.json` | Add `mind` to ally data |
| `packages/lobby-server/src/browser/render.ts` | Opponent influence targeting state |
| `packages/lobby-server/src/browser/company-view.ts` | Opponent card highlighting + click handlers |
| `tests/rules/10-corruption-influence-endgame/rule-10.10-*.test.ts` | Declaration tests |
| `tests/rules/10-corruption-influence-endgame/rule-10.11-*.test.ts` | Target condition tests |
| `tests/rules/10-corruption-influence-endgame/rule-10.12-*.test.ts` | Resolution tests |

## Verification

1. `npm run build` — type-check passes
2. `npm test` — existing tests still pass + new rule 10.10-10.12 tests pass
3. Manual: start lobby dev (`npm run dev -w @meccg/lobby-server`), create game, move two companies to same site, verify opponent influence actions appear, click through targeting flow, observe dual dice rolls
