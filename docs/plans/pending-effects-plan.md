# Pending Effects — Implementation Plan

## Background

Six places in the engine already implement variants of "the player must
resolve X (or has option Y available) before continuing." Each was
hand-rolled into per-phase state with its own legal-action short-circuit
and its own drain logic. Closed PR 52 (Lure of the Senses) would have
added a seventh.

The pattern is general: cards in any phase can produce *deferred work*
or *modal restrictions* that the engine must honour for some scope.
This plan replaces the six ad-hoc fields with a single, unified system
in one big-bang refactor, and certifies three new cards on top of it
(River, Lost in Free-domains, Lure of the Senses).

### Existing ad-hoc patterns (to be migrated)

| # | Field | File | Phase | Source | Compulsory? |
|---|---|---|---|---|---|
| 1 | `pendingCorruptionCheck` | `state-phases.ts:206` | Org | item transfer | yes |
| 2 | `pendingWoundCorruptionChecks` (MH) | `state-phases.ts:425` | MH | wound by `character-wounded-by-self` | yes |
| 3 | `pendingWoundCorruptionChecks` (Site) | `state-phases.ts:560` | Site | wound by `character-wounded-by-self` | yes |
| 4 | `pendingEffectsToOrder` | `state-phases.ts:340` | MH (order-effects) | step transition | yes |
| 5 | `awaitingOnGuardReveal` + `pendingResourceAction` | `state-phases.ts:541, 547` | Site | resource declared | no (window) |
| 6 | `pendingOpponentInfluence` | `state-phases.ts:571` | Site | influence attempt | yes |

Affected files (by usage count): `reducer-site.ts` (26),
`test-helpers.ts` (15), `reducer-movement-hazard.ts` (11),
`reducer-organization.ts` (6), `state-phases.ts` (7),
`legal-actions/site.ts` (6), 9 card tests, 1 rule test.
About 25 source files in total.

## Two distinct shapes

The mechanism is *not* a single concept. There are two shapes that share
nothing useful at the type level and should not be conflated:

### Shape A — Pending resolution queue

The engine has queued *a thing that must (or may) happen next*. While
the queue is non-empty for the relevant actor, legal actions collapse to
"resolve the top item." Drains FIFO. Examples:

- Lure-triggered corruption check at end of untap phase (compulsory)
- Wound corruption check from Barrow-wight (compulsory)
- Transfer corruption check (compulsory)
- order-effects step in MH (compulsory)
- opponent influence defence roll (compulsory)
- on-guard reveal window (voluntary; `pass` resolves it and runs the
  deferred resource action)

"Voluntary" Shape A entries simply offer `pass` as one of the
resolutions; passing dequeues and may auto-execute a piggybacked action.

### Shape B — Active constraint

The engine has attached *a restriction* to a context (company,
character, or player) for some scope. It does not need to be resolved.
It filters the legal-action menu while it lives, and auto-clears at a
boundary. Examples:

- **Lost in Free-domains** — "this company may do nothing during its
  site phase." Clears at end of site phase.
- **River** — "a company moving to this site this turn must do nothing
  during its site phase. A ranger may tap to cancel the effect."
  This is a constraint with an *optional cancellation action*.
- (Future) "you may not play hazards on this company this M/H phase",
  "this character may not move this turn", etc.

Shape B entries never appear as "you owe the engine X". They appear as
"your normal options are missing or modified until <boundary>."

## Type design

### Shape A — `PendingResolution`

