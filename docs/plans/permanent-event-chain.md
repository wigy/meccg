# Permanent and Long Events Through the Chain of Effects

## Problem

Permanent events and long events (both resource and hazard) currently
bypass the chain of effects entirely. When played, the card moves directly
from hand to `cardsInPlay` in a single reducer step, with no response
window for the opponent. This violates core CoE rules:

- **Glossary "play (a card)"**: *"An action that moves a card from a
  player's hand (when declared) into play (upon resolution)."*
- **Rule 9.3.2**: *"A played card cannot be targeted until it has resolved"*
  — implies a window between declaration and resolution.
- **Rule 9.5.5**: *"If a card is negated between the declaration of being
  played and resolving, it is immediately discarded."*

### Concrete Gameplay Impact

Without the chain, opponents cannot respond to permanent or long events
being played. For example:

- **Gates of Morning** (resource permanent, environment): When P1 plays
  this during organization, P2 should be able to respond with Twilight to
  cancel it before it resolves and discards P2's Doors of Night.
- **Doors of Night** (hazard permanent, environment): When P2 plays this
  during M/H, P1 should be able to respond with Twilight to cancel it
  before it resolves and discards P1's Gates of Morning.
- **Eye of Sauron** (hazard long, environment): When played during M/H,
  resource player should get a response window.
- **Sun** (resource long, environment): When played during the long-event
  phase, hazard player should get a response window.
- Any permanent or long event should be cancelable between declaration and
  resolution per rule 9.5.5.

## Design

### Card Lifecycle Through the Chain

1. **Declaration**: Card leaves hand, goes to discard pile (same pattern as
   short events and creatures). A chain entry with payload type
   `'permanent-event'` is pushed onto the chain.
2. **Response window**: Opponent gets priority. Can respond with Twilight or
   other chain-eligible actions. Player can also respond.
3. **Resolution**: If not negated, card moves from discard to `cardsInPlay`
   and its `self-enters-play` effects execute. If negated (rule 9.5.5),
   card stays in discard.

Why discard as the intermediate location (not a new "limbo" zone): this
matches the existing pattern for short events and creatures, keeps the state
model simple, and is correct per the rules — a negated card ends up
discarded, which is where it already is.

### New Chain Entry Payloads

Add to `ChainEntryPayload` in `types/state.ts`:

```typescript
| { readonly type: 'permanent-event' }
| { readonly type: 'long-event' }
```

No extra fields needed — the `ChainEntry` already has `declaredBy`,
`cardInstanceId`, and `definitionId`.

## Implementation Steps

### Step 1: Add New Payload Types

**File**: `packages/shared/src/types/state.ts`

Add `| { readonly type: 'permanent-event' }` and
`| { readonly type: 'long-event' }` to `ChainEntryPayload`.

### Step 2: Modify `handlePlayPermanentEvent` (Resource Permanent Events)

**File**: `packages/shared/src/engine/reducer.ts`

Current behavior: hand → `cardsInPlay` immediately.

New behavior:
1. Validate the card (type checks, duplication-limit — same as now).
2. Move card from hand → discard pile.
3. Initiate or push onto chain with payload `{ type: 'permanent-event' }`.
4. Do **not** add to `cardsInPlay` yet.
5. Do **not** execute `self-enters-play` effects yet.

### Step 3: Modify `handlePlayLongEvent` (Resource Long Events)

**File**: `packages/shared/src/engine/reducer.ts`

Current behavior: hand → `cardsInPlay` immediately.

New behavior:
1. Validate the card (type checks, uniqueness, duplication-limit — same).
2. Move card from hand → discard pile.
3. Initiate or push onto chain with payload `{ type: 'long-event' }`.
4. Do **not** add to `cardsInPlay` yet.

### Step 4: Modify Hazard Long/Permanent Event Handling in M/H Phase

**File**: `packages/shared/src/engine/reducer.ts` (in `handlePlayHazardCard`)

Current behavior (lines 3095–3162): hand → `cardsInPlay` immediately,
`self-enters-play` effects execute immediately.

New behavior for permanent events:
1. Validate the card (type checks, uniqueness, duplication-limit — same).
2. Move card from hand → discard pile.
3. Increment `hazardsPlayedThisCompany`.
4. Initiate or push onto chain with payload `{ type: 'permanent-event' }`.
5. Do **not** add to `cardsInPlay` or execute effects yet.

