# On-Guard Cards Implementation Plan

## Context

On-guard is a core MECCG mechanic where the hazard player places a card
face-down at a company's site during the Movement/Hazard phase, then may
reveal it during the Site phase. It enables bluffing (any card can be placed)
and creates tactical tension. The engine has partial infrastructure (state
fields, action type for reveal, projection logic, phase step stubs) but no
working implementation.

## Phase 1: Placement + Cleanup (Engine)

**Goal**: Hazard player places one card face-down per company during M/H
phase. Cards return to hand at end of site phases.

### 1.1 Change `Company.onGuardCards` type

- **File**: `packages/shared/src/types/state.ts`
- Change from `CardInstanceId[]` to `CardInstance[]` — matches how all other
  card storage works (hand, discard, etc.) and avoids needing a lookup
  registry
- Update all places that initialize companies (reducer.ts, test helpers)
- Add `onGuardCards` to `resolveInstanceId()` in `state.ts` — it scans
  company sites but not on-guard cards; add a loop over
  `company.onGuardCards` alongside the existing `currentSite`/`destinationSite`
  checks

### 1.2 Add `PlaceOnGuardAction`

- **File**: `packages/shared/src/types/actions.ts`
- New interface:
  `{ type: 'place-on-guard', player: PlayerId, cardInstanceId: CardInstanceId }`
- No `targetCompanyId` needed — placement is always on the active company in
  the current M/H phase
- Add to `GameAction` union
- **File**: `packages/shared/src/types/phases.ts` — add `'place-on-guard'`
  to `Phase.MovementHazard` legal actions

### 1.3 Legal actions for placement

- **File**: `packages/shared/src/engine/legal-actions/movement-hazard.ts`
- In `playHazardsActions()`, after existing hazard card loop:
  - Guard: hazard player only, `!onGuardPlacedThisCompany`, company has
    destination site
  - Every card in hand is eligible (bluffing allowed)
  - Counts against hazard limit (non-viable if limit reached)
  - Produce `PlaceOnGuardAction` per hand card

### 1.4 Reducer for placement

- **File**: `packages/shared/src/engine/reducer.ts`
- In M/H phase handler, handle `'place-on-guard'`:
  - Remove card from hazard player's hand
  - Push `CardInstance` to active company's `onGuardCards`
  - Increment `hazardsPlayedThisCompany`, set
    `onGuardPlacedThisCompany: true`
  - Reset `resourcePlayerPassed`

### 1.5 Cleanup at end of site phases

- **File**: `packages/shared/src/engine/reducer.ts`
- In `advanceSiteToNextCompany()` when all companies done: move remaining
  `onGuardCards` from all resource player companies back to hazard player's
  hand
- In site disposal / site-leaves-play logic: same cleanup

### 1.6 Projection adjustment

- **File**: `packages/game-server/src/ws/projection.ts`
- Both players see `onGuardCards` as a list on each company
- Resource player's view: each on-guard card is redacted to a face-down
  placeholder (no identity, no definition ID — just "a card")
- Hazard player's view: full card details for on-guard cards they placed
- Remove `hasOnGuardCard: boolean` — replaced by checking
  `onGuardCards.length > 0`

## Phase 2: Placement UI

**Goal**: Hazard player can click cards in hand to place them on-guard via
the browser UI.

### 2.1 Hand card rendering

- **File**: `packages/lobby-server/src/browser/render.ts`
- In the hand arc rendering, detect `place-on-guard` actions alongside
  existing `play-hazard` actions