```ts
/** Where this resolution lives. Cleared automatically when the scope ends. */
export type ResolutionScope =
  | { kind: 'phase'; phase: Phase }
  | { kind: 'phase-step'; phase: Phase; step: string }
  | { kind: 'company-mh-subphase'; companyId: CompanyId }
  | { kind: 'company-site-subphase'; companyId: CompanyId };

export type ResolutionId = string & { readonly __brand: 'ResolutionId' };

/**
 * A discrete piece of work the engine has queued for a player.
 * Discriminated by `kind.type`. While any resolution exists for the
 * current actor in the current scope, only resolution actions are legal.
 */
export interface PendingResolution {
  readonly id: ResolutionId;
  /** The card instance whose effect produced this resolution (for logs/UI). */
  readonly source: CardInstanceId | null;
  /** Player who must resolve this entry. */
  readonly actor: PlayerId;
  /** Auto-clear boundary. */
  readonly scope: ResolutionScope;
  /** Discriminated payload. */
  readonly kind:
    | {
        readonly type: 'corruption-check';
        readonly characterId: CardInstanceId;
        readonly modifier: number;
        readonly reason: string;            // shown in UI: "Lure", "Barrow-wight", "Transfer", etc.
        readonly possessions: readonly CardInstanceId[];
      }
    | {
        readonly type: 'order-effects';
        readonly effectIds: readonly CardInstanceId[];
      }
    | {
        readonly type: 'on-guard-window';
        readonly deferredAction: GameAction; // executed if hazard player passes
      }
    | {
        readonly type: 'opponent-influence-defend';
        readonly attempt: OpponentInfluenceAttempt; // (extracted struct)
      };
}
```

`PendingResolution.kind` is the *only* place new resolution types are
added. There is no per-phase plumbing.

### Shape B — `ActiveConstraint`

```ts
/** Where the constraint lives. Cleared automatically when the scope ends. */
export type ConstraintScope =
  | { kind: 'turn' }
  | { kind: 'phase'; phase: Phase }
  | { kind: 'company-site-phase'; companyId: CompanyId }
  | { kind: 'company-mh-phase'; companyId: CompanyId }
  | { kind: 'until-cleared' };  // cleared explicitly by another effect

export type ConstraintId = string & { readonly __brand: 'ConstraintId' };

/**
 * A scoped restriction on the legal actions available to some target.
 * Filters the legal-action menu; never blocks resolution.
 */
export interface ActiveConstraint {
  readonly id: ConstraintId;
  /** Card instance that placed this constraint (for logs/UI/cancellation). */
  readonly source: CardInstanceId;
  readonly scope: ConstraintScope;
  /** What the constraint applies to. */
  readonly target:
    | { readonly kind: 'company'; readonly companyId: CompanyId }
    | { readonly kind: 'character'; readonly characterId: CardInstanceId }
    | { readonly kind: 'player'; readonly playerId: PlayerId };
  /** Discriminated payload. */
  readonly kind:
    | {
        // Lost in Free-domains: company may do nothing during its site phase.
        readonly type: 'site-phase-do-nothing';
      }
    | {
        // River: company may do nothing during its site phase, but a
        // ranger in the company may tap to cancel.
        readonly type: 'site-phase-do-nothing-unless-ranger-taps';
      };
}
```

`ActiveConstraint.kind` is the only place new constraint types are
added.

### State changes

Both lists live at the **top** of `GameState`, not in phase state:

```ts
interface GameState {
  // ...
  readonly pendingResolutions: readonly PendingResolution[];
  readonly activeConstraints: readonly ActiveConstraint[];
}
```

All seven existing pending fields are deleted from their phase-state
interfaces. Phase state goes back to representing only the
phase/step *progress*; everything cross-cutting moves to the top-level
lists.

## Helper API

A single module — `packages/shared/src/engine/pending.ts` — owns all
queue and constraint manipulation. Reducers and on-event triggers must
go through it; nothing else may touch the lists directly.

```ts
// pending.ts
export function enqueueResolution(state: GameState, r: Omit<PendingResolution, 'id'>): GameState;
export function dequeueResolution(state: GameState, id: ResolutionId): GameState;
export function topResolutionFor(state: GameState, actor: PlayerId): PendingResolution | null;
export function pendingResolutionsFor(state: GameState, actor: PlayerId): readonly PendingResolution[];

export function addConstraint(state: GameState, c: Omit<ActiveConstraint, 'id'>): GameState;
export function removeConstraint(state: GameState, id: ConstraintId): GameState;
export function constraintsOnCompany(state: GameState, companyId: CompanyId): readonly ActiveConstraint[];
export function constraintsOnCharacter(state: GameState, characterId: CardInstanceId): readonly ActiveConstraint[];

/**
 * Sweep both lists and drop entries whose scope has expired.
 * Called at every phase / step / sub-phase boundary.
 */
export function sweepExpired(state: GameState, boundary: ScopeBoundary): GameState;
```

