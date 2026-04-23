# Chain Effect-Dispatch Plan

Follow-on to `2026-04-23-card-move-primitive-plan.md`. Once `move` is
in place, collapse the six bespoke short-event resolution branches in
`chain-reducer.ts` onto the shared apply layer, so every short/long
event becomes fully data-driven: the chain resolver iterates the
card's declared effects and hands each apply to the same dispatcher
that grant-actions already use.

## Guiding principle

> The chain decides **when** a card's effects fire and in **what
> order** relative to other cards. It should not decide **what** any
> individual card does. Every card-specific branch inside
> `resolveEntry` is a signal that the "what" axis has leaked into the
> chain.

## Scope

Resolution of chain entries only. Out of scope: priority, timing,
declaration order, deferred passives, follow-up chains, on-guard
interrupts, body checks. Those are the true responsibilities of the
chain and stay exactly as they are.

## Current state (2026-04-23)

`resolveEntry` (chain-reducer.ts:1245) contains six bespoke short-event
branches plus two long-event / permanent-event branches. Each reads
the card's effects or payload shape and does custom work:

| Branch (line) | Trigger condition | What it does |
|---|---|---|
| 1256 `resolveEnvironmentCancel` | `short-event` with `targetInstanceId` | Negate a chain entry or move an in-play card to discard |
| 1265 `applyShortEventArrivalTrigger` | `short-event`, not negated | Scan for `on-event: company-arrives-at-site → add-constraint`, apply it |
| 1272 `queueFetchToDecEffects` | `short-event`, not negated | Scan for `fetch-to-deck`, enqueue pending resolution |
| 1281 cancel-attack | `short-event` with `cancel-attack` effect | Call `resolveCancelAttackEntry` |
| 1295 faction-target | `short-event` with `targetFactionInstanceId` | Enqueue `muster-roll` |
| 1328 call-of-home | `short-event` with `call-of-home-check` effect | Enqueue `call-of-home-roll` |
| 1360 `resolvePermanentEvent` | `permanent-event` | Attach to char or push to cardsInPlay, fire self-enters-play |
| 1364 `resolveLongEvent` | `long-event` | Push to cardsInPlay |

**73 event cards** across `tw/as/le/td/dm` data files feed this code
path. Many of them — Smoke Rings, Concealment, Vanishment, Marvels
Told, Wizard Uncloaked, Sudden Call, the Palantír fetches — are
already half-data-driven: they declare effects like `cancel-attack`,
`fetch-to-deck`, `bounce-hazard-events`, `reshuffle-self-from-hand`,
and the chain resolver just knows to look for each kind. The smell is
that the resolver still pattern-matches on *which* effect a card
carries, rather than just running whatever effects are declared.

## Dependencies

This plan **requires** the move primitive to be in place. After the
move plan ships:

- `bounce-hazard-events`, `fetch-to-deck`, `discard-cards-in-play`,
  `discard-in-play` all become `move` variants → same dispatch path.
- `cancel-attack` stays as its own apply type (already data-driven —
  the current branch at line 1281 is a thin wrapper that can be
  folded into the generic dispatcher without changes).
- `cancel-chain-entry` (environment cancel) already exists as an
  apply type (used by grant-actions today) — the environment-cancel
  short-event branch at line 1256 can reuse it.
- `sequence` already exists and is used by River-style cards.

## Target shape

One dispatcher, one loop:

```ts
function resolveCardEffects(
  state: GameState,
  entry: ChainEntry,
): ResolveResult {
  const def = state.cardPool[entry.card!.definitionId as string];
  if (!def || !('effects' in def) || !def.effects) {
    return { state, needsInput: false };
  }

  const ctx = buildChainApplyContext(state, entry);
  let current = state;

  for (const effect of def.effects) {
    if (!shouldFireOnChainResolution(effect, entry)) continue;

    const result = applyEffect(current, effect, ctx);
    if ('error' in result) {
      logDetail(`Effect ${effect.type} errored: ${result.error}`);
      continue;
    }
    current = result.state;
    if (result.needsInput) {
      // Pending resolution enqueued (e.g. muster-roll, call-of-home).
      // Leave the entry unresolved; return early.
      return { state: current, needsInput: true };
    }
  }

  return { state: current, needsInput: false };
}
```

`shouldFireOnChainResolution` is a small predicate that filters the
card's effects to the subset that fire on chain resolution (vs. e.g.
`on-event: bearer-company-moves` which fires elsewhere, or
`play-flag` which is consumed at play-time).

`buildChainApplyContext` is the new piece — a single context object
exposing the data each apply needs: `declaredBy`, `targetInstanceId`,
`targetCharacterId`, `targetFactionInstanceId`, `sourceCardId`
(= `entry.card.instanceId`). The grant-action `MoveContext` (from the
move plan) extends cleanly to this shape.

## Migration phases

