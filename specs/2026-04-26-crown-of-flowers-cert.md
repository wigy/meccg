# Crown of Flowers (dm-121) Certification Plan

**Date:** 2026-04-26
**Card:** Crown of Flowers (dm-121) — hero-resource-event (permanent), Environment
**Branch:** `certify-dm-121-crown-of-flowers`

## Card Text

> Environment. Crown of Flowers has no effect until you play a resource with it.
> You can play one resource from your hand with this card. The resource is considered
> to be played and to be in play as though Gates of Morning were in play and Doors of
> Night were not. Crown of Flowers does not affect the interpretation of any card
> except the resource played with it. Discard Crown of Flowers when the resource is
> discarded. Discard the resource if Crown of Flowers is discarded.

## Already Implemented

| Rule | Effect | Status |
|------|--------|--------|
| Playable as a permanent event during site phase | standard permanent-event chain | ✓ |
| Enters cardsInPlay after chain resolves | standard cardsInPlay placement | ✓ |
| Environment keyword — discarded by Doors of Night | environment keyword handling | ✓ |

## Missing Rules

Three interdependent mechanics are required:

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | `play-resource-with` — play a resource from hand while Crown is in cardsInPlay | NOT IMPLEMENTED | No DSL type or action for "play resource with this card" |
| 2 | Scoped GoM/DoN context — resource is evaluated as though GoM in play / DoN not | NOT IMPLEMENTED | No per-card environment override; `buildInPlayNames` is global |
| 3 | Linked discard — bidirectional discard propagation between Crown and paired resource | NOT IMPLEMENTED | `CardInPlay` has no link field; no propagation in discard paths |

---

## Design Overview

### State model: `CardInPlay.linkedTo`

Extend `CardInPlay` with an optional `linkedTo` field:

```typescript
export interface CardInPlay {
  // ... existing fields ...
  /**
   * When present, this card and the card with `linkedTo` instanceId
   * are bound by a mutual-discard link. Discarding either discards both.
   * Used by Crown of Flowers: the paired resource points to Crown, and
   * Crown points back to the paired resource (set during chain resolution).
   */
  readonly linkedTo?: CardInstanceId;
}
```

Crown of Flowers gets `linkedTo = pairedResourceInstanceId` and the paired resource
gets `linkedTo = crownInstanceId` when the resource resolves into play.

### Play window

Crown of Flowers offers a single slot: while it is in cardsInPlay with no
`linkedTo` set, the resource player may play one additional resource from hand
"with Crown of Flowers." This triggers during the site-phase `play-resources` step.

### GoM/DoN scoped context

When the `play-resource-with-environment` action is dispatched, the chain entry
is tagged with a `crownScopedEnv: true` flag. The play-condition and play-eligibility
checker passes a modified `inPlay` list for that entry:

- "Gates of Morning" is always included (even if not in play).
- "Doors of Night" is excluded (even if it is in play).

This modified context is only applied when checking the paired resource — not
globally, in keeping with "Crown of Flowers does not affect the interpretation of
any card except the resource played with it."

Once the resource is in cardsInPlay with `linkedTo = crownInstanceId`, ongoing
effects that read `{ "inPlay": "Gates of Morning" }` or
`{ "inPlay": "Doors of Night" }` naturally produce the right answer **as long as**
GoM/DoN is actually in play at that moment. The only gap is if DoN is later played
and tries to discard the paired resource (an environment): that discard is blocked
by checking whether the card has a `linkedTo` pointing to a Crown of Flowers.

---

## Implementation Steps

### Step 1 — Extend `CardInPlay` with `linkedTo`

**File:** `packages/shared/src/types/state-cards.ts`

Add the optional `linkedTo` field to `CardInPlay` (see Design Overview above).

Update the player-view projection and any serialisation that copies `CardInPlay`
to pass `linkedTo` through unchanged.

### Step 2 — Add `PlayResourceWithEffect` to effects.ts

**File:** `packages/shared/src/types/effects.ts`

```typescript
/**
 * When present on a permanent event in cardsInPlay (Crown of Flowers),
 * the resource player may play one resource from hand "with" this card
 * during the site phase.
 *
 * The paired resource is evaluated as though Gates of Morning is in play
 * and Doors of Night is not (scoped only to that resource).
 *
 * After the paired resource resolves, both this card and the resource
 * receive a mutual `linkedTo` reference in their `CardInPlay` entries.
 */
export interface PlayResourceWithEffect extends EffectBase {
  readonly type: 'play-resource-with';
}
```

Add `PlayResourceWithEffect` to the `CardEffect` union.

### Step 3 — Add `PlayResourceWithEnvironmentAction`

**File:** `packages/shared/src/types/actions-site.ts` (or nearest actions file)

```typescript
/**
 * Resource player plays a card from hand "with" a Crown of Flowers
 * permanent event (or equivalent). The resource is evaluated with a
 * scoped GoM-in-play / DoN-not-in-play context.
 */
export interface PlayResourceWithEnvironmentAction {
  readonly type: 'play-resource-with-environment';
  readonly player: PlayerId;
  /** The resource card instance from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The Crown of Flowers (or equivalent) in cardsInPlay. */
  readonly crownInstanceId: CardInstanceId;
}
```