`ScopeBoundary` is a discriminated union mirroring the scope shapes —
e.g. `{ kind: 'phase-end'; phase: Phase.Site }`,
`{ kind: 'company-site-end'; companyId }`, `{ kind: 'turn-end' }`.

ID generation uses the existing mint helper from `reducer-utils.ts`.

## Legal-action integration

```ts
// legal-actions/index.ts (sketch)
export function computeLegalActions(state: GameState, playerId: PlayerId): readonly EvaluatedAction[] {
  // 1. Pending resolution short-circuit (Shape A)
  const top = topResolutionFor(state, playerId);
  if (top) return resolutionLegalActions(state, playerId, top);

  // 2. Normal phase computation
  const base = phaseLegalActions(state, playerId);

  // 3. Constraint filter (Shape B)
  return applyConstraints(state, playerId, base);
}
```

### Resolution legal-actions

`resolutionLegalActions` is a single dispatch on `top.kind.type`. It
replaces six bespoke short-circuits in
`legal-actions/{organization,site,movement-hazard,untap}.ts`.

```ts
function resolutionLegalActions(state, actor, r): EvaluatedAction[] {
  switch (r.kind.type) {
    case 'corruption-check':         return corruptionCheckActions(state, actor, r);
    case 'order-effects':            return orderEffectsActions(state, actor, r);
    case 'on-guard-window':          return onGuardWindowActions(state, actor, r);
    case 'opponent-influence-defend':return defendActions(state, actor, r);
  }
}
```

### Constraint filter

`applyConstraints` walks `state.activeConstraints`, finds those whose
`target` is in scope for `playerId`, and rewrites the action list.
For the two new constraint kinds:

- `site-phase-do-nothing` — during the *enter-or-skip* step of the
  affected company, drop every legal action except `do-nothing`.
- `site-phase-do-nothing-unless-ranger-taps` — same as above, **plus**
  add a `tap-ranger-to-cancel-river` action for each untapped ranger
  in the company. Resolving that action removes the constraint and
  returns the company to the normal `enter-or-skip` menu.

## Reducer integration

A single dispatch in `reducer.ts` handles resolution actions before
delegating to phase reducers:

```ts
export function reduce(state, action): ReducerResult {
  const top = topResolutionFor(state, action.player);
  if (top) {
    const result = applyResolution(state, action, top);   // dispatch on top.kind.type
    if (result.error) return result;
    // dequeueResolution already happened inside applyResolution
    return result;
  }
  return phaseReduce(state, action);
}
```

`applyResolution` lives in `engine/pending-reducers.ts` and contains
the corruption-check, order-effects, on-guard-window, and
opponent-influence-defend handlers — extracted from the four current
reducer files. The corruption-check handler is shared by Lure, wound,
and transfer cases (which used to be three nearly-identical copies).

### Sweep on boundaries

Each phase reducer calls `sweepExpired(state, boundary)` exactly when
it transitions out of that phase or sub-phase:

- `enterUntapPhase` → sweep `phase-end: Untap` (clears any leftovers)
- `advanceToOrganization` → sweep `phase-end: Untap`
- end of company's site sub-phase → sweep `company-site-end: companyId`
- end of turn → sweep `turn-end`

This is the *only* mechanism that clears Shape B entries. Removing
the call is a code smell; sweeps must be co-located with the phase
transitions they correspond to.

## On-event trigger integration

Today, `on-event` effects are wired ad-hoc by the reducers that detect
the event (combat reducer pokes `pendingWoundCorruptionChecks`, etc.).
After the refactor, every `on-event` handler calls
`enqueueResolution` instead.

The new event `untap-phase-at-haven` (which PR 52 introduced and which
this refactor inherits) is wired in `reducer-untap.ts:advanceToOrg` and
enqueues one `corruption-check` resolution per affected character.