- Cards with `place-on-guard` actions get `.hand-card-playable` class
- Clicking dispatches the `place-on-guard` action directly (single-click, no
  targeting needed since it's always the active company)

### 2.2 On-guard indicator on company site

- **File**: `packages/lobby-server/src/browser/company-view.ts`
- In `renderSiteArea()`: when `company.onGuardCards.length > 0`, show
  face-down card image(s) or badge overlay near the site card
- Use the existing `createFaceDownCard()` from render-utils.ts
- For the hazard player viewing their own placed cards: show actual card
  image(s) at the site (they know what they placed)

### 2.3 Phase instruction text

- Already partially implemented in render.ts
- Update `play-hazards` step instructions to mention on-guard option when
  available

### 2.4 CSS styling

- **File**: `packages/lobby-server/public/style.css`
- On-guard badge/card-back at site: small card-back image with
  `.on-guard-indicator` class
- Position adjacent to site card using the badge overlay pattern (like
  `.char-stats-badge`)

## Phase 3: Reveal at Auto-Attack Step (Engine)

**Goal**: During `reveal-on-guard-attacks`, hazard player can reveal
on-guard creatures keyed to the site.

### 3.1 Legal actions for reveal

- **File**: `packages/shared/src/engine/legal-actions/site.ts`
- Replace stub `revealOnGuardAttacksActions()`:
  - Give actions to the **hazard player** (non-active player), not the active
    player
  - For each on-guard card: check if it's a creature keyable to the
    company's current site
  - Offer `RevealOnGuardAction` for eligible creatures + `pass`
  - If no on-guard cards or none eligible: auto-pass

### 3.2 Creature keying validation

- Reuse existing `findCreatureKeyingMatches()` from movement-hazard.ts
- Adapt for site phase context (company's current site, region path)

### 3.3 Reducer for reveal

- **File**: `packages/shared/src/engine/reducer.ts`
- Handle `'reveal-on-guard'` during `reveal-on-guard-attacks` step:
  - Remove card from company's `onGuardCards`
  - Add to `declaredOnGuardAttacks` array
  - Card attacks after automatic-attacks in `resolve-attacks` step

## Phase 4: Reveal UI

**Goal**: Hazard player can click on-guard cards to reveal them during site
phase.

### 4.1 On-guard reveal actions

- **File**: `packages/lobby-server/src/browser/render.ts`
- During `reveal-on-guard-attacks` step, show `RevealOnGuardAction` buttons
  in the action panel
- Each button labeled with the creature name (hazard player knows what they
  placed)
- Or: render on-guard cards as clickable in the company view

### 4.2 Revealed card animation

- When on-guard card is revealed, it transitions from face-down to face-up
  in the company view
- Simple approach: re-render with the card now visible in
  `declaredOnGuardAttacks`

## Phase 5: Reveal at Resource Play (Engine + UI)

**Goal**: When resource player plays a resource that taps the site, hazard
player can reveal on-guard.

### 5.1 State extension

- Add `awaitingOnGuardReveal: boolean` to `SitePhaseState`
- When a site-tapping resource is played and on-guard cards exist: pause, set
  flag, give hazard player priority

### 5.2 Legal actions

- When `awaitingOnGuardReveal`: offer `RevealOnGuardAction` for each
  on-guard card + `pass`
- Initially: allow revealing any hazard event without semantic "affects the
  company" validation

### 5.3 Chain of effects

- Revealed on-guard creates a nested chain (use existing
  `ChainState.parentChain`)
- Resolves before the triggering resource chain continues

### 5.4 UI

- Show reveal options to hazard player as action buttons during the intercept
- Phase instruction: "Opponent played a resource — reveal on-guard or pass"

## Phase 6: On-Guard Restrictions (Engine)

**Goal**: Enforce rule 6.15 restrictions on what can be revealed.

- Cannot return company to origin, tap site, remove character (except
  combat/CC), force do-nothing, directly tap character
- Implement as checks on the card's effects array before offering
  `RevealOnGuardAction`
- Deferred until the card effects DSL covers enough effect types to make
  these checks meaningful

## Verification

Each phase has corresponding test files with `test.todo()` entries:

- Phase 1: `rule-5.23-on-guard-card.test.ts`
- Phase 3: `rule-6.02-revealing-on-guard-attacks.test.ts`
- Phase 5: `rule-6.14-on-guard-reveal-at-resource.test.ts`,
  `rule-6.16-on-guard-chain-of-effects.test.ts`
- Phase 6: `rule-6.15-on-guard-restrictions.test.ts`

For each phase: implement tests, run `npm test`, verify passing. Manual
testing via lobby server (`npm run dev -w @meccg/lobby-server`) to verify UI.
