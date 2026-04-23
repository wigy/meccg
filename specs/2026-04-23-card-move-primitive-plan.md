# Card-Move Primitive Plan

Replace the ~11 zone-movement effect types scattered across four
reducers with a single generic `move` primitive parameterized by
source zone, destination zone, and selector. Continues the direction
set by `2026-04-13-dsl-generalization-plan.md` and
`2026-04-21-single-card-dsl-consolidation.md`: keep card behaviour in
card JSON, keep the engine small.

## Guiding principle

> Every card-movement effect is a triple: *pick instances, remove from
> their current zone, append to a destination zone*. When the triple
> is expressible as data, the engine should have one code path that
> reads the data — not a switch over eleven names that all do the same
> three things.

## Current state (2026-04-23)

Eleven effect `type`s currently encode zone movement, each with a
dedicated reducer branch:

| Effect type | Reducer | Fan-out (card JSON) |
|---|---|---|
| `discard-self` | `reducer-organization.ts:855`, `reducer-utils.ts:516` sweeper, `reducer-movement-hazard.ts` | 10 |
| `discard-target-item` | `reducer-organization.ts:1049` | 1 |
| `discard-named-card-from-company` | `reducer-organization.ts:1166` | 1 |
| `move-target-from-discard-to-hand` | `reducer-organization.ts:1238` | 2 |
| `discard-in-play` | `reducer-events.ts:412` | 2 |
| `discard-cards-in-play` | `chain-reducer.ts:851` | 2 |
| `discard-non-special-items` | `reducer-combat.ts:1750` | 3 |
| `reshuffle-self-from-hand` | action-triggered (see `actions.ts`) | 1 |
| `fetch-to-deck` | `reducer-events.ts:378`, `chain-reducer.ts:700`, `reducer-utils.ts:697` | 3 |
| `bounce-hazard-events` | `reducer-events.ts:471` | 1 |
| `enqueue-pending-fetch` | `reducer-organization.ts:1259` (wraps `fetch-to-deck`) | n/a |

Total: ~400-500 LOC of handler code that shares a common shape —
*locate instance(s), remove from source, push to destination, maybe
shuffle, maybe enqueue a corruption check*.

## Target shape

Single effect type `move` with a small, closed parameter surface:

```ts
export interface MoveEffect extends EffectBase {
  readonly type: 'move';

  /** How to choose which card instance(s) the primitive operates on. */
  readonly select:
    | 'self'          // the card carrying this effect
    | 'target'        // action.targetCardId (user-selected)
    | 'filter-all'    // every matching instance in scope (bulk)
    | 'named';        // first instance whose definition matches cardName

  /** Scope(s) to locate source instances in. */
  readonly from: MoveZone | readonly MoveZone[];

  /** Destination zone. */
  readonly to: MoveZone;

  /** Whose copy of the destination zone to push to. */
  readonly toOwner?: 'source-owner' | 'opponent' | 'defender';

  /** DSL condition evaluated against candidate card definitions. */
  readonly filter?: Condition;

  /** Cap on how many instances to move; omitted = all matches. */
  readonly count?: number;

  /** Shuffle the destination pile after pushing. */
  readonly shuffleAfter?: boolean;

  /** Enqueue a corruption check on the bearer after resolution. */
  readonly corruptionCheck?: { readonly modifier: number };

  /** For `select: 'named'`: the card name to match. */
  readonly cardName?: string;
}

export type MoveZone =
  | 'hand'
  | 'deck'
  | 'discard'
  | 'sideboard'
  | 'out-of-play'
  | 'kill-pile'
  | 'self-location'              // wherever the source card currently lives
  | 'in-play'                    // any in-play card matching filter
  | 'items-on-target'            // items attached to action.targetCardId
  | 'items-on-wounded'           // items on the wounded character (combat)
  | 'attached-to-target-company';
```

Direct translations of every current effect:

| Current | `move` shape |
|---|---|
| `discard-self` | `{ select: 'self', from: 'self-location', to: 'discard' }` |
| `discard-target-item` | `{ select: 'target', from: 'items-on-target', to: 'discard' }` |
| `discard-named-card-from-company` | `{ select: 'named', from: 'attached-to-target-company', to: 'discard', cardName }` |
| `move-target-from-discard-to-hand` | `{ select: 'target', from: 'discard', to: 'hand', filter }` |
| `discard-in-play` | `{ select: 'target', from: 'in-play', to: 'discard', filter }` |
| `discard-cards-in-play` | `{ select: 'filter-all', from: 'in-play', to: 'discard', filter }` |
| `discard-non-special-items` | `{ select: 'filter-all', from: 'items-on-wounded', to: 'discard', toOwner: 'defender' }` |
| `reshuffle-self-from-hand` | `{ select: 'self', from: 'hand', to: 'deck', shuffleAfter: true }` |
| `fetch-to-deck` | `{ select: 'target', from: ['sideboard','discard'], to: 'deck', shuffleAfter: true, filter, count }` |
| `bounce-hazard-events` | `{ select: 'filter-all', from: 'attached-to-target-company', to: 'hand', toOwner: 'opponent', filter, corruptionCheck }` |

`enqueue-pending-fetch` stays — it's not a move, it's a scheduler that
wraps a move into `pendingEffects`. Its inner payload becomes a
`MoveEffect` directly.

## Engine shape

Three helpers in a new `reducer-move.ts`:

```ts
// Find the instance(s) the move targets. Returns them together with a
// `remove(state) → state` callback that detaches them from wherever
// they live (hand, discard, a character's items, an in-play slot, …).
// This is the one place that knows about every pile in the game and is
// the single enforcement point of the "no card disappears" invariant.
function resolveMoveSource(
  state: GameState,
  move: MoveEffect,
  ctx: MoveContext,
): { instances: CardInstance[]; remove: (s: GameState) => GameState } | { error: string };

// Push cards to the chosen destination on the chosen owner's state.
function pushToZone(
  state: GameState,
  move: MoveEffect,
  ctx: MoveContext,
  cards: CardInstance[],
): GameState;

// Orchestrator — the only entry point from the apply dispatcher.
export function applyMove(
  state: GameState,
  move: MoveEffect,
  ctx: MoveContext,
): { state: GameState } | { error: string };
```

`MoveContext` carries the action-time data every current reducer
already has access to: `playerIndex`, `sourceCardId` (the card emitting
the effect), `characterId` (the character paying cost, if any),
`targetCardId`, and combat-specific fields (`wounded`, `defender`) when
invoked from `reducer-combat.ts`.

## Migration phases

The invariant is that **each phase ships on master on its own** and
leaves all tests green. No big-bang rewrite.

### Phase 1 — land the primitive alongside the old effects

1. Add `MoveEffect` / `MoveZone` to `types/effects.ts`. Add
   `'move'` to the `CardEffect` union.
2. Implement `applyMove` + the two helpers in a new
   `engine/reducer-move.ts`. Export from `engine/index.ts`.
3. Wire a single `apply.type === 'move'` branch into the apply
   dispatcher in `reducer-organization.ts` that calls `applyMove`.
4. Document the primitive in `docs/card-effects-dsl.md` — one new
   section, with a table translating each old effect to its `move`
   shape. Mark old effects as "deprecated alias".

No card JSON changes yet. No behaviour changes yet. Build stays green.

### Phase 2 — port the easy four

Each card JSON migrated one at a time; each migration is its own PR
with the relevant card test verifying parity:

1. `reshuffle-self-from-hand` → one card (`le-235` Sudden Call).
2. `move-target-from-discard-to-hand` → two cards (Saruman, Wizard's
   Staff).
3. `discard-in-play` → two cards.
4. `discard-cards-in-play` → two cards.

After each, delete the now-unused engine branch. **Expected LOC
removed: ~120.**

### Phase 3 — port `discard-self` (biggest fan-out)

`discard-self` is used in 10 cards and fires from three places:
grant-action applies, the sweeper in `reducer-utils.ts`, and the
`bearer-company-moves` hook in `reducer-movement-hazard.ts`. The
primitive needs to support the `sage-in-company` cost pattern, where
the source card lives on a bearer who isn't the cost-paying character
— handled inside `resolveMoveSource` for `from: 'self-location'` by
scanning the player's characters for the `sourceCardId`.

Steps:

1. Teach `resolveMoveSource` the `self-location` locator (lifted
   directly from `locateBearerOfSource` + `detachAndDiscardSource` in
   `reducer-organization.ts`).
