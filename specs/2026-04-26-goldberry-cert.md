# Goldberry (tw-245) Certification Plan

**Date:** 2026-04-26
**Card:** Goldberry (tw-245) — hero-resource-ally
**Branch:** `certify-tw-245-goldberry`

## Card Text

> Unique. Playable at Old Forest. May not be attacked. Tap Goldberry to cancel
> an effect declared earlier in the same chain of effects that would return
> Goldberry's company to its site of origin. Alternatively, tap Goldberry to
> cancel one attack against her company keyed to Wilderness [{w}].

## Already Implemented

| Rule | Effect | Status |
|------|--------|--------|
| Unique | standard uniqueness check | ✓ |
| Playable at Old Forest | `playableAt: [{ site: "Old Forest" }]` | ✓ |
| May not be attacked | `combat-protection: no-attack` | ✓ |
| Cancel Wilderness [{w}] attack | `cancel-attack` with `when: { "attack.keying": "wilderness" }` | ✓ |

## Missing Rule (test.todo in tw-245.test.ts)

**Cancel chain entry that would return company to site of origin** — Goldberry may
tap during the declaring phase of a chain to negate a hazard long-event chain entry
whose effect would return her company to its site of origin (e.g. Snowstorm, Foul
Fumes, Long Winter).

This requires two independent pieces:

1. **`force-return-to-origin` DSL effect** — tags hazard environment events whose
   resolution would cause a moving company to return to origin. Without this tag,
   there is no way for the chain engine to know which entries Goldberry can target.

2. **`cancel-chain-return-to-origin` DSL effect on Goldberry** — an in-play ally
   ability that fires during chain-declaring in the M/H phase, offering Goldberry
   as a tap source to negate the tagged entry.

---

## Implementation Steps

### Step 1 — Add `ForceReturnToOriginEffect` to effects.ts

**File:** `packages/shared/src/types/effects.ts`

New interface (add to the `CardEffect` union):

```typescript
/**
 * When this hazard long-event (environment) resolves and remains in play,
 * any moving company whose site path satisfies `condition` must return to
 * its site of origin. Used by Snowstorm, Foul Fumes, Long Winter, etc.
 *
 * `rangerException: true` means a company containing a ranger is exempt.
 *
 * This tag is also consumed by the chain engine: when Goldberry (or a
 * similar card) looks for a "would return to origin" chain entry, it
 * matches any unresolved entry whose source card definition carries this
 * effect.
 */
export interface ForceReturnToOriginEffect extends EffectBase {
  readonly type: 'force-return-to-origin';
  /** Company-context condition that must hold for the effect to apply. */
  readonly condition?: Condition;
  /** If true, a company containing at least one ranger is exempt. */
  readonly rangerException?: boolean;
}
```

Add `ForceReturnToOriginEffect` to the `CardEffect` union at the bottom of the file.

### Step 2 — Add `CancelChainReturnToOriginEffect` to effects.ts

**File:** `packages/shared/src/types/effects.ts`

New interface (add to the `CardEffect` union):

```typescript
/**
 * In-play ally ability: tap this ally during the M/H chain declaring window
 * to negate an unresolved chain entry that carries a `force-return-to-origin`
 * effect and would apply to this ally's company.
 *
 * Used by Goldberry (tw-245). Modelled parallel to `cancel-attack` but fires
 * during chain declaring, not the combat pre-assignment window.
 */
export interface CancelChainReturnToOriginEffect extends EffectBase {
  readonly type: 'cancel-chain-return-to-origin';
  readonly cost: { readonly tap: 'self' };
}
```

Add `CancelChainReturnToOriginEffect` to the `CardEffect` union.

### Step 3 — Add `CancelReturnToOriginAction` to actions

**File:** `packages/shared/src/types/actions-movement-hazard.ts`

