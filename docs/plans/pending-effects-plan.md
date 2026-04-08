# Pending Effects — Implementation Plan

## Status

**Foundation + four card certifications landed** on branch `pending-effects`:

### Core foundation

- New types `PendingResolution`, `ActiveConstraint`, `ResolutionScope`,
  `ConstraintScope`, `ScopeBoundary` (`packages/shared/src/types/pending.ts`).
- Helper module `engine/pending.ts` with `enqueueResolution`,
  `dequeueResolution`, `topResolutionFor`, `addConstraint`,
  `removeConstraint`, `sweepExpired`.
- Resolver dispatch in `engine/pending-reducers.ts`
  (`applyResolution` → `applyCorruptionCheckResolution`, with stubs for
  `order-effects` / `on-guard-window` / `opponent-influence-defend`).
- `GameState` carries `pendingResolutions` and `activeConstraints`.
- `computeLegalActions` short-circuits to resolution actions when one is
  queued for the player, and waits silently when one is queued for the
  *other* player.
- `reduce` dispatches resolution actions through `applyResolution` before
  delegating to per-phase reducers.
- Constraint filter (`legal-actions/pending.ts`) implements all three
  kinds: `site-phase-do-nothing`,
  `site-phase-do-nothing-unless-ranger-taps`, and
  `no-creature-hazards-on-company`.
- Sweep boundaries wired in:
  - MH `advanceAfterCompanyMH` → `company-mh-end`
  - Site `advanceSiteToNextCompany` → `company-site-end`
  - End-of-turn `signal-end` → `turn-end`
- Chain reducer wires the `on-event: self-enters-play`
  → `apply.type: add-constraint` dispatch (see
  `chain-reducer.ts:applyAddConstraintFromOnEvent`).

### Migrations complete (steps 5–7)

Three of the six legacy `pending*` fields are gone:

- `OrgPhaseState.pendingCorruptionCheck` → unified `corruption-check`
  resolution (Transfer reason).
- `MHPhaseState.pendingWoundCorruptionChecks[]` and
  `SitePhaseState.pendingWoundCorruptionChecks[]` → unified
  `corruption-check` resolutions (creature / auto-attack reason),
  scoped to the company's MH/Site sub-phase.
- `MHPhaseState.pendingEffectsToOrder` (was dead code) — deleted.

### Events

- **`untap-phase-at-haven` event** (`reducer-untap.ts`) — scans every
  character at a haven for attached cards with the matching on-event
  and enqueues a `corruption-check` resolution per match. Used by
  *Lure of the Senses*.

### Card certifications (steps 13–17)

All four cards from the plan are certified with focused tests:

- **TW-60 / LE-124 — Lure of the Senses** (7 tests). Full play
  pipeline: hazard play, +2 CP via `stat-modifier`,
  untap-phase-at-haven event triggers a `corruption-check` resolution,
  `grant-action: remove-self-on-roll` removal mechanic.
- **TW-53 / LE-119 — Lost in Free-domains** (4 tests). Constraint
  filter: enter-or-skip menu collapses to `pass` for the affected
  company; other companies unaffected; sweep clears on
  `company-site-end`.
- **TW-84 / LE-134 — River** (5 tests). Constraint filter +
  ranger-tap-to-cancel: untapped rangers offered as
  `tap-ranger-to-cancel-river`; tapped rangers and non-rangers
  cannot cancel; sweep clears on `company-site-end`.
- **TW-332 — Stealth** (5 tests). First cross-player constraint:
  protected company drops opposing creature plays; non-creature
  hazards still allowed; other companies unaffected; sweep clears
  at `turn-end`. (No LE reprint exists.)

### Card data added

- `tw-60` Lure of the Senses (TW), with the LE-124 stub filled in to match.
- `tw-53` Lost in Free-domains (TW). LE-119 still a stub — add when
  the LE printing parity test lands.
- `tw-84` River (TW). LE-134 still a stub — same.
- `tw-332` Stealth (TW resource).

### Type extensions

- `TriggeredAction` extended with `constraint` and `scope` fields for
  the `add-constraint` apply type.
- `PlayTargetEffect.target` extended to `'character' | 'company' |
  'site' | 'own-scout'`.

### Pre-push results

All five checks green:

- **Build** ✓
- **`npm test`** — 94 rules tests passed
- **`npm run test:nightly`** — 333 card tests passed (21 new)
- **`npm run lint`** ✓
- **`npm run lint:md`** ✓

## Remaining work (follow-up PRs)

The four cards above are exercised through their constraint /
resolution mechanics. The full play-from-hand wiring for the new
`play-target` kinds (`company`, `site`, `own-scout`) is intentionally
left as a follow-up alongside the remaining migrations:

1. **Migrate `awaitingOnGuardReveal + pendingResourceAction`** to a
   `PendingResolution` of kind `on-guard-window`. Care needed: the
   reveal allows multiple stages with the chain taking priority between
   them. Delete the legacy field, the legacy short-circuit in
   `legal-actions/site.ts`, the legacy dispatcher in `reducer-site.ts`,
   and the legacy `handleOnGuardRevealAtResource`.
2. **Migrate `pendingOpponentInfluence`** to a `PendingResolution` of
   kind `opponent-influence-defend`. Move the existing
   `handleOpponentInfluenceDefend` body into
   `applyOpponentInfluenceDefendResolution` in `pending-reducers.ts`.
3. **Wire play-target = company/site/own-scout in the M/H legal-action
   computer** so the four cert cards can be played from hand, not just
   exercised via direct `addConstraint` calls. The chain dispatcher in
   `chain-reducer.ts:applyAddConstraintFromOnEvent` is already in
   place.
4. **Add the `company-arrives-at-site` event** for *River* (so the
   constraint can be added the moment a company arrives at a site
   carrying River, not just on self-enters-play).
5. **Add the `end-of-org` step** to the organization phase reducer so
   *Stealth* has a strict play window.
6. **CRF 22 timing for River cancellation**: enforce that
   `tap-ranger-to-cancel-river` is only legal as the *first* action at
   the affected company's `enter-or-skip` step (not after a `pass`
   has consumed the step).
7. **LE printings** of Lure (LE-124), Lost in Free-domains (LE-119),
   and River (LE-134) — fill in their effects to mirror the TW
   versions and add thin parity tests. Stealth has no LE reprint.
8. **Unit-style rules tests** for the queue and constraint mechanics
   (`tests/rules/<engine>/pending-resolutions.test.ts` and
   `pending-constraints.test.ts`). Currently the mechanics are
   exercised end-to-end through the four card tests.