`docs/card-effects-dsl.md` gains a new section listing the resolution
kinds an `apply` clause may produce, parallel to the events list.

## New cards (certified in the same PR)

### TW-60 / LE-124 — Lure of the Senses (corruption hazard)

> *Corruption. Playable on a non-Ringwraith character. Target character
> receives 2 corruption points and makes a corruption check at the end
> of his untap phase if at a Haven/Darkhaven. During his organization
> phase, the character may tap to attempt to remove this card. Make a
> roll—if the result is greater than 6, discard this card. Cannot be
> duplicated on a given character.*

Effects (DSL):

```json
[
  { "type": "play-target", "target": "character" },
  { "type": "duplication-limit", "scope": "character", "max": 1 },
  { "type": "stat-modifier", "stat": "corruption-points", "value": 2 },
  { "type": "on-event", "event": "untap-phase-at-haven",
    "apply": { "type": "force-check", "check": "corruption" },
    "target": "bearer" },
  { "type": "grant-action", "action": "remove-self-on-roll",
    "cost": { "tap": "bearer" }, "rollThreshold": 7 }
]
```

The on-event handler calls `enqueueResolution` with kind
`corruption-check`, scope `phase-step: Untap/await-checks` (a new
internal step) and source = the Lure instance. Drains via the unified
corruption-check resolver.

Carry over the duplication-limit check from PR 52
(`movement-hazard.ts`) — that part of PR 52 is not pending-effects
related and is good as-is.

Add to both `tw-hazards.json` (TW-60 stub) and `le-hazards.json` (LE-124
already exists, fill in effects). Card test in
`packages/shared/src/tests/cards/tw-060.test.ts` and a thin
`le-124.test.ts` that asserts the LE printing has identical effects.

### TW-53 / LE-119 — Lost in Free-domains (modal restriction)

> *Playable on a company moving with a Free-domain in its site path.
> The company may do nothing during its site phase.*

Effects (DSL — new `apply` type for adding constraints):

```json
[
  { "type": "play-target",
    "target": "company",
    "when": { "company.sitePathHas": "free-domain", "company.moving": true } },
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "add-constraint",
               "constraint": "site-phase-do-nothing",
               "scope": "company-site-phase" },
    "target": "target-company" }
]
```

The new `apply` type `add-constraint` is the Shape B counterpart to
`force-check`. It calls `addConstraint` with the named kind, the
target derived from `apply.target` ("target-company" → the company the
hazard was played on), and the named scope.

Tests in `packages/shared/src/tests/cards/tw-053.test.ts`:

1. play-target restricted to companies moving with free-domain in path
2. play succeeds and adds a constraint with kind
   `site-phase-do-nothing` targeting the company
3. during the company's `enter-or-skip` step the only legal action is
   `do-nothing`
4. constraint auto-clears at end of the company's site sub-phase
5. constraint does not affect *other* companies

### TW-84 / LE-134 — River (modal restriction with cancellation)

> *Playable on a site. A company moving to this site this turn must do
> nothing during its site phase. A ranger in such a company may tap to
> cancel this effect, even at the start of his company's site phase.*

Effects (DSL):

```json
[
  { "type": "play-target", "target": "site" },
  { "type": "on-event", "event": "company-arrives-at-site",
    "apply": { "type": "add-constraint",
               "constraint": "site-phase-do-nothing-unless-ranger-taps",
               "scope": "company-site-phase" },
    "target": "arriving-company",
    "when": { "site.is": "self" } }
]
```

This requires a new `on-event` trigger `company-arrives-at-site`,
fired from the M/H reducer when a company finishes movement. The
trigger scans the destination site for River-style hazards.

The constraint exposes a new action `tap-ranger-to-cancel-river` in
the legal-actions filter. Per **CRF 22**, this cancellation is only
available at the *very beginning* of the affected company's site
phase — i.e. on the first action at the `enter-or-skip` step for that
company, before any other action has been taken. After the first
action, the cancellation window has closed and the company is locked
into `do-nothing` for the rest of its site phase.

