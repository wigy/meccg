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

### The Chain as a Card Container

The chain of effects becomes a real container for cards. When a card is
declared (played), it leaves the player's hand and physically resides on
the chain until resolution determines its final destination. This is the
correct model per the glossary definition of "play (a card)": the card
leaves hand "when declared" and enters play "upon resolution."

Currently, short events and creatures are moved to discard at declaration
time as a shortcut. This plan corrects the model for all card types:

| Card type | Declaration | Resolution (success) | Resolution (negated) |
|---|---|---|---|
| Short event | hand → chain | chain → discard | chain → discard |
| Creature | hand → chain | chain → in-play (combat) | chain → discard |
| Permanent event | hand → chain | chain → cardsInPlay | chain → discard |
| Long event | hand → chain | chain → cardsInPlay | chain → discard |

For creatures, "in-play" means the creature exists as an entity during
combat. After combat resolves, it moves to the defeating player's MP pile
(if defeated) or the hazard player's discard pile (if not defeated).

The `ChainEntry` already stores `cardInstanceId` and `definitionId`, which
is all a `CardInstance` needs. So the chain is structurally a container
already — we just need to stop prematurely moving cards to discard at
declaration time, and instead move them to their correct destination on
resolution.

### Phased Rollout

This plan implements the new model for permanent events and long events
(which currently bypass the chain entirely), and replaces Twilight's
hardcoded cancel logic with a proper DSL effect. Short events and creatures
already go through the chain but with the premature-discard shortcut; a
follow-up change can correct those to use the container model too.

### Refactor `ChainEntry` to Hold the Card

Replace the separate `cardInstanceId` and `definitionId` fields with a
single `card` field in `types/state.ts`:

```typescript
export interface ChainEntry {
  readonly index: number;
  readonly declaredBy: PlayerId;
  readonly card: CardInstance | null;  // null for non-card entries (passive conditions)
  readonly payload: ChainEntryPayload;
  readonly resolved: boolean;
  readonly negated: boolean;
}
```

The chain entry literally holds the card — it's moved in at declaration and
extracted at resolution. All existing references to `entry.card`
and `entry.card?.definitionId` become `entry.card?.instanceId` and
`entry.card?.definitionId`.

### New Chain Entry Payloads

Add to `ChainEntryPayload` in `types/state.ts`:

```typescript
| { readonly type: 'permanent-event' }
| { readonly type: 'long-event' }
```

## Implementation Steps

### Step 1: Refactor `ChainEntry` and Add Payload Types

**File**: `packages/shared/src/types/state.ts`

1. Replace `cardInstanceId` and `definitionId` with `card: CardInstance | null`
   on `ChainEntry`.
2. Add `| { readonly type: 'permanent-event' }` and
   `| { readonly type: 'long-event' }` to `ChainEntryPayload`.
3. Update `initiateChain()` and `pushChainEntry()` signatures in
   `chain-reducer.ts` to accept `card: CardInstance | null` instead of
   separate `cardInstanceId` and `definitionId` parameters.
4. Update all call sites and all code that reads `entry.cardInstanceId` /
   `entry.definitionId` to use `entry.card?.instanceId` /
   `entry.card?.definitionId`.
5. Update `resolveInstanceId()` and any card-lookup functions to also
   search the chain entries — cards on the chain are not in any pile, so
   lookups that scan hand/discard/cardsInPlay will miss them (see Step 9).

### Step 2: Modify `handlePlayPermanentEvent` (Resource Permanent Events)

**File**: `packages/shared/src/engine/reducer.ts`

Current behavior: hand → `cardsInPlay` immediately.

New behavior:

1. Validate the card (type checks, duplication-limit — same as now).
2. Remove card from hand (card is now "on the chain" — not in any pile).
3. Initiate or push onto chain with payload `{ type: 'permanent-event' }`.
4. Do **not** add to `cardsInPlay` yet.
5. Do **not** execute `self-enters-play` effects yet.

### Step 3: Modify `handlePlayLongEvent` (Resource Long Events)

**File**: `packages/shared/src/engine/reducer.ts`