Each phase is one PR, shipped green on master. Card tests are the
parity oracle throughout. Phases strictly follow the dependency
order — nothing in this plan can start until the matching move-plan
phase is on master.

### Phase A — land the shared dispatcher

**Prereq**: move plan Phase 1 (primitive alongside old effects).

1. Add `applyEffect(state, effect, ctx)` in a new
   `engine/apply-dispatcher.ts`. Extract the existing dispatch logic
   currently split across `reducer-organization.ts` (grant-action
   applies) and the chain's bespoke branches. Grant-action callers
   become thin wrappers that build a context and call `applyEffect`.
2. Define `ChainApplyContext` in `engine/types/apply-context.ts`. The
   grant-action `MoveContext` becomes a subtype.
3. Implement `buildChainApplyContext(state, entry)` and
   `shouldFireOnChainResolution(effect, entry)`. The latter is data
   only — it reads `effect.type` and (for `on-event`) `effect.event`.
4. **No behaviour change yet.** The chain keeps its bespoke branches;
   grant-actions use the new dispatcher internally but externally
   behave identically. Card tests must remain green.

### Phase B — port `cancel-attack`

**Prereq**: A.

Current branch: chain-reducer.ts:1281 (wraps `resolveCancelAttackEntry`).

1. Register `cancel-attack` as a dispatched apply type. Move
   `resolveCancelAttackEntry` into the dispatcher.
2. Delete the branch at line 1281. The generic loop now fires it via
   the shared dispatcher.
3. Verify with Concealment, Vanishment, Dark Quarrels, Many Turns
   and Doublings tests.

**Expected LOC removed: ~20.**

### Phase C — port environment cancel

**Prereq**: A, move plan Phase 2 (for `cancel-chain-entry` context).

Current branch: chain-reducer.ts:1256 (`resolveEnvironmentCancel`).

1. Extend `cancel-chain-entry` apply with `select:
   'target-on-chain-or-in-play'` (today's apply only supports
   `most-recent-unresolved-hazard`). The new select locates the
   target by `targetInstanceId` from the context.
2. The three "not on chain" and "in play" sub-cases of
   `resolveEnvironmentCancel` both decompose to: cancel-chain-entry
   with fallback to `move` (from cardsInPlay → discard). Express
   them as a `sequence` apply on the card, or leave
   `cancel-chain-entry` handling both cases internally.
3. Migrate the JSON for the handful of environment-cancel short
   events. Delete the branch at line 1256.

**Expected LOC removed: ~50.**

### Phase D — port `on-event: company-arrives-at-site` for short events

**Prereq**: A.

Current branch: chain-reducer.ts:1265 (`applyShortEventArrivalTrigger`).

This branch already reads `effects` and dispatches, but only accepts
`add-constraint` and `sequence`-of-`add-constraint`. Generalize to
the full apply dispatcher — any apply type becomes firable from
`company-arrives-at-site`.

1. Teach `shouldFireOnChainResolution` to return true for
   `on-event: company-arrives-at-site` when the resolving entry is a
   short-event, the phase is M/H, and the active company is moving.
2. Pass the arrival context through via `ChainApplyContext` so
   `when` clauses continue to match.
3. Delete `applyShortEventArrivalTrigger`. Verify with River, Choking
   Shadows, and other arrival-triggered short events.

**Expected LOC removed: ~80.**

### Phase E — port `fetch-to-deck` short events

**Prereq**: A, move plan Phase 6 (fetch-to-deck → move).

Current branch: chain-reducer.ts:1272 (`queueFetchToDecEffects`) +
mate at reducer-events.ts:378.

After move Phase 6, `fetch-to-deck` is a `move` with
`to: 'deck', shuffleAfter: true`. The pending-effects enqueue path
stays (it's a `needsInput: true` flow), but the branch that decides
which card's effects to scan for a queued fetch merges into the
generic loop.

1. Update the move dispatcher to enqueue a pending resolution when
   the move has `to: 'deck'` and is called from the chain context
   (needs user selection). This reuses the existing pending-effect
   machinery.
2. Delete `queueFetchToDecEffects`. The card JSONs already carry
   `move` after Phase 6.

**Expected LOC removed: ~40.**

### Phase F — port faction-target and call-of-home

**Prereq**: A.

Current branches: chain-reducer.ts:1295 (`muster-roll`) and
chain-reducer.ts:1328 (`call-of-home-roll`).

These two branches look at payload shape (`targetFactionInstanceId`)
or at a specific effect (`call-of-home-check`) and enqueue a pending
roll. Their shared pattern is: *produce a pending resolution based on
a card's declared roll effect*.

1. Introduce a generic `enqueue-roll` apply type with parameters:
   - `kind`: `'muster-roll' | 'call-of-home-roll'` (the resolver
     type already registered in `pendingResolutions`).
   - `threshold`, target-locator, actor source — all drawn from
     context + apply payload.
2. Replace `Muster Disperses`'s implicit faction-targeting with an
   explicit `enqueue-roll` effect in its JSON.
3. Replace `call-of-home-check` — already an apply type, just needs
   to be wired through the generic dispatcher.
4. Delete both branches.

**Expected LOC removed: ~70.**

### Phase G — port `resolvePermanentEvent` and `resolveLongEvent`

**Prereq**: A, move plan fully landed.

Current branches: chain-reducer.ts:1360 and :1364.

Both are *bring a card into play in a specific zone*, which is
exactly what the `move` primitive does. A permanent-event resolves
by moving the chain-entry's card:

- To a character's `items` or `hazards` list (for character-
  targeting permanent events), *or*