Implementation: the constraint filter only adds
`tap-ranger-to-cancel-river` when **all** of the following hold:

- the active company is the constraint's target company,
- the current site step is `enter-or-skip`, and
- the active player has not yet taken an action at this step for this
  company (tracked via a per-company `siteEnterStepConsumed` flag, or
  by observing that no resolution has popped from the queue and no
  site-phase action has advanced the step).

Resolving the action:

1. taps the chosen ranger
2. removes the River constraint via `removeConstraint`
3. discards the River card

Tests in `packages/shared/src/tests/cards/tw-084.test.ts`:

1. play-target restricted to sites
2. company arriving at the site has site-phase legal actions reduced
   to `do-nothing` + `tap-ranger-to-cancel-river` (one per untapped
   ranger) at the `enter-or-skip` step
3. cancelling restores the normal site-phase menu and discards River
4. company *not* arriving at the site is unaffected
5. constraint clears at end of site phase even if not cancelled
6. **CRF 22 timing:** if the active player chooses `do-nothing` first,
   the cancellation window is gone — re-entering the company's site
   phase (e.g. by some hypothetical effect) does not re-offer the
   ranger tap. (Validated by asserting the action is only legal as the
   *first* action at `enter-or-skip` for the affected company.)
7. only untapped rangers in the affected company are valid cancellers
   — tapped rangers, rangers in other companies, and non-rangers are
   all rejected

## Migration map (existing → new)

| Old field | New representation |
|---|---|
| `OrgPhaseState.pendingCorruptionCheck` | `PendingResolution{ kind: corruption-check, scope: phase: Org }` |
| `MHPhaseState.pendingWoundCorruptionChecks[]` | One `PendingResolution{ kind: corruption-check, scope: company-mh-subphase }` per entry |
| `SitePhaseState.pendingWoundCorruptionChecks[]` | One `PendingResolution{ kind: corruption-check, scope: company-site-subphase }` per entry |
| `MHPhaseState.pendingEffectsToOrder` | `PendingResolution{ kind: order-effects, scope: phase-step: MH/order-effects }` |
| `SitePhaseState.awaitingOnGuardReveal` + `pendingResourceAction` | `PendingResolution{ kind: on-guard-window, scope: phase-step: Site/play-resources }` |
| `SitePhaseState.pendingOpponentInfluence` | `PendingResolution{ kind: opponent-influence-defend, scope: phase-step: Site/play-resources }` |
| (PR 52) `UntapPhaseState.pendingLureChecks` | `PendingResolution{ kind: corruption-check, scope: phase: Untap }` (one per affected character) |

After migration, no phase state contains a `pending*` field. Grep for
`pending` in `state-phases.ts` should return zero hits.

## Implementation order (single PR)

The PR is large but every step is testable in isolation. Order:

1. **Add types and helpers.** `pending.ts`, `pending-reducers.ts`,
   types in `state-phases.ts` → `state.ts` (the lists move to
   `GameState`). No callers yet.
2. **Add `pendingResolutions` and `activeConstraints` to `GameState`,
   initialised empty everywhere** (`init.ts`,
   `enterUntapPhase`/`enterOrganization`/etc, `test-helpers.ts`,
   `createGameQuickStart`). Build passes; tests still green.
3. **Wire `computeLegalActions` dispatch.** Add the resolution
   short-circuit and the constraint filter. No-op while lists are
   empty. Build passes.
4. **Wire `reduce` dispatch.** Resolution actions go through
   `applyResolution` first. No-op while lists are empty.
5. **Migrate `pendingCorruptionCheck` (Org/transfer).** Delete the
   field, update the transfer reducer to enqueue, update legal-actions
   to drop its short-circuit, update card tests that touch it
   (`tw-127.test.ts`, etc., per grep). Run rules tests + the touched
   card tests.
6. **Migrate `pendingWoundCorruptionChecks` (MH and Site).** Same
   pattern. The wound on-event handlers in `reducer-combat.ts` call
   `enqueueResolution` instead of poking phase state.