Current behavior: hand → `cardsInPlay` immediately.

New behavior:

1. Validate the card (type checks, uniqueness, duplication-limit — same).
2. Remove card from hand.
3. Initiate or push onto chain with payload `{ type: 'long-event' }`.
4. Do **not** add to `cardsInPlay` yet.

### Step 4: Modify Hazard Long/Permanent Event Handling in M/H Phase

**File**: `packages/shared/src/engine/reducer.ts` (in `handlePlayHazardCard`)

Current behavior (lines 3095–3162): hand → `cardsInPlay` immediately,
`self-enters-play` effects execute immediately.

New behavior for permanent events:

1. Validate the card (type checks, uniqueness, duplication-limit — same).
2. Remove card from hand.
3. Increment `hazardsPlayedThisCompany`.
4. Initiate or push onto chain with payload `{ type: 'permanent-event' }`.
5. Do **not** add to `cardsInPlay` or execute effects yet.

New behavior for long events:

1. Same validation.
2. Remove card from hand.
3. Increment `hazardsPlayedThisCompany`.
4. Initiate or push onto chain with payload `{ type: 'long-event' }`.
5. Do **not** add to `cardsInPlay` yet.

### Step 5: Add Resolution Logic in `chain-reducer.ts`

**File**: `packages/shared/src/engine/chain-reducer.ts`

In `resolveEntry()`, add cases for both payload types:

```typescript
if (entry.payload.type === 'permanent-event' && !entry.negated && entry.card) {
  current = resolvePermanentEvent(current, entry);
}

if (entry.payload.type === 'long-event' && !entry.negated && entry.card) {
  current = resolveLongEvent(current, entry);
}
```

`resolvePermanentEvent()` does:

1. Take `entry.card` and add it to the declaring player's `cardsInPlay`
   (untapped).
2. Execute `self-enters-play` effects (the `discard-cards-in-play` logic
   currently in `handlePlayPermanentEvent` and `handlePlayHazardCard`).
3. Run any other DSL effect resolution needed.

`resolveLongEvent()` does:

1. Take `entry.card` and add it to the declaring player's `cardsInPlay`
   (untapped).
2. Execute any DSL effects if applicable.

If either entry is negated, the card goes to the declaring player's discard
pile (rule 9.5.5). This must be handled explicitly since the card is not in
any pile during the chain window.

### Step 5b: Handle Negated Entries in `completeChain`

When the chain completes, any negated entries whose cards are still "on the
chain" (not yet moved anywhere) must be flushed to their declaring player's
discard pile. Add a sweep in `completeChain()` that checks all entries: if
`negated && entry.card != null`, move the card to the declaring player's
discard.

This also prepares for the follow-up change where short events and
creatures use the same container model.

### Step 6: Give Twilight a Proper DSL Effect and Remove Hardcoded Logic

Twilight's cancel logic is currently hardcoded as `resolveEnvironmentCancel`
in `chain-reducer.ts` (line 323). This function has three branches: cancel
a chain entry (negate it), cancel a card in `eventsInPlay`, cancel a card
in `cardsInPlay`. Meanwhile, Twilight's card data has no DSL effect for the
cancel — only play-restrictions (`playable-as-resource`, `no-hazard-limit`).

This must be fixed as part of this plan because:

- The hardcoded function references `entry.cardInstanceId` (old field).
- It needs to understand the chain-as-container model.
- DoN/GoM use the general DSL (`on-event: self-enters-play`), but Twilight
  doesn't — this inconsistency means chain resolution has two paths for
  environment interactions instead of one.

**Step 6a: Add DSL effect to Twilight's card data**

Add a `cancel-environment` effect type to the DSL and to Twilight's JSON:

```json
{
  "type": "cancel-environment",
  "target": "chain-or-in-play"
}
```

The target is chosen at play time via the `targetInstanceId` on the action.
Document the new effect type in `docs/card-effects-dsl.md`.

**Step 6b: Implement `cancel-environment` in chain resolution**

