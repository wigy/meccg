# Vilya (tw-358) Certification Plan

**Date:** 2026-04-26
**Card:** Vilya (tw-358) — hero-resource-event (short)
**Branch:** `certify-tw-358-vilya`

## Card Text

> Playable on Elrond. +4 prowess, +2 body, +6 direct influence until the end
> of the turn. If Elrond is at Rivendell and your play deck has at least 5
> cards in it, you may take 3 resource cards of your choice from your discard
> pile and shuffle them into your play deck. Elrond makes a corruption check
> modified by -3. Cannot be duplicated on a given turn.

Authoritative source: `data/cards.json` TW-358.

## Decomposition

| # | Rule fragment | DSL shape | Status |
|---|---------------|-----------|--------|
| 1 | Playable on Elrond | `play-target: character, filter: { "target.name": "Elrond" }` | ✓ filter supported |
| 2 | +4 prowess until EOT | `character-stat-modifier` constraint (scope turn) | ✗ kind missing |
| 3 | +2 body until EOT | same constraint, stat body | ✗ kind missing |
| 4 | +6 direct-influence until EOT | same constraint, stat direct-influence | ✗ kind missing |
| 5 | If at Rivendell AND deck ≥ 5 → may take 3 resources from discard to deck | conditional fetch (3 picks, optional) | ✗ missing |
| 6 | Elrond makes a corruption check modified by −3 | `on-event: self-enters-play` → enqueue-corruption-check on target character | ✗ missing |
| 7 | Cannot be duplicated on a given turn | `duplication-limit: { scope: "turn", max: 1 }` (site-phase check) | ✗ missing in site phase |

Also a precondition for items 2–6: the `play-short-event` action must carry the
target character's instance ID even when the `play-target` carries no tap cost —
so the reducer knows which character is Elrond.

---

## Engine Gaps

### Gap 1 — play-short-event carries no character target when play-target has no tap cost

`playResourceShortEventActions` (`legal-actions/organization.ts`) only sets
`targetScoutInstanceId` on `play-short-event` when `play-target.cost.tap ===
'character'`. For Vilya the target Elrond is not tapped; today the action is
emitted with no character ID. The reducer (`applyShortEventOnEntersPlay`) needs
the character to apply stat boosts and enqueue the corruption check — it fizzles
silently without it.

**Fix:** Extend `PlayShortEventAction` with an optional `targetCharacterId` field
(semantically: "the character this event targets, regardless of tap cost"). When
`playResourceShortEventActions` detects a `play-target: character` filter-only
effect (no tap cost), emit one `play-short-event` per eligible character with
`targetCharacterId` set.

### Gap 2 — no `character-stat-modifier` active-constraint kind

`ActiveConstraint.kind` currently models `company-stat-modifier` (all characters
in the company) and `hand-size-modifier`. A per-character variant that applies to
a single named character instance is needed for Vilya's until-EOT stat boosts.

**Fix:** Add `character-stat-modifier` to the `ActiveConstraint.kind` union:

```typescript
| {
    readonly type: 'character-stat-modifier';
    readonly stat: 'prowess' | 'body' | 'direct-influence';
    readonly value: number;
    /** The character instance to which the bonus applies. */
    readonly characterId: CardInstanceId;
  }
```

The effect resolver synthesises an equivalent `stat-modifier` (no-target) for the
character whose `instanceId` matches when computing their effective stats.

### Gap 3 — `self-enters-play` apply does not support `enqueue-corruption-check`

`applyShortEventOnEntersPlay` handles only `add-constraint`. Vilya's
corruption-check (modifier −3) on the targeted character must fire as the card
resolves, before the phase resumes.

**Fix:** Add a branch for `apply.type === 'enqueue-corruption-check'` inside
`applyShortEventOnEntersPlay`. The target character is read from
`action.targetCharacterId` (Gap 1 fix). The `modifier` field comes from the
apply clause in the card JSON.

### Gap 4 — `duplication-limit: { scope: "turn" }` not checked in the site phase

`site.ts` short-event eligibility only tests `scope: "game"` via `cardsInPlay`
and `scope: "site"` via site co-location. The M/H-phase emitter checks `scope:
"turn"` by counting active constraints sourced from the card definition. The site
phase emitter must do the same.

**Fix:** In `playResourceShortEventActions` (for `currentPhase === 'site'` and
`currentPhase === 'organization'` where relevant), after existing scope checks,
add:

```typescript
const turnDupLimit = def.effects?.find(
  (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'turn',
);
if (turnDupLimit) {
  const priorConstraints = state.activeConstraints.filter(
    c => c.sourceDefinitionId === def.id,
  ).length;
  if (priorConstraints >= turnDupLimit.max) {
    // not-playable: cannot be duplicated this turn
  }
}
```

### Gap 5 — conditional optional 3-card fetch from discard

Five sub-problems:

**5a — `target.siteName` missing from play-target context.**
`buildPlayOptionContext` exposes `target.race`, `target.name`, etc., but not the
character's current site name. Add `target.siteName` as the name of the site
card (looked up via `company.currentSite.definitionId → siteDef.name`) for the
character's company. Also available at resolution time from `action.targetCharacterId`.

**5b — `player.deckCount` missing from move-effect resolution context.**
The `move` effect evaluator has no access to the player's deck size. Add
`player.deckCount` (= `player.playDeck.length`) to the context fed to `when`
condition evaluation in `moveToFetchToDeckPayload` / the reducer path that
enqueues fetch pending effects.

**5c — `move` effect needs a `when` guard evaluated at resolution time.**
The `when` field already exists on `MoveEffect`, but `moveToFetchToDeckPayload`
ignores it — the condition is only used for the `discard-in-play` path. Extend
the fetch-to-deck enqueue logic to evaluate `move.when` against a resolution
context including `target.siteName` and `player.deckCount`; skip enqueuing if
the condition fails.

**5d — fetch is optional ("may").**
Already handled: `fetchFromPileLegalActions` always includes a `pass` action, so
the player may decline each pick. No new mechanism needed.

**5e — three picks, not one.**
`handleFetchFromPile` pops the effect after one pick. For Vilya's 3-pick fetch,
the effect must be re-enqueued (with `count` decremented) after each successful
fetch until `count === 0`. Modify `handleFetchFromPile`:

```typescript
const newCount = current.effect.count - 1;
const remaining = newCount > 0
  ? [{ ...current, effect: { ...current.effect, count: newCount } }, ...state.pendingEffects.slice(1)]
  : state.pendingEffects.slice(1);
```

When `pass` is taken (skip a pick), the entire remaining count is cancelled —
i.e., skipping one pick ends the fetch entirely. This matches "may take 3" (the
player commits to some number of fetches by not passing, but may stop early by
passing).

---

## Implementation Steps

### Step 1 — Extend PlayShortEventAction with `targetCharacterId`

**File:** `packages/shared/src/types/actions-short-event.ts`

Add:

```typescript
/**
 * For character-targeted short events whose play-target carries no tap cost
 * (e.g. Vilya — played on Elrond without tapping him). The reducer uses
 * this to identify the target character for stat boosts, corruption checks,
 * etc. Distinct from `targetScoutInstanceId`, which is set when the
 * play-target cost taps the character.
 */
readonly targetCharacterId?: CardInstanceId;
```

### Step 2 — Emit `targetCharacterId` in `playResourceShortEventActions`

**File:** `packages/shared/src/engine/legal-actions/organization.ts`

In the `else { emitPlay(undefined); }` branch (no tap cost), check whether the
card has a `play-target: character` filter. If so, enumerate eligible characters
using `eligiblePlayOptionTargets` and emit one `play-short-event` per eligible
character with `targetCharacterId` set. If no eligible characters exist, emit
`not-playable`.

For Vilya there can be at most one eligible Elrond, so at most one action is
emitted.

### Step 3 — Add `character-stat-modifier` constraint kind

**File:** `packages/shared/src/types/pending.ts`

Add the `character-stat-modifier` variant to the `ActiveConstraint.kind` union
(see Gap 2 above).

### Step 4 — Synthesize stat-modifiers from `character-stat-modifier` in resolver

**File:** `packages/shared/src/engine/effects/resolver.ts`

In the function that synthesises `company-stat-modifier` constraints (currently
`collectCompanyStatModifiers`), add a parallel path:

```typescript
for (const c of state.activeConstraints) {
  if (c.kind.type !== 'character-stat-modifier') continue;
  if (c.kind.characterId !== charInstance.instanceId) continue;
  results.push({
    effect: { type: 'stat-modifier', stat: c.kind.stat, value: c.kind.value },
    sourceDef: null,
    sourceInstance: c.source ?? null,
  });
}
```

Call this from `collectCharacterEffects` so character stat computation picks it up.

### Step 5 — Handle `character-stat-modifier` in `applyShortEventOnEntersPlay`

**File:** `packages/shared/src/engine/reducer-events.ts`

In `applyShortEventOnEntersPlay`, add a new branch for
`onEvent.apply.type === 'add-constraint'` with
`onEvent.apply.constraint === 'character-stat-modifier'`:

```typescript
case 'character-stat-modifier': {
  const characterId = action.type === 'play-short-event' ? action.targetCharacterId : undefined;
  if (!characterId) { logDetail('character-stat-modifier: no target — fizzle'); continue; }
  const stat = onEvent.apply.stat as 'prowess' | 'body' | 'direct-influence';
  const value = onEvent.apply.value as number;
  if (!stat || typeof value !== 'number') { logDetail('character-stat-modifier: missing stat or value — fizzle'); continue; }
  state = addConstraint(state, {
    source: handCard.instanceId,
    sourceDefinitionId: def.id,
    scope: { kind: 'turn' },
    target: { type: 'character', characterId },
    kind: { type: 'character-stat-modifier', stat, value, characterId },
  });
  logDetail(`character-stat-modifier: ${stat} ${value > 0 ? '+' : ''}${value} on ${characterId as string} (scope turn)`);
  break;
}
```

Also extend `buildPayloadConstraintKind` in `reducer-organization.ts` to handle
`character-stat-modifier` for grant-action paths (parity, not needed by Vilya
directly but required for the type system to be consistent).

### Step 6 — Handle `enqueue-corruption-check` in `applyShortEventOnEntersPlay`

**File:** `packages/shared/src/engine/reducer-events.ts`

In `applyShortEventOnEntersPlay`, add a branch for
`onEvent.apply.type === 'enqueue-corruption-check'`:

```typescript
if (onEvent.apply.type === 'enqueue-corruption-check') {
  const characterId = action.type === 'play-short-event' ? action.targetCharacterId : undefined;
  if (!characterId) { logDetail('enqueue-corruption-check: no target — fizzle'); continue; }
  const modifier = (onEvent.apply.modifier as number | undefined) ?? 0;
  logDetail(`enqueue-corruption-check: enqueuing check on ${characterId as string} (modifier ${modifier})`);
  state = enqueueCorruptionCheck(state, {
    source: handCard.instanceId,
    actor: playerIndex === 0 ? state.players[0].id : state.players[1].id,
    scope: { kind: 'phase', phase: state.phaseState.phase },
    characterId,
    modifier,
    reason: def.name,
  });
  continue;
}
```

### Step 7 — Add `scope: "turn"` duplication-limit check in site/org phases

**File:** `packages/shared/src/engine/legal-actions/organization.ts`

Inside `playResourceShortEventActions`, after the existing `discardInPlay`
block and before `emitPlay`, add:

```typescript
const turnDupLimit = def.effects?.find(
  (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'turn',
);
if (turnDupLimit) {
  const priorConstraints = state.activeConstraints.filter(
    c => c.sourceDefinitionId === def.id,
  ).length;
  if (priorConstraints >= turnDupLimit.max) {
    logDetail(`${def.name}: cannot be duplicated this turn (${priorConstraints} active constraint(s))`);
    actions.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId: handCard.instanceId },
      viable: false,
      reason: `${def.name} cannot be duplicated on a given turn`,
    });
    continue;
  }
}
```

### Step 8 — Conditional fetch: add `target.siteName` + `player.deckCount` to context

**File:** `packages/shared/src/engine/reducer-events.ts`

In the section that evaluates `move` effects and decides whether to enqueue fetch
pending effects (`interactiveEffects` collection in `handleResourceShortEvent`),
pass a context to evaluate `effect.when`:

```typescript
const targetChar = action.type === 'play-short-event' ? action.targetCharacterId : undefined;
const targetCharDef = targetChar ? state.players[playerIndex].characters[targetChar as string] : undefined;
const targetCompany = targetChar
  ? state.players[playerIndex].companies.find(c => c.characters.includes(targetChar))
  : undefined;
const targetSiteDef = targetCompany?.currentSite
  ? state.cardPool[targetCompany.currentSite.definitionId as string]
  : undefined;
const fetchWhenCtx = {
  target: {
    siteName: (targetSiteDef && 'name' in targetSiteDef) ? (targetSiteDef as { name: string }).name : undefined,
  },
  player: {
    deckCount: state.players[playerIndex].playDeck.length,
  },
};
```

Then in `moveToFetchToDeckPayload` (or in the loop that collects `interactiveEffects`),
evaluate `effect.when` against `fetchWhenCtx` before pushing the entry:

```typescript
if (effect.when && !matchesCondition(effect.when, fetchWhenCtx)) {
  logDetail(`${def.name}: fetch condition not met — skipping`);
  return [];  // don't enqueue fetch
}
```