```typescript
/**
 * Resource player taps an in-play ally (Goldberry) to negate a
 * `force-return-to-origin` chain entry before it resolves.
 */
export interface CancelReturnToOriginAction {
  readonly type: 'cancel-return-to-origin';
  readonly player: PlayerId;
  /** The ally instance being tapped (Goldberry). */
  readonly allyInstanceId: CardInstanceId;
  /** The chain entry's card instance to negate. */
  readonly targetInstanceId: CardInstanceId;
}
```

Add `CancelReturnToOriginAction` to the `GameAction` union and export it from `index.ts`.

### Step 4 — Emit the action in `chain.ts`

**File:** `packages/shared/src/engine/legal-actions/chain.ts`

Add a new helper `cancelReturnToOriginChainActions` and call it from `chainActions`
after the existing granted-action block (also inside the `Phase.MovementHazard` guard):

```typescript
function cancelReturnToOriginChainActions(
  state: GameState,
  playerId: PlayerId,
): EvaluatedAction[] {
  const chain = state.chain!;
  if (state.phaseState.phase !== Phase.MovementHazard) return [];

  // Only the resource (defending) player benefits from this ability
  const resourcePlayer = state.players.find(p => p.id === state.activePlayer);
  if (!resourcePlayer || playerId !== resourcePlayer.id) return [];

  const mhState = state.phaseState;
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const company = state.players[playerIndex].companies[mhState.activeCompanyIndex];
  if (!company) return [];

  // Collect unresolved entries that would return this company to origin
  const returnEntries = chain.entries.filter(e => {
    if (e.resolved || e.negated || !e.card) return false;
    const def = state.cardPool[e.card.definitionId as string];
    if (!def || !('effects' in def) || !def.effects) return false;
    return (def.effects as readonly CardEffect[]).some(
      (eff): eff is ForceReturnToOriginEffect => eff.type === 'force-return-to-origin',
    );
  });
  if (returnEntries.length === 0) return [];

  const actions: EvaluatedAction[] = [];

  // Scan all allies in the active company for cancel-chain-return-to-origin
  for (const charId of company.characters) {
    const charData = state.players[playerIndex].characters[charId as string];
    if (!charData) continue;
    for (const ally of charData.allies ?? []) {
      const allyDef = state.cardPool[ally.definitionId as string];
      if (!allyDef || !('effects' in allyDef) || !allyDef.effects) continue;
      const cancelEffect = (allyDef.effects as readonly CardEffect[]).find(
        (e): e is CancelChainReturnToOriginEffect => e.type === 'cancel-chain-return-to-origin',
      );
      if (!cancelEffect) continue;
      if (ally.status !== CardStatus.Untapped) {
        logDetail(`cancel-chain-return-to-origin: ${allyDef.name ?? ally.definitionId as string} is tapped`);
        continue;
      }
      for (const entry of returnEntries) {
        logDetail(`cancel-chain-return-to-origin: ${allyDef.name} can cancel ${state.cardPool[entry.card!.definitionId as string]?.name ?? entry.card!.definitionId as string}`);
        actions.push({
          action: {
            type: 'cancel-return-to-origin',
            player: playerId,
            allyInstanceId: ally.instanceId,
            targetInstanceId: entry.card!.instanceId,
          },
          viable: true,
        });
      }
    }
  }

  return actions;
}
```

Call site in `chainActions` (inside the existing `Phase.MovementHazard` guard block):

```typescript
actions.push(...cancelReturnToOriginChainActions(state, playerId));
```

### Step 5 — Handle the action in `chain-reducer.ts`

**File:** `packages/shared/src/engine/chain-reducer.ts`

Add a new branch to `handleChainAction` (or its dispatch switch):

```typescript
if (action.type === 'cancel-return-to-origin') {
  return handleCancelReturnToOrigin(state, chain, action);
}
```

New function:

```typescript
function handleCancelReturnToOrigin(
  state: GameState,
  chain: ChainState,
  action: CancelReturnToOriginAction,
): ReducerResult {
  // Tap the ally
  const playerIndex = state.players.findIndex(p => p.id === action.player);
  if (playerIndex === -1) return { state, error: 'cancel-return-to-origin: player not found' };

  const player = state.players[playerIndex];
  const mhState = state.phaseState as MovementHazardPhaseState;
  const company = player.companies[mhState.activeCompanyIndex];
  if (!company) return { state, error: 'cancel-return-to-origin: active company not found' };

  let tapped = false;
  const updatedChars = { ...player.characters };
  for (const charId of company.characters) {
    const charData = updatedChars[charId as string];
    if (!charData) continue;
    const allyIdx = charData.allies.findIndex(a => a.instanceId === action.allyInstanceId);
    if (allyIdx === -1) continue;
    const newAllies = [...charData.allies];
    newAllies[allyIdx] = { ...newAllies[allyIdx], status: CardStatus.Tapped };
    updatedChars[charId as string] = { ...charData, allies: newAllies };
    tapped = true;
    const defName = state.cardPool[newAllies[allyIdx].definitionId as string]?.name ?? action.allyInstanceId as string;
    logDetail(`cancel-return-to-origin: tapping ${defName}`);
    break;
  }
  if (!tapped) return { state, error: 'cancel-return-to-origin: ally not found in company' };

  // Negate the target chain entry
  const entryIdx = chain.entries.findIndex(
    e => e.card?.instanceId === action.targetInstanceId && !e.resolved && !e.negated,
  );
  if (entryIdx === -1) return { state, error: 'cancel-return-to-origin: target chain entry not found' };

  const targetName = state.cardPool[chain.entries[entryIdx].card!.definitionId as string]?.name
    ?? action.targetInstanceId as string;
  logDetail(`cancel-return-to-origin: negating chain entry "${targetName}"`);

  const newEntries = chain.entries.map((e, i) =>
    i === entryIdx ? { ...e, negated: true } : e,
  );

  const newPlayers: [PlayerState, PlayerState] = [...state.players] as [PlayerState, PlayerState];
  newPlayers[playerIndex] = { ...player, characters: updatedChars };

  return {
    state: {
      ...state,
      players: newPlayers,
      chain: { ...chain, entries: newEntries, priority: /* flip priority */ chain.priority },
    },
  };
}
```

> **Note on priority flip:** after a cancel action, priority typically moves to the
> opposing player so they can respond (or pass). Follow the same priority-flip logic
> used by `handlePassChainPriority` — set `chain.priority` to the other player and
> reset `resourcePlayerPassed` / `hazardPlayerPassed` if applicable.

### Step 6 — Update card data JSON

**File:** `packages/shared/src/data/tw-hazards.json`

Add `force-return-to-origin` effects to Snowstorm (`tw-91`) and Foul Fumes (`tw-36`):

**Snowstorm (tw-91):**

```json
"effects": [
  {
    "type": "force-return-to-origin",
    "condition": { "sitePath.wildernessCount": { "$gte": 1 } }
  }
]
```

*(No ranger exception for Snowstorm per card text.)*

**Foul Fumes (tw-36):**

```json
"effects": [
  {
    "type": "force-return-to-origin",
    "condition": {
      "$or": [
        { "sitePath.shadowCount": { "$gte": 1 } },
        { "sitePath.darkDomainCount": { "$gte": 1 } }
      ]
    },
    "rangerException": true
  }
]
```

**Long Winter (tw-49) and Long Winter (le-117):** similar structure with
`{ "sitePath.wildernessCount": { "$gte": 2 } }` condition and `"rangerException": true`.

> These data changes are prerequisite for the test, but the full engine enforcement of
> `force-return-to-origin` (setting `returnedToOrigin: true` during order-effects) is
> **outside the scope of this certification**. The tag is only consumed by the chain
> legal-action logic to identify valid Goldberry targets; evaluating and enforcing
> the return itself is tracked in rule-5.31 (`test.todo`).