In `resolveEntry()` for `short-event` entries, resolve the DSL effect
instead of calling the hardcoded `resolveEnvironmentCancel`. The resolver:

1. Look up the target by `instanceId` — check chain entries first, then
   `cardsInPlay`, then `eventsInPlay`.
2. If target is a chain entry: negate it (card will be flushed to discard
   by `completeChain`).
3. If target is in `cardsInPlay` or `eventsInPlay`: remove and discard.
4. If target is already gone: fizzle (no-op).

**Step 6c: Remove `resolveEnvironmentCancel`**

Delete the hardcoded function. The chain resolver now uses the general DSL
path for all short-event resolution.

**Step 6d: Update chain legal actions for Twilight targeting**

**File**: `packages/shared/src/engine/legal-actions/chain.ts`

The `playShortEventChainActions` function currently has Twilight-specific
logic scanning for environment keywords. Refactor to read Twilight's DSL
effects instead of hardcoding the `playable-as-resource` check. The
function should:

1. Check if any hand card has a `cancel-environment` effect.
2. If so, collect valid targets: environment cards in `cardsInPlay`,
   `eventsInPlay`, and unresolved chain entries with the environment keyword.
3. Emit one legal action per target.

This naturally picks up permanent-event and long-event entries on the chain.

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

### Step 9: Update Card Instance Lookups to Search the Chain

**File**: `packages/shared/src/types/state.ts`

`resolveInstanceId()` (line 1314) searches all piles, characters, items,
allies, cardsInPlay, and eventsInPlay — but not the chain. Cards that are
"on the chain" would be invisible to any code using this function.

Add a chain search after the existing scans:

```typescript
// Cards on the chain of effects
if (state.chain) {
  for (const entry of state.chain.entries) {
    if (entry.card?.instanceId === instanceId) return entry.card.definitionId;
  }
}
```

Audit other card-finding functions for the same gap. The chain legal actions
code in `chain.ts` already scans chain entries directly (for Twilight
targeting), but any generic "find a card by instance ID" utility needs to
know about the chain as a card location.

### Step 10: Handle the "Self-Enters-Play Discards" Interaction

The key interaction to get right:

1. P1 plays Gates of Morning → enters chain (card on the chain, not in any pile).
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
4. Gates of Morning is negated → goes to discard. Doors of Night survives.

## Test Changes

All test changes go through a PR per project policy.

### Tests to Update: `tw-243.test.ts` (Gates of Morning)

All existing tests need updating because the single-action play pattern
changes to a multi-step chain pattern:

1. **"can be played as a permanent event during organization"**: After
   `play-permanent-event`, card should be gone from hand (not in
   `cardsInPlay` yet, not in discard — it's on the chain) and chain
   should be active. Both players pass → card moves to `cardsInPlay`.

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

1. **"opponent can cancel Gates of Morning with Twilight before it
   resolves"**: P1 plays Gates of Morning (Doors of Night in play). P2
   responds with Twilight targeting Gates of Morning on the chain. Chain
   resolves: Twilight negates GoM → GoM goes to discard, DoN survives.

2. **"Gates of Morning on chain is a valid Twilight target"**: After P1
   declares GoM, verify Twilight appears in P2's legal actions targeting
   the GoM chain entry.

### Tests to Update: `tw-106.test.ts` (Twilight)

Most Twilight tests target environments already in `cardsInPlay`, which
still works. Key interactions to verify/add:

1. **"Twilight can target a permanent event on the chain"**: New test.
   Doors of Night declared on chain → P1 responds with Twilight targeting
   the DoN chain entry → resolves → DoN negated.

2. **"Twilight targeting permanent event on chain vs in play"**: Verify
    that Twilight's legal actions include both environments in play AND
    permanent-event entries on the chain.

### New Test File: `tw-28.test.ts` (Doors of Night)

Currently no dedicated test file exists. Create one covering:

1. **"can be played as hazard permanent event during M/H"**: Basic play →
    chain → resolve → enters play.

2. **"discards Gates of Morning when played"**: DoN resolves → enters
    play → discards resource environments.

3. **"opponent can cancel Doors of Night with Twilight"**: P2 plays DoN,
    P1 responds with Twilight targeting DoN on chain → negated.

4. **"cannot be duplicated"**: duplication-limit check at declaration.

### Tests to Update: `tw-335.test.ts` (Sun, Resource Long Event)

All 4 existing tests assume `play-long-event` immediately puts Sun into
`cardsInPlay` and applies stat effects. They need the chain pass pattern:

1. **"Dúnadan prowess +1 when Sun is in play"**: After `play-long-event`,
    Sun is on the chain. Both players pass → Sun enters `cardsInPlay` →
    `recomputeDerived` applies stat modifiers.

2. **"with Gates of Morning: Man and Dúnadan prowess +1 additional"**:
    Same chain pattern before checking stat modifiers.

3. **"affects opponent characters too"**: Uses a pre-placed Sun in
    `cardsInPlay` — no change needed (tests ongoing effects, not play).

4. **"body and direct influence are not modified"**: Same chain pattern.

### New Long-Event Tests (in `tw-335.test.ts` or new file)

1. **"resource long event goes through chain during long-event phase"**:
    Play Sun → chain starts → both pass → Sun enters `cardsInPlay`.

2. **"hazard long event goes through chain during M/H"**: Play Eye of
    Sauron → chain starts → both pass → enters `cardsInPlay`.

3. **"Twilight can cancel a long event on the chain"**: P2 plays Eye of
    Sauron → P1 responds with Twilight targeting it → chain resolves →
    Eye of Sauron negated, goes to discard.

4. **"long event negated on chain goes to discard"**: Verify that a
    negated long event is properly discarded (rule 9.5.5) and does not
    enter play.

### New Rules Test: `rule-4.02-play-resource-long-events.test.ts`

Currently a `test.todo()` stub. Implement with:

1. **"resource long event goes through chain before entering play"**:
    Play a resource long event → chain starts → both pass → card enters
    `cardsInPlay`.

2. **"resource long event can be canceled on the chain"**: Play a
    resource long event → opponent responds → event negated → goes to
    discard, never enters play.

### Cross-Card Interaction Tests

All rules tests (`rule-9.09`, `rule-9.12`, `rule-9.13`, `rule-10.29`) are
`test.todo()` stubs — no suitable home there. Embed these in the card test
files where the participating cards are tested:

1. **`tw-28.test.ts` (Doors of Night)**: "P1 responds with Twilight to
    cancel Doors of Night before it discards Gates of Morning" — P1 has
    GoM in play. P2 plays DoN during M/H → chain starts. P1 responds
    with Twilight targeting DoN → chain resolves LIFO: Twilight negates
    DoN, GoM survives.

2. **`tw-243.test.ts` (Gates of Morning)**: "P2 responds with Twilight
    to cancel Gates of Morning before it discards Doors of Night" —
    mirror of test 24 from GoM's perspective.

3. **`tw-106.test.ts` (Twilight)**: "targets environment long event on
    chain alongside permanent event in play" — both an environment long
    event (e.g. Eye of Sauron) on the chain and a permanent event in
    play exist — Twilight's legal actions should include both as targets.

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

## Follow-Up: Short Events and Creatures

Short events and creatures currently use a premature-discard shortcut:
cards go to discard at declaration time instead of residing on the chain.
A follow-up change should correct these to use the same container model:

- **Short events**: Stop moving to discard in `handlePlayShortEvent`.
  In `resolveEntry` for `short-event`, move from chain → discard after
  applying the effect.
- **Creatures**: Stop moving to discard in creature declaration. In
  `resolveEntry` for `creature`, move from chain → in-play when combat
  initiates. The creature exists in play during combat. After combat
  resolves, move to the defeating player's MP pile (if defeated) or the
  hazard player's discard pile (if not defeated).

This is lower priority since the shortcut produces correct end-state for
short events, but the container model is architecturally cleaner and
prevents potential issues with "when discarded" passive conditions firing
at the wrong time. For creatures, getting the in-play state right matters
more — it affects interactions with cards that reference creatures in play
during combat.