Add to the `GameAction` union and export from `index.ts`.

### Step 4 — Emit the action in `site.ts` legal actions

**File:** `packages/shared/src/engine/legal-actions/site.ts`

During the `play-resources` step, after collecting normal play actions, add a new
helper `playResourceWithEnvironmentActions`:

```
For each resource permanent-event in the resource player's cardsInPlay
  that carries a `play-resource-with` effect
  and whose `linkedTo` is undefined (slot is empty):

  Build a modified inPlay list:
    - include "Gates of Morning" unconditionally
    - exclude "Doors of Night" unconditionally
    - include all other real inPlay names

  For each card in the resource player's hand:
    Check whether the card is playable in the current site-phase context
    using the modified inPlay list (reuse existing play-condition evaluation,
    pass the override as an optional parameter).
    If playable, emit:
      { type: 'play-resource-with-environment',
        player, cardInstanceId, crownInstanceId }
```

> **Note:** The modified context only affects play-condition and play-flag
> evaluation for the candidate resource. The site's playable-resources list,
> hazard-limit bookkeeping, and all other state remain unchanged.

### Step 5 — Handle the action in the chain reducer

**File:** `packages/shared/src/engine/chain-reducer.ts`

Add a dispatch branch for `play-resource-with-environment` that mirrors
`play-permanent-event` but:

1. Validates that the referenced `crownInstanceId` is in the player's `cardsInPlay`
   and has a `play-resource-with` effect.
2. Tags the new `ChainEntry` with a flag `crownScopedEnv: crownInstanceId` so the
   resolution path knows to set `linkedTo` on both cards.
3. Re-runs play-condition checks using the same modified inPlay list from Step 4
   (guards against TOCTOU between action emission and resolution).

**ChainEntry extension (or `ChainEntryPayload` variant):**

Add an optional `crownInstanceId?: CardInstanceId` to the `permanent-event`
payload variant (or to `ChainEntry` itself). This propagates through resolution.

**Resolution path:**

When resolving a permanent-event chain entry that has `crownInstanceId` set:

```typescript
// Mutual link: set linkedTo on both cards
const crownIdx = newPlayers[playerIndex].cardsInPlay
  .findIndex(c => c.instanceId === crownInstanceId);
if (crownIdx !== -1) {
  // Update Crown of Flowers — point to the new resource
  newPlayers[playerIndex].cardsInPlay[crownIdx] =
    { ...newPlayers[playerIndex].cardsInPlay[crownIdx], linkedTo: card.instanceId };
  // Add the new resource with linkedTo = crownInstanceId
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    cardsInPlay: [...newPlayers[playerIndex].cardsInPlay, {
      instanceId: card.instanceId,
      definitionId: card.definitionId,
      status: CardStatus.Untapped,
      linkedTo: crownInstanceId,
    }],
  };
}
```

### Step 6 — Discard propagation in all discard paths

Every code path that removes a card from `cardsInPlay` must check for
`linkedTo` and cascade:

**File:** `packages/shared/src/engine/chain-reducer.ts` — `resolveEnvironmentCancel`

After moving the card to discardPile, if the removed card has `linkedTo`:

```typescript
const linkedInstanceId = removedCard.linkedTo;
if (linkedInstanceId) {
  // Find and remove the linked card from whichever player's cardsInPlay it's in
  for (let pi = 0; pi < newPlayers.length; pi++) {
    const linkedIdx = newPlayers[pi].cardsInPlay
      .findIndex(c => c.instanceId === linkedInstanceId);
    if (linkedIdx !== -1) {
      const linked = newPlayers[pi].cardsInPlay[linkedIdx];
      logDetail(`Linked discard: removing ${linked.definitionId as string} (linked to ${removedCard.definitionId as string})`);
      newPlayers[pi] = {
        ...newPlayers[pi],
        cardsInPlay: newPlayers[pi].cardsInPlay.filter((_, i) => i !== linkedIdx),
        discardPile: [...newPlayers[pi].discardPile,
          { instanceId: linked.instanceId, definitionId: linked.definitionId }],
      };
      break;
    }
  }
}
```

Apply the same cascading logic in every other place where a card is removed from
`cardsInPlay`:
- Environment-discarded-by-DoN path (`reducer-organization.ts` / `chain-reducer.ts`
  resource-environment discard hooks)
- Manual discard during end-of-turn / long-event-phase cleanup
- Any `move` TriggeredAction that discards from `cardsInPlay`

Extract a shared helper `discardFromCardsInPlay(state, instanceId): GameState` that:
1. Removes the card from the appropriate player's `cardsInPlay`
2. Adds it to `discardPile`
3. Cascades to the `linkedTo` partner (one level only — no recursion needed)
4. Logs the discard

Replace all ad-hoc cardsInPlay-removal code with calls to this helper.

### Step 7 — Block DoN-discard for the linked resource

**File:** `packages/shared/src/engine/reducer-organization.ts` (and `chain-reducer.ts`)

