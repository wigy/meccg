# Bade to Rule (le-167) Certification Plan

**Date:** 2026-05-31
**Card:** Bade to Rule (le-167) — minion-resource-event (permanent), 0 misc MPs
**Branch:** `certify-le-167-bade-to-rule`

## Card Text

> Playable at a Darkhaven [{DH}] during the organization phase on your Ringwraith.
> -2 to his direct influence, +5 general influence. You may discard this card during
> any of your organization phases. Discard this card if your Ringwraith moves.
> Alternatively, playable if your Ringwraith is not in play. +5 general influence.
> Place this card with your Ringwraith when he comes into play. Cannot be duplicated
> by a given player. Cannot be included in a Balrog's deck.

## Already Implemented

| Rule | Effect | Status |
|------|--------|--------|
| -2 to Ringwraith's direct influence | `stat-modifier, direct-influence, -2` | ✓ type implemented; card unplayable |
| Discard if Ringwraith's company moves | `on-event: bearer-company-moves + discard-self` | ✓ fires for items; blocked by RC-1 |

## Missing Rules

| # | Rule | Root Cause | Notes |
|---|------|------------|-------|
| 1 | Playable during org phase on Ringwraith at Darkhaven | RC-1: minion permanent events never offered | Same blocker as le-174 |
| 2 | +5 general influence while in play | RC-2: no general-influence stat type | Hard-coded GENERAL_INFLUENCE constant |
| 3 | Voluntary discard during any org phase | RC-3: no grant-action for unconditional discard of attached events | |
| 4 | Discard if Ringwraith moves (auto-trigger) | RC-4: `bearer-company-moves` scans `char.items`; card is in `char.hazards` | Resolved as side-effect of RC-1 |
| 5 | Alternative mode: playable if Ringwraith not in play | RC-5: entirely new play path + deferred attachment | Defer to follow-up PR |
| 6 | On alt mode, place with Ringwraith when he enters play | RC-5: delayed attachment mechanic | Defer to follow-up PR |
| 7 | Cannot be duplicated by a given player | RC-6: `duplication-limit` scope `"player"` not enforced | |

---

## Implementation Steps

### Step 1 — Update card data JSON

**File:** `packages/shared/src/data/le-resources.json`

Replace the current effects array on `le-167` with:

```json
"effects": [
  { "type": "play-target", "target": "character", "filter": { "target.race": "ringwraith" } },
  { "type": "play-condition", "requires": "site-type", "siteTypes": ["haven"] },
  { "type": "stat-modifier", "stat": "direct-influence", "value": -2 },
  { "type": "stat-modifier", "stat": "general-influence", "value": 5 },
  { "type": "grant-action", "id": "discard-self", "phase": ["organization"],
    "apply": { "type": "move", "select": "self", "to": "discard" } },
  { "type": "on-event", "event": "bearer-company-moves",
    "apply": { "type": "move", "select": "self", "to": "discard" } },
  { "type": "duplication-limit", "scope": "player", "max": 1 }
]
```

### Step 2 — RC-1: Allow minion permanent events in `playPermanentEventActions`

**File:** `packages/shared/src/engine/legal-actions/organization-events.ts`

**2a.** Extend the import cast to include `MinionResourceEventCard`:

```ts
// Before
const def = state.cardPool[handCard.definitionId as string] as HeroResourceEventCard | undefined;

// After
const def = state.cardPool[handCard.definitionId as string] as HeroResourceEventCard | MinionResourceEventCard | undefined;
```

**2b.** Relax the card-type filter (line 37):

```ts
// Before
if (!def || def.cardType !== 'hero-resource-event' || def.eventType !== 'permanent') continue;

// After
if (!def ||
    (def.cardType !== 'hero-resource-event' && def.cardType !== 'minion-resource-event') ||
    def.eventType !== 'permanent') continue;
```

**2c.** Add `at-site-type` play-condition support if not already present.
Scan for `{ type: 'play-condition', requires: 'at-site-type' }` and check the company's
current site matches. Pattern mirrors the existing `card-not-in-play` condition check.

```ts
const siteTypeCondition = def.effects?.find(
  (e): e is PlayConditionEffect => e.type === 'play-condition' && e.requires === 'at-site-type',
);
if (siteTypeCondition) {
  const atCorrectSite = player.companies.some(company => {
    if (!company.currentSite) return false;
    const siteDef = defById(state, company.currentSite.definitionId);
    return siteDef && 'siteType' in siteDef && siteDef.siteType === siteTypeCondition.siteType;
  });
  if (!atCorrectSite) {
    logDetail(`Permanent event ${def.name}: requires at-site-type ${siteTypeCondition.siteType}`);
    actions.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId },
      viable: false,
      reason: `${def.name}: no company at a ${siteTypeCondition.siteType}`,
    });
    continue;
  }
}
```