The remaining migrations and follow-ups are independent — each can
land on its own.

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
      }
    | {
        // Stealth: opponent may not play creature hazards on this
        // company for the rest of this turn.
        readonly type: 'no-creature-hazards-on-company';
      };
}
```

`ActiveConstraint.kind` is the only place new constraint types are
added.

**Cross-player constraints.** Lost in Free-domains and River filter
the *owning* player's legal actions, but Stealth filters the
*opponent's* (hazard player's) legal actions. The design already
supports this: `applyConstraints(state, playerId, base)` walks every
constraint whose `target` is in scope for `playerId`'s current
decision — it does not require the constraint's `source` and the
acting player to match. The constraint filter must therefore inspect
the action being filtered, not the player, to decide whether a given
constraint kind is relevant. (E.g. `no-creature-hazards-on-company`
fires when `playerId` is computing hazard plays against the target
company, regardless of whose company it is.)

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
  affected company, drop every legal action except `pass` (the
  engine action that "do nothing" maps to — see
  `enterOrSkipActions` in `legal-actions/site.ts:158`).
- `site-phase-do-nothing-unless-ranger-taps` — same as above, **plus**
  add a `tap-ranger-to-cancel-river` action for each untapped ranger
  in the company. Resolving that action removes the constraint and
  returns the company to the normal `enter-or-skip` menu
  (`enter-site` and `pass`).
- `no-creature-hazards-on-company` — when filtering hazard plays
  during the M/H phase, drop every action whose card is a creature
  *and* whose target company matches the constraint's target. Other
  hazard categories (corruption, faction-affecting, etc.) and
  creature plays against other companies are unaffected.

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
   `pass` (the `enter-site` option is removed)
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
into `pass` for the rest of its site phase.

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
   to `pass` + `tap-ranger-to-cancel-river` (one per untapped
   ranger) at the `enter-or-skip` step
3. cancelling restores the normal site-phase menu and discards River
4. company *not* arriving at the site is unaffected
5. constraint clears at end of site phase even if not cancelled
6. **CRF 22 timing:** if the active player chooses `pass` first,
   the cancellation window is gone — re-entering the company's site
   phase (e.g. by some hypothetical effect) does not re-offer the
   ranger tap. (Validated by asserting the action is only legal as the
   *first* action at `enter-or-skip` for the affected company.)
7. only untapped rangers in the affected company are valid cancellers
   — tapped rangers, rangers in other companies, and non-rangers are
   all rejected

### TW-332 — Stealth (cross-player modal restriction)

> *Scout only. Tap a scout to play at the end of the organization
> phase only if the scout's company size is less than three. No
> creature hazards may be played on his company this turn.*

A Hero short-event resource. Played by the resource player on their
own company; the resulting constraint then filters the *hazard*
player's legal actions for the rest of the turn. This is the first
constraint in the system that targets opponent action computation
(see "Cross-player constraints" above).

Effects (DSL):

```json
[
  { "type": "play-window", "phase": "organization", "step": "end-of-org" },
  { "type": "play-target", "target": "own-scout",
    "when": { "company.size": { "lt": 3 } } },
  { "type": "play-cost", "cost": { "tap": "target" } },
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "add-constraint",
               "constraint": "no-creature-hazards-on-company",
               "scope": "turn" },
    "target": "scout-company" }
]
```

Notes on plumbing:

- The "end of organization phase" play-window is a new sub-step
  inside Org. Today the Org phase ends abruptly when the active
  player chooses to advance; the engine will need an explicit
  `end-of-org` step where short-events with that timing are legal
  before the transition to M/H. This is **not** pending-effects
  related, but Stealth forces the issue and the step is added in
  this PR alongside the cert.
- `play-cost: tap target` extends the existing cost machinery — the
  scout being targeted is also the scout being tapped. The
  precondition `company.size < 3` is evaluated at play-time against
  the target scout's company.
- The `on-event: self-enters-play` handler routes through the same
  `add-constraint` apply type used by Lost in Free-domains and
  River. No new event is required.
- `scope: turn` is already present in `ConstraintScope`. The
  `turn-end` sweep in the existing turn-end reducer will pick this
  up automatically.

Tests in `packages/shared/src/tests/cards/tw-332.test.ts`:

1. play-target restricted to scouts in companies of size < 3,
   rejected for size 3 and for non-scout characters
2. play-window restricted to the end of the organization phase —
   illegal earlier in Org and illegal in any other phase
3. playing taps the chosen scout and adds a constraint with kind
   `no-creature-hazards-on-company`, scope `turn`, targeting the
   scout's company
4. during the following M/H phase the opposing player's hazard menu
   has every creature-on-this-company play removed
5. opposing player can still play creature hazards on the resource
   player's *other* companies
6. opposing player can still play *non-creature* hazards (corruption,
   etc.) on the protected company
7. constraint clears at end of turn — on the next turn, creature
   hazards are legal against the company again
8. constraint also clears if the protected company merges, splits,
   or is otherwise dissolved before turn-end (covered by the
   constraint sweep on company lifecycle, which Stealth motivates)

No LE reprint exists for Stealth (verified against `data/cards.json`),
so no parity test is needed.

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
16. **Add `end-of-org` step** to the organization phase reducer so
    Stealth (and future end-of-org short-events) has a legal play
    window. Existing Org tests must remain green.
17. **Certify TW-332 (Stealth)** + test. First exercise of a
    cross-player active constraint; the constraint filter must be
    audited to confirm it walks all constraints regardless of
    `source` ownership.
18. **LE printings** of Lure, Lost in Free-domains, and River (data
    plus thin parity tests). Stealth has no LE reprint.
19. **Sweep grep:** `pending` should not appear in `state-phases.ts`.
    `awaitingOnGuardReveal` should not appear anywhere. Card tests
    that previously poked phase-state pending fields directly use
    helper functions on `pending.ts` instead.
20. **Update `docs/card-effects-dsl.md`** with the new event,
    constraints section, and `add-constraint` apply type.
21. **Update `docs/glossary.md`** with "pending resolution" and
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