When Doors of Night resolves and discards resource environments, skip any
card whose `linkedTo` points to a Crown of Flowers (i.e., a card in cardsInPlay
with a `play-resource-with` effect):

```typescript
// DoN discard loop:
for (const card of player.cardsInPlay) {
  const def = state.cardPool[card.definitionId as string];
  if (!isEnvironment(def)) continue;
  // Skip resources linked to Crown of Flowers — they are immune to DoN
  if (card.linkedTo) {
    const crownDef = state.cardPool[
      resolveInstanceId(state, card.linkedTo) as string
    ];
    const hasCrownEffect = crownDef && 'effects' in crownDef &&
      crownDef.effects?.some(e => e.type === 'play-resource-with');
    if (hasCrownEffect) {
      logDetail(`DoN: skipping ${def?.name ?? card.definitionId} — linked to Crown of Flowers`);
      continue;
    }
  }
  // ... normal discard
}
```

### Step 8 — Update card data JSON

**File:** `packages/shared/src/data/dm-resources.json`

Add effects to `dm-121`:

```json
"effects": [
  {
    "type": "play-resource-with"
  }
]
```

### Step 9 — Update DSL documentation

**File:** `docs/card-effects-dsl.md`

Add entries for `play-resource-with`, documenting:
- The play window (site-phase play-resources step, permanent-event must be in cardsInPlay)
- The scoped GoM/DoN inPlay override
- The `linkedTo` field on `CardInPlay` and mutual-discard semantics

### Step 10 — Complete card test

**File:** `packages/shared/src/tests/cards/dm-121.test.ts`

Replace the `test.todo` stubs with concrete tests:

**A. play-resource-with-environment is offered while Crown has no linked resource**
```
State: site phase, Crown in cardsInPlay (no linkedTo), a resource in hand
       that requires GoM as play condition (e.g. a mock card).
Expected: viableActions includes play-resource-with-environment.
```

**B. play-resource-with-environment is NOT offered once Crown already has a linked resource**
```
Crown.linkedTo is set. Same hand.
Expected: no play-resource-with-environment offered.
```

**C. Resource that normally requires GoM can be played with Crown even when GoM is absent**
```
GoM not in cardsInPlay; Crown in cardsInPlay; hand contains a resource
with play-condition { "inPlay": "Gates of Morning" }.
Expected: play-resource-with-environment is offered for that resource.
```

**D. After chain resolution, both Crown and resource have mutual linkedTo**
```
Dispatch play-resource-with-environment, resolve chain.
Expected: Crown.linkedTo = resource instanceId; resource.linkedTo = crown instanceId.
```

**E. Discarding Crown also discards the linked resource**
```
Crown and resource both in cardsInPlay with mutual linkedTo.
Force-discard Crown (e.g. DoN enters play, or direct discard action).
Expected: resource also moves to discardPile; neither remains in cardsInPlay.
```

**F. Discarding the linked resource also discards Crown**
```
Same setup; force-discard the resource.
Expected: Crown also moves to discardPile.
```

**G. Linked resource is immune to Doors of Night discard**
```
Resource is an environment in cardsInPlay with linkedTo = crownInstanceId.
Hazard player plays Doors of Night.
Expected: resource NOT discarded by DoN's environment-sweep; Crown NOT discarded.
```

Update the module-level table to mark all three rules as `IMPLEMENTED`.
Update `Playable: NO` → `Playable: YES`. Add `certified: "2026-04-26"` to card data.

### Step 11 — Pre-push verification

Run in parallel:
1. `npm run build`
2. `npx vitest run packages/shared/src/tests/cards/dm-121.test.ts`
3. `npm test`
4. `npm run lint`
5. `npm run test:nightly`

Fix any failures, then open the PR.

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| `linkedTo` on `CardInPlay` rather than a separate link map | Keeps all card state local; no new top-level state field required; projection passes it through unchanged |
| Single-level cascade only (no recursive linked-discard) | Crown can only link to one resource and the resource can only link back to Crown — no chain of linked cards is possible |
| GoM/DoN override applied at action-emission time, not resolution time | Follows the existing pattern (conditions checked when actions are emitted); re-check at resolution guards against stale state |
| Shared `discardFromCardsInPlay` helper | Multiple discard paths currently duplicate the cardsInPlay-to-discardPile move; centralising ensures the linkedTo cascade is never missed |
| DoN-discard immunity via `linkedTo` + `play-resource-with` check | Avoids a separate "immune to DoN" flag; the link itself carries the semantic |
| Crown slot: empty `linkedTo` = available | Simple sentinel — no extra flag needed to signal "Crown has not yet been paired" |

## Dependency Order

Step 1 (state extension) is prerequisite to all others.
Steps 2–3 (types/actions) can be done in parallel with Step 1.
Step 4 depends on Steps 1–3.
Step 5 depends on Steps 1–3.
Step 6 depends on Step 1; the `discardFromCardsInPlay` helper is a prerequisite for
  Step 7 and the discard tests in Step 10.
Step 7 depends on Steps 5–6.
Step 8 depends on Step 2.
Step 9 depends on all above.
Step 10 (tests) depends on all above.