### Step 9 — Support multi-pick (count > 1) in `handleFetchFromPile`

**File:** `packages/shared/src/engine/reducer-utils.ts`

In `handleFetchFromPile`, replace the line:

```typescript
const remaining = state.pendingEffects.slice(1);
```

with:

```typescript
const newCount = current.effect.count - 1;
const remaining = newCount > 0
  ? [{ ...current, effect: { ...current.effect, count: newCount } } as PendingEffect, ...state.pendingEffects.slice(1)]
  : state.pendingEffects.slice(1);
```

When the player chooses `pass` (in `handleSkipCurrentEffect`), the effect is
simply discarded (existing behaviour), which ends the entire fetch — the player
accepted fewer than 3 cards. No further changes needed for the pass path.

### Step 10 — Update card data

**File:** `packages/shared/src/data/tw-resources.json`

Replace the bare `tw-358` entry with a fully-specified card:

```json
{
  "cardType": "hero-resource-event",
  "id": "tw-358",
  "name": "Vilya",
  "image": "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Vilya.jpg",
  "text": "Playable on Elrond. +4 prowess, +2 body, +6 direct influence until the end of the turn. If Elrond is at Rivendell and your play deck has at least 5 cards in it, you may take 3 resource cards of your choice from your discard pile and shuffle them into your play deck. Elrond makes a corruption check modified by -3. Cannot be duplicated on a given turn.",
  "alignment": "wizard",
  "unique": false,
  "eventType": "short",
  "marshallingPoints": 0,
  "marshallingCategory": "misc",
  "effects": [
    {
      "type": "play-target",
      "target": "character",
      "filter": { "target.name": "Elrond" }
    },
    {
      "type": "duplication-limit",
      "scope": "turn",
      "max": 1
    },
    {
      "type": "on-event",
      "event": "self-enters-play",
      "apply": { "type": "add-constraint", "constraint": "character-stat-modifier", "stat": "prowess", "value": 4, "scope": "turn" }
    },
    {
      "type": "on-event",
      "event": "self-enters-play",
      "apply": { "type": "add-constraint", "constraint": "character-stat-modifier", "stat": "body", "value": 2, "scope": "turn" }
    },
    {
      "type": "on-event",
      "event": "self-enters-play",
      "apply": { "type": "add-constraint", "constraint": "character-stat-modifier", "stat": "direct-influence", "value": 6, "scope": "turn" }
    },
    {
      "type": "move",
      "select": "target",
      "from": "discard",
      "to": "deck",
      "shuffleAfter": true,
      "count": 3,
      "filter": {
        "cardType": {
          "$in": [
            "hero-character",
            "hero-resource-item",
            "hero-resource-ally",
            "hero-resource-faction",
            "hero-resource-event"
          ]
        }
      },
      "when": {
        "$and": [
          { "target.siteName": "Rivendell" },
          { "player.deckCount": { "$gte": 5 } }
        ]
      }
    },
    {
      "type": "on-event",
      "event": "self-enters-play",
      "apply": { "type": "enqueue-corruption-check", "modifier": -3 }
    }
  ]
}
```

> **Note on `alignment: "wizard"`:** The existing data has `"alignment": "wizard"`.
> The authoritative `data/cards.json` lists this card as `"alignment": "Hero"`. The
> cardType `"hero-resource-event"` is the correct machine tag for the engine. Keep
> `"alignment": "wizard"` as-is (it is a label/display field, not the engine-facing
> alignment). Do not change it during this cert.

### Step 11 — Update DSL documentation

**File:** `docs/card-effects-dsl.md`

Add entries for:

1. **`character-stat-modifier` constraint kind** — per-character turn-scoped stat
   bonus, analogous to `company-stat-modifier`. Note that `stat` accepts all three
   values: `"prowess"`, `"body"`, `"direct-influence"`.

2. **`on-event: self-enters-play` → `enqueue-corruption-check`** — documents the
   new apply type, fields (`modifier`), and target (the `targetCharacterId` from the
   play action).

3. **`move.when` evaluated at enqueue time** — documents that `when` on a
   fetch-to-deck move effect is evaluated against `{ target.siteName, player.deckCount }`
   and gates whether the pending fetch is enqueued at all.

4. **Multi-pick fetch (`move.count > 1`)** — documents that count > 1 causes the
   pending effect to be re-enqueued (decremented) after each pick; `pass` cancels
   remaining picks.

### Step 12 — Write card test

**File:** `packages/shared/src/tests/cards/tw-358.test.ts`