**File:** `packages/shared/src/data/tw-resources.json`

Add the `cancel-chain-return-to-origin` effect to Goldberry (`tw-245`):

```json
{
  "type": "cancel-chain-return-to-origin",
  "cost": { "tap": "self" }
}
```

Full updated `effects` array for `tw-245`:

```json
"effects": [
  {
    "type": "combat-protection",
    "protection": "no-attack"
  },
  {
    "type": "cancel-chain-return-to-origin",
    "cost": { "tap": "self" }
  },
  {
    "type": "cancel-attack",
    "cost": { "tap": "self" },
    "when": { "attack.keying": "wilderness" }
  }
]
```

### Step 7 — Update DSL documentation

**File:** `docs/card-effects-dsl.md`

Add entries for `force-return-to-origin` and `cancel-chain-return-to-origin` with
fields, semantics, and example cards. Cross-reference rule-5.31 for the enforcement
side (out of scope here).

### Step 8 — Complete card test

**File:** `packages/shared/src/tests/cards/tw-245.test.ts`

Replace the `test.todo` with a concrete assertion:

**Test: Goldberry CAN cancel a return-to-origin chain entry**

```text
State: M/H phase, chain declaring (Snowstorm on chain as unresolved entry),
       Goldberry untapped in PLAYER_1's active company.
Expected: viableActions contains cancel-return-to-origin with allyInstanceId =
          Goldberry's instanceId and targetInstanceId = Snowstorm's instanceId.
```

**Test: tapped Goldberry cannot cancel return-to-origin**

```text
Same setup but Goldberry is tapped.
Expected: no cancel-return-to-origin action offered.
```

**Test: cancel-return-to-origin is NOT offered when no return-to-origin entry is on chain**

```text
M/H chain declaring phase but with an ordinary hazard creature on chain.
Expected: no cancel-return-to-origin action for Goldberry.
```

**Test: after cancel, chain entry is negated and Goldberry is tapped**

```text
Dispatch cancel-return-to-origin action; inspect resulting state.
Expected: entry.negated === true; Goldberry's status === CardStatus.Tapped.
```

Update the module-level table to mark rule 4 as `IMPLEMENTED`.
Update `Playable: PARTIALLY` → `Playable: YES`. Add `certified: "2026-04-26"` to the
card data once all tests pass.

### Step 9 — Pre-push verification

Run in parallel:

1. `npm run build`
2. `npx vitest run packages/shared/src/tests/cards/tw-245.test.ts`
3. `npm test`
4. `npm run lint`
5. `npm run test:nightly`

Fix any failures, then open the PR.

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| `force-return-to-origin` as a DSL tag on hazard data | Avoids hardcoding Snowstorm/Foul Fumes IDs in the chain engine; any future card with this tag is automatically targetable by Goldberry |
| Scope of this cert: chain detection only, not enforcement | `returnedToOrigin` enforcement is rule-5.31 work. Goldberry's cert only needs chain-time detection; the two features are independent |
| `cancel-chain-return-to-origin` as a distinct effect type from `cancel-attack` | Different window (chain-declaring vs combat pre-assignment), different target (chain entry vs attack object), different action type — sharing the type would conflate unrelated mechanics |
| `CancelReturnToOriginAction` as a new action type | Keeps the action shape explicit and traceable in game logs; avoids overloading `play-short-event` or `cancel-attack` |
| Ranger exception stored in data, not hardcoded | Matches the pattern for other hazard conditions; the exception is only relevant for the enforcement side (out of scope here) but stored now to avoid a second data PR |

## Dependency Order

Steps 1–3 (type and action additions) can be done in parallel.
Step 4 depends on Steps 1, 2, 3.
Step 5 depends on Steps 1, 2, 3.
Step 6 depends on Steps 1, 2.
Step 7 depends on all above.
Step 8 (tests) depends on all above.