- To the player's `cardsInPlay` (for general permanent / long
  events).

1. Extend `MoveZone` with `in-play-on-character` and
   `in-play-general` destinations. Teach `pushToZone` about the
   attachedToSite / controlledBy / ward-cancel logic currently
   embedded in `resolvePermanentEvent`.
2. Replace both resolve functions with a generic "move chain card
   to declared destination, then fire self-enters-play effects
   through the shared dispatcher". The self-enters-play branch
   already uses generic dispatch (line 848) — it collapses into the
   same loop.
3. Add a `play-destination` field to the permanent-event and
   long-event card effects so each card declares where it lands.
   Default behaviour (character → items/hazards, otherwise
   cardsInPlay) stays the default when no field is present.

**Expected LOC removed: ~140.**

### Phase H — clean up

1. Delete `resolveEnvironmentCancel`, `applyShortEventArrivalTrigger`,
   `queueFetchToDecEffects`, `resolveCancelAttackEntry` wrapper,
   `resolvePermanentEvent`, `resolveLongEvent` (their call sites
   are gone).
2. Collapse `resolveEntry` to the generic loop described under
   *Target shape*, plus the two payload branches that aren't effect
   dispatch (`creature` → combat, `influence-attempt` → faction
   roll; both stay as-is since they're about *which subsystem* the
   entry opens, not *what effects run*).
3. Update `docs/card-effects-dsl.md` and the
   `2026-03-24-chain-of-effects.md` spec with a "resolution is
   effect-driven" section.

## Estimated impact

- **LOC removed from chain-reducer.ts:** ~400 across the six bespoke
  branches and three helper functions.
- **New shared dispatcher:** ~100 LOC in
  `engine/apply-dispatcher.ts`.
- **Net engine reduction**: ~300 LOC.
- **Combined with move plan**: ~600 LOC net reduction, with the chain
  having exactly two dispatch axes (*payload-type* → which subsystem;
  *effect-type* → which apply) instead of the current six shape-based
  branches.
- **Short events covered**: all 73 event cards flow through the same
  resolver. New event cards are pure JSON — no chain-reducer edits.

## Risks and non-goals

- **The "needsInput: true" path is the tricky one.** Muster-roll,
  call-of-home, faction-influence, and fetch-to-deck all need to
  pause resolution mid-entry. The generic dispatcher must propagate
  `needsInput` correctly and leave the entry unresolved on the
  chain. Mitigation: existing tests for these four flows exercise
  the pause/resume path directly.
- **Self-enters-play effects vs. chain-resolution effects.** The
  permanent-event resolve function already iterates
  `on-event: self-enters-play` through a partial dispatcher.
  Merging with the main loop means `shouldFireOnChainResolution`
  must correctly gate `self-enters-play` for permanent/long events
  and **not** for short events (short events don't "enter play").
  One predicate; tests are the oracle.
- **Ward-cancel for permanent events** (resolvePermanentEvent:765)
  is currently inlined. Lifting it into `pushToZone` for the
  `in-play-on-character` destination is a correctness-sensitive
  move — the card must go to the owner's *discard*, not the
  intended attachment. Add a dedicated test case that exercises
  Adamant Helmet vs. a dark-enchantment permanent event if one
  doesn't already exist.
- **Non-goal: changing declaration order, priority, pass rules, or
  deferred passives.** `pushChainEntry`, `handlePassChainPriority`,
  `detectTriggeredPassives`, `createFollowUpChain`,
  `interruptWithSubChain` all stay as-is.
- **Non-goal: making `creature` and `influence-attempt` payloads
  effect-driven.** Those open combat and faction-influence
  subsystems respectively. They're not "card runs its effects";
  they're "card hands off to another subsystem". Leave the two
  branches at lines 1356 and 1374 alone.
- **Non-goal: reworking the pending-effects queue.** The existing
  queue infrastructure (`pendingResolutions`, `enqueueResolution`)
  handles everything this plan needs. No new shapes.

## Rollback

Each phase is a separate PR. A regressing phase reverts on its own
because each phase only *adds* dispatcher capability and *deletes*
one branch at a time — prior phases stay intact, the bespoke branches
they replaced are already gone, and the cards they migrated continue
to run through the dispatcher. Phase A (shared dispatcher with no
behaviour change) is the safest baseline to revert to.