New behavior for long events:
1. Same validation.
2. Move card from hand → discard pile.
3. Increment `hazardsPlayedThisCompany`.
4. Initiate or push onto chain with payload `{ type: 'long-event' }`.
5. Do **not** add to `cardsInPlay` yet.

### Step 5: Add Resolution Logic in `chain-reducer.ts`

**File**: `packages/shared/src/engine/chain-reducer.ts`

In `resolveEntry()`, add cases for both payload types:

```typescript
if (entry.payload.type === 'permanent-event'
    && !entry.negated
    && entry.cardInstanceId
    && entry.definitionId) {
  current = resolvePermanentEvent(current, entry);
}

if (entry.payload.type === 'long-event'
    && !entry.negated
    && entry.cardInstanceId
    && entry.definitionId) {
  current = resolveLongEvent(current, entry);
}
```

`resolvePermanentEvent()` does:
1. Find the card in the declaring player's discard pile.
2. Move it from discard → `cardsInPlay` (untapped).
3. Execute `self-enters-play` effects (the `discard-cards-in-play` logic
   currently in `handlePlayPermanentEvent` and `handlePlayHazardCard`).
4. Run any other DSL effect resolution needed.

`resolveLongEvent()` does:
1. Find the card in the declaring player's discard pile.
2. Move it from discard → `cardsInPlay` (untapped).
3. Execute any DSL effects if applicable.

If either entry is negated, the card stays in discard (rule 9.5.5) — no
special handling needed since it's already there.

### Step 6: Update Chain Legal Actions for Twilight Targeting

**File**: `packages/shared/src/engine/legal-actions/chain.ts`

The `playShortEventChainActions` function already scans unresolved chain
entries for environment keywords (lines 89–97). This will automatically
pick up `permanent-event` and `long-event` entries on the chain, since it
checks `isEnv()` against the entry's `definitionId`. **No change needed
here** — Twilight will naturally be able to target a Doors of Night, Gates
of Morning, Eye of Sauron, or Sun that's on the chain but hasn't resolved.

However, verify that the `resolveEnvironmentCancel` function in
`chain-reducer.ts` handles canceling a chain entry (negating it) vs.
canceling a card in `cardsInPlay`. Currently it handles both — confirm
this still works when permanent events are on the chain instead of in play.

### Step 7: Update Legal Actions for Events Outside Chain

**Files**: `packages/shared/src/engine/legal-actions/organization.ts`,
`packages/shared/src/engine/legal-actions/site.ts`,
`packages/shared/src/engine/legal-actions/movement-hazard.ts`

These currently offer `play-permanent-event`, `play-long-event`, and
`play-hazard` (for hazard long/permanent events) as legal actions. They
should **not** offer these actions while a chain is active (the chain legal
actions module handles responses). Verify that the existing early-return in
`computeLegalActions` when `state.chain` is non-null already prevents this.

Also add `packages/shared/src/engine/legal-actions/long-event.ts` to this
check — resource long events played during the long-event phase need the
same treatment.

### Step 8: Handle the "Self-Enters-Play Discards" Interaction

The key interaction to get right:

1. P1 plays Gates of Morning → enters chain (card in P1's discard).
2. P2 has Doors of Night in play.
3. P2 passes (or responds with something).
4. P1 passes → chain resolves.
5. Gates of Morning resolves: moves to `cardsInPlay`, then its
   `self-enters-play` effect discards all hazard environments → Doors of
   Night discarded.

Counter-scenario:

1. P1 plays Gates of Morning → enters chain.
2. P2 responds with Twilight targeting Gates of Morning on the chain.
3. Chain resolves LIFO: Twilight resolves first → negates Gates of Morning
   entry.
4. Gates of Morning is negated → stays in discard. Doors of Night survives.

## Test Changes

All test changes go through a PR per project policy.

### Tests to Update: `tw-243.test.ts` (Gates of Morning)

All existing tests need updating because the single-action play pattern
changes to a multi-step chain pattern:

1. **"can be played as a permanent event during organization"**: After
   `play-permanent-event`, card should be in discard (not `cardsInPlay`
   yet) and chain should be active. Both players pass → card moves to
   `cardsInPlay`.

2. **"discards Doors of Night when played"**: After `play-permanent-event`,
   Doors of Night should still be in play (not discarded yet). Both players
   pass → Gates of Morning resolves, enters play, then its effect discards
   Doors of Night.

3. **"discards own hazard environment cards when played"**: Same pattern —
   discard happens on resolution, not declaration.

4. **"does not discard own resource environment cards"**: The
   duplication-limit check still prevents play. No change needed.

5. **"cannot be duplicated"** tests: These check the duplication-limit
   validation which happens at declaration time (before chain). Should
   still work, but verify — the check should look at `cardsInPlay`, not
   chain entries.

6. **"no opposing environments to discard"**: After chain resolution, card
   is in `cardsInPlay` with no discards. Needs chain pass steps.

### New Tests: `tw-243.test.ts`

7. **"opponent can cancel Gates of Morning with Twilight before it
   resolves"**: P1 plays Gates of Morning (Doors of Night in play). P2
   responds with Twilight targeting Gates of Morning on the chain. Chain
   resolves: Twilight negates GoM → GoM stays in discard, DoN survives.

8. **"Gates of Morning on chain is a valid Twilight target"**: After P1
   declares GoM, verify Twilight appears in P2's legal actions targeting
   the GoM chain entry.

### Tests to Update: `tw-106.test.ts` (Twilight)

Most Twilight tests target environments already in `cardsInPlay`, which
still works. Key interactions to verify/add:

9. **"Twilight can target a permanent event on the chain"**: New test.
   Doors of Night declared on chain → P1 responds with Twilight targeting
   the DoN chain entry → resolves → DoN negated.

10. **"Twilight targeting permanent event on chain vs in play"**: Verify
    that Twilight's legal actions include both environments in play AND
    permanent-event entries on the chain.

### New Test File: `tw-28.test.ts` (Doors of Night)

Currently no dedicated test file exists. Create one covering:

11. **"can be played as hazard permanent event during M/H"**: Basic play →
    chain → resolve → enters play.

12. **"discards Gates of Morning when played"**: DoN resolves → enters
    play → discards resource environments.

13. **"opponent can cancel Doors of Night with Twilight"**: P2 plays DoN,
    P1 responds with Twilight targeting DoN on chain → negated.

14. **"cannot be duplicated"**: duplication-limit check at declaration.

### Tests to Update: Long-Event Phase Rules Tests

Existing tests in `packages/shared/src/tests/rules/04-long-event-phase/`
need updating:

16. **`rule-4.02-play-resource-long-events.test.ts`**: After
    `play-long-event`, card should be in discard (not `cardsInPlay` yet)
    and chain should be active. Both players pass → card moves to
    `cardsInPlay`.

17. **`rule-5.22-playing-event-hazard.test.ts`**: If hazard long events
    are tested here, same pattern — goes through chain before entering
    play.

### Tests to Update: Long-Event Card Tests

18. **`tw-335.test.ts`** (Sun, resource long event, environment): Verify
    that playing Sun goes through the chain. Twilight should be able to
    cancel Sun on the chain before it resolves.

### New Long-Event Tests

19. **"resource long event goes through chain during long-event phase"**:
    Play Sun → chain starts → both pass → Sun enters `cardsInPlay`.

20. **"hazard long event goes through chain during M/H"**: Play Eye of
    Sauron → chain starts → both pass → enters `cardsInPlay`.

21. **"Twilight can cancel a long event on the chain"**: P2 plays Eye of
    Sauron → P1 responds with Twilight targeting it → chain resolves →
    Eye of Sauron negated, stays in discard.

22. **"long event negated on chain stays in discard"**: Verify that a
    negated long event is properly discarded (rule 9.5.5) and does not
    enter play.

### Cross-Card Interaction Tests

23. **"Gates of Morning and Doors of Night chain interaction"**: P1 has
    GoM in play. P2 plays DoN during M/H → chain starts. P1 responds
    with Twilight targeting DoN → chain resolves LIFO: Twilight negates
    DoN, GoM survives.

24. **"Twilight targets environment long event on chain alongside
    permanent event in play"**: Both an environment long event on the
    chain and a permanent event in play exist — Twilight's legal actions
    should include both as targets.

## Migration Notes

- The `play-permanent-event` and `play-long-event` action types stay the
  same — they just now initiate/push a chain instead of immediately
  resolving.
- Saved games with events already in `cardsInPlay` are unaffected — this
  only changes the transition path.
- Client UI: after playing a permanent or long event, the client will see
  a chain become active and needs to handle `pass-chain-priority` — this
  should already work since the chain UI exists for Twilight/creature
  chains.
- The long-event phase's entry/exit housekeeping (discarding resource long
  events at start, hazard long events at end) is unaffected — that logic
  operates on `cardsInPlay` after events have already resolved through
  chains on previous turns.