7. **Migrate `pendingEffectsToOrder` (MH).** order-effects step now
   reads from the queue.
8. **Migrate `awaitingOnGuardReveal + pendingResourceAction`.**
   on-guard window becomes a Shape A entry where `pass` resolves it
   and runs the deferred action.
9. **Migrate `pendingOpponentInfluence`.** Similar.
10. **Add `untap-phase-at-haven` event.** Wired through
    `enqueueResolution` from the start (no `pendingLureChecks` field
    is ever introduced).
11. **Add `add-constraint` apply type.** Implementation in the on-event
    handler dispatcher.
12. **Add `company-arrives-at-site` event.** Fired from the M/H
    reducer at the right step.
13. **Certify TW-60 (Lure of the Senses)** + test.
14. **Certify TW-53 (Lost in Free-domains)** + test.
15. **Certify TW-84 (River)** + test.
16. **LE printings** of all three cards (data + thin parity tests).
17. **Sweep grep:** `pending` should not appear in `state-phases.ts`.
    `awaitingOnGuardReveal` should not appear anywhere. Card tests
    that previously poked phase-state pending fields directly use
    helper functions on `pending.ts` instead.
18. **Update `docs/card-effects-dsl.md`** with the new event,
    constraints section, and `add-constraint` apply type.
19. **Update `docs/glossary.md`** with "pending resolution" and
    "active constraint".

Each step ends with a green build. Steps 5–9 each end with all rules
tests + the touched card tests green. Final pre-push runs the full
suite (`npm test`, `npm run test:nightly`, lint, lint:md).

## Tests to add (beyond the three card tests)

- `tests/rules/<engine>/pending-resolutions.test.ts` — unit-style
  rules tests for the queue mechanics: enqueue/dequeue, FIFO order,
  scope sweep at boundaries, per-actor short-circuit.
- `tests/rules/<engine>/active-constraints.test.ts` — same for
  constraints: add/remove, sweep, filter integration.

These are *rules tests*, not utility tests — they exercise the public
API via `reduce` and `computeLegalActions`, not the internal helpers.
Helper-level coverage falls out of the card tests.

## Risks and trade-offs

- **One big PR.** ~25 source files touched, ~9 card tests rewritten,
  3 new card tests, 2 new rule test files. The migration order above
  is designed so each step is independently green; if review wants
  the PR split later, the steps are clean cut points.
- **Action-type proliferation.** Every resolution kind needs at least
  one concrete `GameAction` to resolve it. Most already exist
  (`corruption-check`, `order-effects`, `opponent-influence-defend`).
  on-guard window keeps reusing `pass` and the existing reveal
  actions.
- **Source attribution.** `PendingResolution.source` is nullable for
  resolutions not produced by a card (e.g. order-effects step
  transition). Card-produced resolutions must always set it so the
  UI can tell the player *why* they're being asked.
- **Per-actor queue ordering.** Resolutions for two actors can
  coexist; `topResolutionFor` filters by actor. Within one actor, FIFO
  by enqueue order. No priority field — if priority becomes necessary
  later, add it then.
- **Persistence/save format.** Save files include `GameState`. Adding
  two top-level lists is a save-format change. **Decision:** existing
  saves in `~/.meccg/saves/` are declared invalid by this PR — no
  migration is written. The PR description must call this out so
  anyone with in-progress games knows to start fresh.
- **Dropping six fields is a public-API break for any external tool
  that reads `GameState`.** None known in-repo, but worth a grep of
  `pendingCorruptionCheck` etc. across the lobby and text clients
  before merge.

## Open follow-ups (not in this PR)

- More constraint kinds will accumulate (e.g. "may not move", "hazard
  limit doubled"). The discriminated union grows.
- The resolution queue is the natural home for future deferred
  effects (long events that fire at start-of-turn, healing-at-haven,
  etc.). They can be added as new `kind` variants without further
  refactoring.
- Eventually, the chain-of-effects state (`state.chain`) and the
  pending-resolution queue may converge — both are "stuff the engine
  has queued for a player." Out of scope here.