2. Replace the `discard-self` branch in `reducer-organization.ts` with
   a call to `applyMove`.
3. Replace the `effect.apply?.type !== 'discard-self'` check in
   `reducer-utils.ts` sweeper with `effect.apply?.type !== 'move'`
   plus a shape guard (`to === 'discard' && select === 'self'`).
4. Same replacement in `reducer-movement-hazard.ts`.
5. Migrate the 10 card JSONs.

**Expected LOC removed: ~90.**

### Phase 4 — port `discard-target-item` and `discard-named-card-from-company`

These are the only effects that scan beyond the bearer's character:
target-item scans the bearer's company, named-card scans every
player's companies at the same site. Both map to new `from:`
locators (`items-on-target` and `attached-to-target-company`) in
`resolveMoveSource`. Migrate their one-card-each JSONs.

**Expected LOC removed: ~110.**

### Phase 5 — port `discard-non-special-items` (combat)

Requires a `MoveContext` extension so `reducer-combat.ts` can call
`applyMove` with a `wounded` character reference. Add
`items-on-wounded` locator + `toOwner: 'defender'`. Migrate three
creatures.

**Expected LOC removed: ~40.**

### Phase 6 — port `bounce-hazard-events` and `fetch-to-deck`

Both already match the target shape almost exactly:

- `bounce-hazard-events` already carries a `filter` and
  `corruptionCheck`; the locator is `attached-to-target-company` +
  `toOwner: 'opponent'`. Migrate Wizard Uncloaked.
- `fetch-to-deck` already carries `source: readonly string[]`,
  `filter`, `count`, `shuffle` — a near-identical subset of
  `MoveEffect`. Rename the field (`source` → `from`, `shuffle` →
  `shuffleAfter`) via a one-shot JSON migration, and collapse the
  three call sites (`reducer-events.ts`, `chain-reducer.ts`,
  `reducer-utils.ts`) onto `applyMove`. Update
  `enqueue-pending-fetch` to enqueue a `MoveEffect` payload.

**Expected LOC removed: ~140.**

### Phase 7 — clean up

1. Remove the 10 legacy effect interfaces and their union members.
2. Remove the dead apply dispatcher branches.
3. Replace the "deprecated alias" note in `docs/card-effects-dsl.md`
   with a single section documenting `move`.
4. Grep for any remaining string-literal references to the old
   effect type names.

## Estimated impact

- **LOC deleted from the engine:** ~400-450. Replaced by ~150 LOC in
  `reducer-move.ts`. Net: ~300 LOC down.
- **Apply dispatcher branches:** 11 → 1.
- **Card JSON sites touched:** 24 effect instances across 11 cards
  (plus shared tests).
- **New test surface:** zero — the existing card tests are the parity
  check. Any card that misbehaves after migration is caught by its
  own test.

## Risks and non-goals

- **`discard-self` sweeper path is the risky one.** Its trigger is a
  cross-reducer contract (sweep on every state-change that might
  newly satisfy a `when`). The shape guard in Phase 3 step 3 has to
  match exactly what the current string check matches — get that
  wrong and hazards stop auto-discarding. Mitigation: the card tests
  for every card using `company-composition-changed` and
  `bearer-company-moves` exercise this path directly.
- **`enqueue-pending-fetch` field renames ripple through the
  pending-effects queue.** Any unfinished game whose save contains a
  queued `fetch-to-deck` survives by leaving a thin shim that reads
  the old shape and constructs a `MoveEffect`. Can be deleted after
  one release.
- **Non-goal: unifying *triggering* with *movement*.** The "when does
  this move happen" axis (grant-action, on-event, combat wound,
  pending-effect resolution, action-triggered) stays as-is. This plan
  only touches the "what happens when it fires" axis.
- **Non-goal: adding new capabilities.** No new card gains any new
  behaviour from this refactor. If a migration tempts us to add a
  new `MoveZone` to support a not-yet-implemented card, that card is
  out of scope — add the zone when the card arrives.

## Rollback

Each phase is a separate PR. If a phase regresses, revert that PR —
the prior phases stay because they only *added* the primitive and
migrated cards one at a time. The old effect interfaces are not
deleted until Phase 7.
