# Cost System — DSL Unification Plan

## Current State

`ActionCost` is defined in `packages/shared/src/types/effects.ts:318` with four fields:

```typescript
export interface ActionCost {
  readonly tap?: string;      // "self" | "bearer" | "character" | "sage-in-company"
  readonly discard?: string;  // "self"
  readonly check?: string;    // "corruption"
  readonly modifier?: number; // modifier to check roll
}
```

### Cost shapes in use across card data files

| Shape | Count | Example cards |
|---|---|---|
| `{ tap: "self" }` | ~10 | shields (cancel-strike), Gandalf, Saruman, Fatty Bolger |
| `{ tap: "bearer" }` | ~8 | hazard removal (Foolish Words, Lure of Nature…), Wizard's Staff |
| `{ tap: "character" }` | ~6 | Stealth, Marvels Told, Great Ship, Voices of Malice |
| `{ tap: "sage-in-company" }` | 1 | Dragon's Curse |
| `{ discard: "self" }` | ~6 | Cram, Orc-draughts, Gwaihir, Foul-smelling Paste |
| `{ check: "corruption", modifier: -2 }` | 3 | The One Ring, Vanishment, Wizard's Laughter |

Costs appear on: `grant-action`, `cancel-attack`, `cancel-strike`, `cancel-influence`, `play-target`, `modify-attack`, `item-tap-strike-bonus`.

---

## The Problem: Cost Enforcement Is Duplicated Across 4+ Files

The same tap/discard/check logic is independently re-implemented in:

| File | Covers |
|---|---|
| `reducer-organization.ts:1300–1416` | `grant-action` apply |
| `legal-actions/organization.ts:375,411,429,479,571` | `grant-action` legality |
| `reducer-events.ts:297–300` | `play-target` apply |
| `legal-actions/organization.ts:867,1054–1071` | `play-target` legality |
| `reducer-combat.ts:1103–1157` | `cancel-attack` apply |
| `legal-actions/combat.ts:1031–1057` | `cancel-attack` legality |
| `pending-reducers.ts:517–537` | `cancel-influence` apply |

Each site independently checks "is the cost payable?" and "apply the payment". This is ~150–200 LOC of duplication.

---

## Plan

### 1. Create `src/engine/cost-evaluator.ts`

Two pure functions covering all current and planned cost shapes:

```typescript
canPayCost(state: GameState, cost: ActionCost, actorId: CardInstanceId, context: CostContext): boolean

applyCost(state: GameState, cost: ActionCost, actorId: CardInstanceId, context: CostContext): GameState
```

`CostContext` carries whatever varies by call site (the bearer ID, the target character ID, the company, etc.).

### 2. Replace duplicated cost checks in all 4+ files

Each effect type delegates to `canPayCost` / `applyCost` instead of re-implementing the logic.

### 3. Extend `ActionCost` with missing cost types

Two gaps are needed for upcoming cards and fit the existing pattern cleanly:

```typescript
export interface ActionCost {
  readonly tap?: "self" | "bearer" | "character" | "sage-in-company"
  readonly discard?: "self" | "bearer" | "character"   // add bearer, character
  readonly wound?: "self" | "bearer" | "character"     // new: wounding as a cost
  readonly check?: "corruption"
  readonly modifier?: number
}
```

**Why `wound` as a cost:** Currently `wound-target-character` is a separate effect type paired alongside `cancel-attack`. Semantically the wound is the price paid, not the thing gained. Modeling it as an `ActionCost` field is cleaner and reuses the cost evaluator.

### 4. Update `docs/card-effects-dsl.md`

The current doc understates supported cost shapes:

- `play-target` says only `{ tap: "character" }` is supported (line ~892) — should list all
- `grant-action` says only `tap: "bearer"` and `tap: "sage-in-company"` — incomplete

---

## What Stays in Code (Not DSL)

- **Corruption check resolution** — requires dice roll, pending state, sequenced resolution. `{ check: "corruption" }` is the correct thin DSL handle that triggers existing check machinery. No change needed.
- **`play-condition: discard-named-card`** — this is a *prerequisite* (a different card must be discarded to play this card at all), not a cost of an activated effect. It belongs where it is.
- **MP costs / influence costs** — no cards currently use these. Don't add until needed.

---

## Expected Outcome

- ~150–200 LOC removed from duplicated cost checks
- New cost shapes (`wound`, `discard: "bearer"/"character"`) available for free to any effect type
- `docs/card-effects-dsl.md` accurately reflects the full cost vocabulary
- No rule changes — pure refactor with same observable behaviour