All tests use hero characters (wizard-player), Rivendell (`tw-421`) as current site,
and Elrond (`tw-145`). Use `RESOURCE_PLAYER` / `HAZARD_PLAYER` constants.

**Test 1 — Vilya is playable only in Elrond's company**
```
State: site phase, Elrond in company, Vilya in hand.
Expected: `play-short-event` with `targetCharacterId = Elrond.instanceId` is viable.
```

**Test 2 — Vilya is NOT playable when Elrond is not in any company**
```
State: site phase, no Elrond in play, Vilya in hand.
Expected: `not-playable` for Vilya.
```

**Test 3 — Vilya cannot be duplicated on a given turn (site phase)**
```
State: active constraint sourced from `tw-358` already on state, Vilya still in hand.
Expected: `not-playable` (duplication limit hit).
```

**Test 4 — Playing Vilya adds +4 prowess constraint on Elrond**
```
Dispatch `play-short-event` with Vilya, targetCharacterId = Elrond.
Expected: `activeConstraints` contains a `character-stat-modifier` entry
          (stat: prowess, value: 4, characterId: Elrond.instanceId, scope: turn).
Expected: Elrond's `effectiveStats.prowess` is 7 + 4 = 11.
```

**Test 5 — Playing Vilya adds +2 body and +6 direct-influence on Elrond**
```
Same setup.
Expected: Elrond effectiveStats.body = 9 + 2 = 11; effectiveStats.directInfluence = 4 + 6 = 10.
```

**Test 6 — Playing Vilya enqueues a corruption check on Elrond (modifier −3)**
```
Same setup.
Expected: `state.pendingResolutions` contains a corruption-check for Elrond
          with modifier −3.
```

**Test 7 — Fetch offered when Elrond is at Rivendell and deck ≥ 5 cards**
```
State: Elrond at Rivendell (currentSite = tw-421), discard pile has 2 hero resources,
       play deck has 5+ cards.
Dispatch `play-short-event`.
Expected: `pendingEffects[0].effect.type === 'fetch-to-deck'` with count 3.
Expected: legal actions include `fetch-from-pile` for each eligible discard card.
```

**Test 8 — Fetch NOT offered when Elrond is not at Rivendell**
```
State: Elrond at a non-Rivendell site (e.g. Moria).
Dispatch `play-short-event`.
Expected: no `fetch-to-deck` pending effect.
```

**Test 9 — Fetch NOT offered when play deck has fewer than 5 cards**
```
State: Elrond at Rivendell, deck has 4 cards.
Dispatch `play-short-event`.
Expected: no `fetch-to-deck` pending effect.
```

**Test 10 — Multi-pick: second pick offered after first fetch**
```
State: 3 eligible resources in discard, Elrond at Rivendell, deck ≥ 5.
Dispatch play + first `fetch-from-pile`.
Expected: `pendingEffects[0].effect.count === 2` — second pick offered.
```

**Test 11 — Pass cancels remaining picks**
```
Same setup. After first fetch, dispatch `pass`.
Expected: `pendingEffects` empty (remaining count cancelled).
```

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| `targetCharacterId` on `PlayShortEventAction` (separate from `targetScoutInstanceId`) | `targetScoutInstanceId` semantically means "the scout who paid a tap cost". Vilya's Elrond target is *not* tapped; conflating the two would break any logic that tests whether the target was tapped. |
| Three separate `on-event: self-enters-play` entries (one per stat) | Avoids a multi-stat apply shape; each entry is independent, readable, and mirrors how permanent items express their modifiers. |
| `when` on move effect evaluated at enqueue time (not at legal-action time) | The condition depends on runtime state (Elrond's current site) that is available in the reducer but cannot easily be threaded into the legal-action emitter without duplicating resolution logic. Evaluating in the reducer keeps the emitter stateless. |
| `pass` cancels all remaining picks, not one | "May take 3" in card text is a single offer; once the player declines, the rest lapses. This is consistent with how Smoke Rings works (1 pick with a pass). |
| `character-stat-modifier` swept at turn end via existing scope mechanism | No new sweep logic: `sweepExpired` already clears `scope: { kind: 'turn' }` constraints at turn start, exactly like `company-stat-modifier`. |

## Dependency Order

Steps 1–3 (type additions) can be done in parallel; all other steps depend on them.
Step 4 depends on Step 3. Step 5 depends on Steps 1, 3. Step 6 depends on Step 1.
Step 7 is independent of Steps 2–6. Step 8 depends on Steps 3, 5, 8b.
Steps 9–10 (DSL docs + test) depend on all above.