### Step 3 — RC-1: Fix placement slot in `resolvePermanentEvent`

**File:** `packages/shared/src/engine/chain-reducer.ts:906`

```ts
// Before
const isResource = def && def.cardType === 'hero-resource-event';

// After
const isResource = def && (def.cardType === 'hero-resource-event' || def.cardType === 'minion-resource-event');
```

This puts the card in `char.items` (not `char.hazards`), which means the existing
`bearer-company-moves` scan in `reducer-movement-hazard.ts` automatically covers it —
RC-4 requires no separate change.

### Step 4 — RC-2: Add `general-influence` stat modifier

**File:** `packages/shared/src/types/effects.ts`

Extend `StatModifierEffect.stat` union:

```ts
// Before
readonly stat: 'prowess' | 'body' | 'direct-influence' | 'corruption-points' | 'strikes';

// After
readonly stat: 'prowess' | 'body' | 'direct-influence' | 'corruption-points' | 'strikes' | 'general-influence';
```

**File:** `packages/shared/src/types/state-player.ts`

Add a field to `PlayerState`:

```ts
/** Sum of general-influence modifiers from cards currently in play. Default 0. */
readonly generalInfluenceBonus: number;
```

Initialize to `0` in the player-state factory and in every existing test fixture.

**File:** `packages/shared/src/engine/reducer-utils.ts`

Add a helper:

```ts
/** Returns the effective general-influence pool for the player (base 20 + modifiers). */
export function effectiveGeneralInfluence(state: GameState, playerId: PlayerId): number {
  return GENERAL_INFLUENCE + (playerById(state, playerId)?.generalInfluenceBonus ?? 0);
}
```

Replace the five bare `GENERAL_INFLUENCE` constant uses with `effectiveGeneralInfluence(state, player.id)`:

- `pending-reducers.ts:695` — `unusedGI`
- `pending-reducers.ts:945` — follower GI fallback
- `pending-reducers.ts:1027` — follower GI fallback
- `reducer-site.ts:1717` — influence attempt calculation
- `reducer-site.ts:1938` — follower GI fallback

**File:** `packages/shared/src/engine/apply-dispatcher.ts`

In the `stat-modifier` apply handler, add a branch for `general-influence`:

```ts
case 'general-influence':
  return updatePlayer(state, ctx.ownerId, p => ({
    ...p,
    generalInfluenceBonus: p.generalInfluenceBonus + effect.value,
  }));
```

The same dispatcher handles both enter-play (positive modifier) and leave-play (the
dispatcher is called with negated value, or the leave-play path calls it with the
same value and the reducer subtracts — match the existing pattern for `direct-influence`).

### Step 5 — RC-3: Voluntary discard grant-action during organization phase

**File:** `packages/shared/src/engine/legal-actions/organization-events.ts` (or the
org-phase legal-action aggregator that calls this module)

Add a new exported helper `attachedPermanentEventGrantActions(state, playerId)`:

- Iterate each company → each character → `charData.items`.
- If an item's definition is a `*-resource-event` with `eventType === 'permanent'` and
  carries a `grant-action` effect with the given phase including `'organization'`:
  - Emit `{ type: 'use-grant-action', player: playerId, sourceInstanceId: item.instanceId, grantActionId: 'discard-self' }`.

**Reducer** — `use-grant-action` with `grantActionId === 'discard-self'` on a
character-attached permanent event:

1. Find the item in `char.items` by `sourceInstanceId`.
2. Remove it from `char.items`, add it to `player.discardPile`.
3. Reverse the card's `stat-modifier` effects (call apply-dispatcher with negated values
   or the canonical leave-play path — match how `direct-influence` modifiers are removed
   when a character is discarded).

### Step 6 — RC-6: Enforce `duplication-limit` scope `"player"`

**File:** `packages/shared/src/engine/legal-actions/organization-events.ts`

After the existing `scope === 'game'` block (around line 74), add:

```ts
const playerDupLimit = def.effects?.find(
  (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'player',
);
if (playerDupLimit) {
  // Count copies in cardsInPlay plus copies attached to characters
  let copiesOwned = player.cardsInPlay.filter(c => {
    const cDef = defById(state, c.definitionId);
    return cDef && cDef.name === def.name;
  }).length;
  for (const ch of Object.values(player.characters)) {
    copiesOwned += ch.items.filter(i => {
      const iDef = defById(state, i.definitionId);
      return iDef && iDef.name === def.name;
    }).length;
  }
  if (copiesOwned >= playerDupLimit.max) {
    logDetail(`Permanent event ${def.name}: player duplication limit reached (${copiesOwned}/${playerDupLimit.max})`);
    actions.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId },
      viable: false,
      reason: `${def.name} cannot be duplicated by a given player`,
    });
    continue;
  }
}
```

Also apply the same check in the `play-target: character` path so the card is not
offered if the player already has a copy attached to a character.

### Step 7 — Update DSL documentation

**File:** `docs/card-effects-dsl.md`

Add entries for:

- `stat: 'general-influence'` on `stat-modifier` — modifies the player's 20-point GI pool
- `site-type` play-condition with `siteTypes: ["haven"]` — restricts play to companies at a haven
- `discard-self` grant-action during `organization` phase

### Step 8 — Create card test

**File:** `packages/shared/src/tests/cards/le-167.test.ts`

(Replace the existing skeleton `test.todo` file from PR #704.)

```ts
describe('Bade to Rule (le-167)', () => {
  test('playable during organization phase on Ringwraith at a Darkhaven');
  test('NOT playable if the Ringwraith is not at a Darkhaven');
  test('NOT playable on a non-Ringwraith character');
  test('while attached, reduces Ringwraith direct influence by 2');
  test('while attached, increases player general influence by 5');
  test('general influence returns to base when card is discarded');
  test('player may voluntarily discard during any organization phase');
  test('auto-discards when the Ringwraith company moves');
  test('a player cannot play a second copy while one is already attached');
  test('the opposing Ringwraith player may still play their own copy');
});
```

RC-5 tests (alternative play mode, delayed attachment) remain as `test.todo` pending
the follow-up PR.

### Step 9 — Pre-push verification

Run in parallel:

1. `npm run build`
2. `npx vitest run packages/shared/src/tests/cards/le-167.test.ts`
3. `npm test`
4. `npm run lint`
5. `npm run test:nightly`

Fix any failures, then open the PR.

---

## RC-5 — Alternative play mode (deferred to follow-up PR)

The alternative mode ("playable if your Ringwraith is not in play, place with him when
he enters play") requires:

1. A second play path offered when the player has no Ringwraith in `characters`.
2. The card sitting in `cardsInPlay` (not attached) while giving +5 GI.
3. A `deferredCharacterAttachments` field on `PlayerState` tracking pending attaches.
4. A hook in the character-entry reducer to auto-attach on Ringwraith entry.

This is deferred. The corresponding `test.todo` entries should stay in the test file
until the follow-up PR implements it.

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Minion resource events → `char.items` not `char.hazards` | Resource events are owner-controlled benefits; placing them in `hazards` (opponent-controlled zone) is wrong. The `items` placement aligns with hero-resource-events and keeps `bearer-company-moves` working without additional changes |
| `generalInfluenceBonus` field on `PlayerState` | Keeps GI computation O(1); avoids scanning `cardsInPlay` on every influence check. Same pattern as existing character stat modifiers |
| `effectiveGeneralInfluence()` helper | Centralises the `GENERAL_INFLUENCE + bonus` calculation so all five call sites are updated consistently without repetition |
| `at-site-type` as a `play-condition` DSL variant | Reuses the existing `play-condition` machinery; avoids a special-case branch per card. Other cards with site-type restrictions can reuse this |
| Scope `"player"` counts both `cardsInPlay` and `char.items` | A player's copy might be attached (in `items`) rather than floating (in `cardsInPlay`); counting only one zone would miss the duplicate |
| RC-5 deferred | The deferred-attachment mechanic is the only part requiring new `PlayerState` shape changes; deferring it lets the rest of the card ship cleanly without widening the blast radius |

## Dependency Order

Steps 1 (data) and 4 (type additions) can be written immediately.
Step 2 depends on Step 4 (type change compiles first).
Step 3 is independent of Steps 2 and 4 (only touches chain-reducer).
Step 5 depends on Step 4.
Step 6 is independent (no new types needed).
Step 7 depends on Steps 2–6.
Step 8 (tests) depends on all above.
Step 9 (verification) depends on Step 8.
