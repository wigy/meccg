# Influence Checks vs Opponent's Cards

## Context

The game currently supports faction influence attempts (playing your own factions from hand with a 2d6 roll). The rules (CoE section 8, rules 10.10-10.16) define a separate mechanic: **influencing an opponent's in-play cards** to discard them. This involves two dice rolls (attacker + defender), modifier calculations (DI, GI, controller DI), and optional identical-card reveals. Test skeletons exist at `tests/rules/10-corruption-influence-endgame/rule-10.10` through `10.16` (all `.todo()`).

This plan covers engine (shared package) and UI (lobby-server browser).

## Key Design Decisions

1. **New action type `opponent-influence-attempt`** — separate from existing `influence-attempt` (which handles playing factions from hand). The mechanics are fundamentally different: two rolls, targets opponent's in-play cards, results in discard not play.

2. **Separate explicit roll actions for both players** — each roll is its own action for excitement/suspense. The influencer rolls first, then the game waits for the defender to roll. Each emits a `DiceRollEffect`.

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

Also add a defend action for the hazard player's roll:

```typescript
export interface OpponentInfluenceDefendAction {
  readonly type: 'opponent-influence-defend';
  readonly player: PlayerId;
}
```

Add both to `GameAction` union. Register `'opponent-influence-attempt'` and `'opponent-influence-defend'` in `SiteStep` action types in `types/phases.ts`.

### Step 3: State tracking

**`packages/shared/src/types/state.ts`** — add to `SitePhaseState` (~line 907):

```typescript
readonly opponentInteractionThisTurn: 'influence' | 'attack' | null;
```

Initialize as `null` in all `SitePhaseState` construction sites in `reducer.ts`.

### Step 4: Legal action generation

**`packages/shared/src/engine/legal-actions/site.ts`** — new function `opponentInfluenceActions()` called during `play-resources` step.

Guards (return empty if any fail):

- It is the resource player's first turn
- `!siteState.siteEntered` (company hasn't entered site)
- `siteState.opponentInteractionThisTurn !== null` (already made interaction)

Logic:

1. Get untapped characters in active company
2. Get opponent player index, find opponent companies at same site (compare `currentSite.definitionId`)
3. For each opponent character at same site:
   - Skip if avatar (`mind === null`) or controlled by avatar
   - For each untapped influencer: skip if avatar played this turn (rule 8.1). Generate action with explanation
4. For each opponent ally on characters at same site:
   - Skip if controlling character is avatar
   - Generate action per (influencer, ally) pair — same avatar-played-this-turn guard on influencer

Explanation string includes: influencer's unused DI, opponent's unused GI, target's mind, controller's unused DI.

Uses existing `availableDI()` from `organization.ts` for DI calculations.

### Step 5: Reducer handler

**`packages/shared/src/engine/reducer.ts`** — new `handleOpponentInfluenceAttempt()`:

The influence attempt uses two separate actions (two explicit rolls):

**Action 1: `opponent-influence-attempt`** (resource player declares + rolls)

1. Validate: character untapped + in active company, site entered, no prior interaction, target exists at same site, not avatar-controlled, avatar influencer not played this turn (rule 8.1)
2. Tap influencing character
3. Roll attacker 2d6 via `roll2d6(state)`, emit `DiceRollEffect`
4. Set `opponentInteractionThisTurn = 'influence'`
5. Store intermediate state in `SitePhaseState`: influencer, target, attacker roll, calculated modifiers
6. Transition to awaiting defender roll

**Action 2: `opponent-influence-defend`** (hazard player rolls)

1. Roll defender 2d6 via `roll2d6(state)`, emit `DiceRollEffect`
2. Calculate final result:
   - Attacker roll (from stored state)
   - `+` influencer's unused DI (`availableDI()`)
   - `-` opponent's unused GI (`GENERAL_INFLUENCE - opponent.generalInfluenceUsed`)
   - `-` defender roll
   - `-` controller's unused DI (only if target is controlled by a character under DI, not under GI — rule 8.3 step 5)
3. Compare to target's mind value (must be strictly greater)
4. **Success**: discard target + all non-follower cards it controlled (items, allies). Followers of a discarded character become uncontrolled (fall to GI if room, else discard)
5. **Failure**: nothing beyond tapping the influencer
6. Clear intermediate state, return to play-resources

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

### Step 9: Tests

Replace `.todo()` in test files with real tests. Each test: build state -> `computeLegalActions()` or `reduce()` -> assert.

**`rule-10.10-influence-attempt-declaration.test.ts`**:

- Cannot influence on first turn
- Cannot influence if company hasn't entered site (`siteEntered: false`)
- Cannot influence if already made opponent interaction this turn
- Cannot target avatar or avatar-controlled card
- Only untapped characters can attempt
- Avatar influencer cannot have been played this turn (rule 8.1)

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
- Controller DI only subtracted when target is under DI (not GI)
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

### Step 17: Cross-alignment penalties (rules 8.W1, 8.R1, 8.F1, 8.B1)

- -5 modifier when player alignments cross (wizard vs ringwraith/balrog, ringwraith vs wizard/fallen-wizard, fallen-wizard vs ringwraith/balrog, balrog vs wizard/fallen-wizard)

### Step 18: Fallen-wizard specific rules

- **8.F2**: For a FW player to reveal a matching card, it must also match the alignment of the site where the influence attempt is declared
- **8.F3**: A matching manifestation may be revealed at a site where the FW player cannot play MP cards, but the revealed card cannot be played on success

### Step 19: Tests for rules 10.14-10.16

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
