# DSL Generalization Plan

Replace hardcoded "magic keyword" switches in the engine with generic DSL
expressions. Every card-specific string literal the reducer or
legal-action computer matches against is a smell: it pushes card logic
into the engine instead of keeping it in card JSON.

## Guiding principle

> Prefer DSL expressions over magic keywords. When a card's behavior
> depends on a precondition, describe the precondition as a DSL
> `when` / `filter` / `condition` evaluated via the shared
> `matchesCondition`. When it has an effect, describe the effect via a
> generic `apply` clause dispatched on the apply's `type` alone (no
> per-card name switch). New per-card keywords are a last resort, only
> when the primitive genuinely can't be expressed in the existing DSL.

This plan tracks the known offenders, prioritized by blast radius.

## Baseline (already done)

These serve as the template for the cleanups below:

- `play-target` with generic `filter` condition replaced the
  `own-hobbit` / `own-scout` keywords (PR #83, commit `b4de4dc`). The
  filter is evaluated against the per-candidate context
  `{ target: { race, status, skills, name } }`.
- `play-option` effects express mutually-exclusive choices at play time
  via `when` + `apply`. The reducer dispatches on `apply.type` only.
- `check-modifier` constraint kind replaced the card-specific
  `corruption-check-boost` constraint (commit `80fc62e`). Any future
  card granting a one-shot bonus to a named check type reuses the same
  kind unchanged.

---

## 1. `grant-action` action IDs (HIGH priority)

### Smell

`packages/shared/src/engine/legal-actions/organization.ts` contains a
`grantedActionActivations` function that switches on literal action IDs
to decide both the **precondition** and the **cost** of activating each
ability. The matching reducer in `reducer-site.ts` / reducer-organization
dispatches on the same literals.

Current card-specific action IDs:

| ID | Card | Behavior |
|----|------|----------|
| `gwaihir-special-movement` | Gwaihir (tw-251) | Discard ally, company size ≤ 2, grants special movement |
| `untap-bearer` | Cram (tw-156) | Discard item to untap bearer (bearer must be tapped) |
| `test-gold-ring` | Gandalf (tw-060) | Tap self, roll 2d6, test a gold ring in company |
| `extra-region-movement` | Cram-type items | Discard item to grant +1 region distance |
| `remove-self-on-roll` | Foolish Words (tw-180) | Tap bearer, roll 2d6, on success discard source |
| `tap-ranger-to-cancel-river` | River (tw-084) | Tap a ranger in the affected company to cancel the site-phase constraint |

Each carries bespoke precondition logic in `organization.ts` (company
size, status checks, gold-ring scan, constraint matching, etc.) and a
bespoke reducer branch.

### Target shape

`grant-action` effect grows:

- `when` (DSL condition evaluated against the activator context:
  `{ self, bearer, company, target, constraint }`) — gates visibility of
  the action in the legal-action menu.
- `apply` (generic `TriggeredAction`) — executes when the action is
  chosen. Reuses the existing apply dispatch (`set-character-status`,
  `add-constraint`, `remove-constraint`, `force-check`, etc.).
- `target` (DSL `filter` similar to `play-target`) — enumerates valid
  targets for actions that need one (e.g. test-gold-ring picking which
  ring to test).

Example — Cram's `untap-bearer` becomes:

```json
{
  "type": "grant-action",
  "id": "untap-bearer",
  "cost": { "discard": "self" },
  "when": { "bearer.status": "tapped" },
  "apply": { "type": "set-character-status",
             "target": "bearer",
             "status": "untapped" }
}
```

Example — River's ranger-tap cancel becomes:

```json
{
  "type": "grant-action",
  "id": "cancel-constraint",
  "cost": { "tap": "character" },
  "target": {
    "kind": "character-in-company",
    "filter": {
      "$and": [
        { "target.skills": { "$includes": "ranger" } },
        { "target.status": "untapped" }
      ]
    }
  },
  "apply": { "type": "remove-constraint", "source": "self" }
}
```

### Steps

1. Extend `GrantActionEffect` in `types/effects.ts` with optional `when`,
   `apply`, and character-target `target` fields.
2. Add a new `TriggeredAction` apply kind `remove-constraint` for the
   River / Stealth-cancel pattern (currently only `add-constraint`
   exists).
3. Generalize `grantedActionActivations` in
   `legal-actions/organization.ts`: iterate every `grant-action` effect
   on every in-play card, evaluate the `when` condition via
   `matchesCondition`, emit one action per eligible (actor, target)
   pair. Drop the per-ID switch entirely.
4. Generalize the `activate-granted-action` reducer to dispatch on
   `apply.type` (reusing existing apply handlers) rather than matching
   `actionId` against card-specific literals.
5. Migrate cards one at a time, verifying each with its card test:
   `tw-156 Cram`, `tw-251 Gwaihir`, `tw-060 Gandalf`, `tw-084 River`,
   `tw-180 Foolish Words`. Keep the legacy path alive until the final
   card migrates, then delete the dead switches.

### Risk

Medium. `test-gold-ring` has a roll-then-consequence shape the current
generic `apply` can't express — it needs a new apply type like
`roll-then-apply` with `threshold` + nested `onSuccess`/`onFailure`
applies, which is itself a generalization (also usable by
`remove-self-on-roll`).

---

## 2. `play-restriction` rule IDs (HIGH priority)

### Smell

`play-restriction` carries `rule: string` and the legal-action code
matches against the string in five different files:

- `home-site-only` (Frodo, Sam — `legal-actions/organization-characters.ts:31`)
- `playable-as-resource` (permanent/long events playable during M/H —
  `legal-actions/organization-events.ts:100`,
  `legal-actions/movement-hazard.ts:384,418`,
  `legal-actions/chain.ts:79`,
  `reducer-organization.ts:222,255`,
  `reducer-movement-hazard.ts:248`)
- `no-hazard-limit` (Twilight and similar — scattered checks)

Each rule is a string comparison with a matching conditional
`if (def.effects?.some(e => e.type === 'play-restriction' && e.rule === 'X'))`.

### Target shape

`play-restriction` grows a `condition` (DSL) and optional `scope` (where
the check lives). The legal-action code collects all
`play-restriction` effects on the card and evaluates their condition
against the current play context.

For presence-only flags (`playable-as-resource`, `no-hazard-limit`),
introduce a second effect type `play-flag` with a `flag: string`
enum — still a keyword, but one flag = one uniform gate, and the set
is closed (no card-specific logic, just "does the card declare this
flag").

Example — Frodo's home-site restriction:

```json
{
  "type": "play-restriction",
  "condition": { "site.name": "self.homeSite" }
}
```

Example — Twilight's hazard-limit bypass:

```json
{ "type": "play-flag", "flag": "no-hazard-limit" }
{ "type": "play-flag", "flag": "playable-as-resource" }
```

### Steps

1. Add `condition?: Condition` to `PlayRestrictionEffect`.
2. Define a new `PlayFlagEffect` with a closed `flag` enum.
3. Migrate `home-site-only` to a condition.
4. Migrate `playable-as-resource` and `no-hazard-limit` to flags.
5. Delete the `rule === 'X'` scattered checks; replace with a single
   helper `hasPlayFlag(def, flag)` and a generic
   `checkPlayRestrictions(def, context)`.

### Risk

Medium. Several files touched; rules tests should catch regressions.
Careful with `playable-as-resource` — it affects timing windows as well
as legality, so the flag lookup may need to be threaded through more
code paths than a pure legality gate.

---

## 3. `combat-rule` rule IDs ✅ DONE

Split into three distinct effect types
(`combat-attacker-chooses-defenders`, `combat-multi-attack`,
`combat-cancel-attack-by-tap`). The chain reducer dispatches on effect
type. Card JSON (tw-008 Assassin, tw-020 Cave-drake, dm-108 Little
Snuffler) migrated. No rule-string matching remains in the engine.

---

## 4. `site-phase-do-nothing-unless-ranger-taps` constraint kind (MEDIUM priority)

### Smell

`types/pending.ts` lines ~206–241 define this as a standalone
constraint kind, but it is literally
`site-phase-do-nothing` + "unless a ranger in the target company taps".
The escape hatch is already implemented via a hardcoded
`tap-ranger-to-cancel-river` grant-action branch (see #1 above).

### Target shape

Collapse into `site-phase-do-nothing` with an optional `cancelWhen`
DSL condition evaluated against the constraint's activator context.
The River card declares:

```json
{
  "type": "add-constraint",
  "constraint": "site-phase-do-nothing",
  "target": "active-company",
  "scope": "company-site-phase",
  "cancelWhen": {
    "$and": [
      { "actor.skills": { "$includes": "ranger" } },
      { "actor.status": "untapped" }
    ]
  }
}
```

Cleanup also depends on #1 — the grant-action side needs the
`remove-constraint` apply kind to express "tap to cancel".

### Steps

1. Land #1 first so `remove-constraint` apply exists.
2. Extend the `site-phase-do-nothing` constraint kind with
   `cancelWhen?: Condition`.
3. Delete the `site-phase-do-nothing-unless-ranger-taps` variant.
4. Update River card JSON to declare the base kind + `cancelWhen`.
5. Re-run `tw-084 River` card test.

### Risk

Low once #1 is done.

---

## Already clean (no action needed)

These were audited and confirmed generic:

- `on-event.event` strings (`self-enters-play`, `company-arrives-at-site`,
  `character-wounded-by-self`, `untap-phase-at-haven`) — declared in
  card JSON, reducer matches uniformly, no per-card branches.
- `site-rule` IDs — carried as data, no per-card reducer switch.
- `TriggeredAction.type` values (`add-constraint`, `set-character-status`,
  `force-check`, `discard-cards-in-play`) — all genuinely generic
  primitives that many cards reuse.

---

## 5. Attribute-modifier primitive ✅ DONE

Collapsed `auto-attack-prowess-boost`, `site-type-override`, and
`region-type-override` into one `attribute-modifier` constraint kind.
`buildConstraintKind` produces `attribute-modifier` from the existing
JSON (card data keeps its legacy names — the translation lives in the
engine). All five consumer sites now filter
`kind.type === 'attribute-modifier'` plus attribute/op/filter; the
generic `engine/effective.ts::resolveEffective` helper handles
entity-scoped reads (auto-attack prowess on a specific company).

Future attribute overrides (body, corruption, mind, etc.) are a
one-line union extension in `AttributePath` plus one consumer-side
read — no new constraint kinds needed.

### Historical notes

Certifying Choking Shadows (tw-21, commit `0f634af`) introduced **three
new active-constraint kinds** that are all the same concept — a
conditional override of an attribute on an entity, gated by a filter,
living for some scope:

| Kind | Where produced | Where consumed | Attribute affected |
|------|----------------|----------------|--------------------|
| `auto-attack-prowess-boost` (`types/pending.ts:262–268`) | `chain-reducer.ts` short-event arrival trigger | `reducer-site.ts:431–453` `handleSiteAutomaticAttacks` | auto-attack prowess |
| `site-type-override` (`types/pending.ts:275–281`) | `chain-reducer.ts:548–572` | `legal-actions/movement-hazard.ts:738–751` `findCreatureKeyingMatches` | `site.type` |
| `region-type-override` (`types/pending.ts:288–295`) | `chain-reducer.ts:574–583` | `movement-hazard.ts:752–764` | `region.type` |

Each of these adds: a new kind in the discriminated union, a new
production branch in `buildConstraintKind()`, a new consumer that greps
`state.activeConstraints` for the kind, and a new JSON dialect on the
card. The next hazard card that wants to change any other attribute
(body, corruption, mind, site name, region name, any numeric or
enumerated property) will bring three more files of the same spaghetti.

The engine already reads these attributes directly from card
definitions in many places — `reducer-untap.ts:217,312`,
`reducer-movement-hazard.ts:608,1234,1251,1272`,
`legal-actions/organization-companies.ts:166`,
`legal-actions/site.ts:29`. None of those reads consult any override
layer today.

Meanwhile `check-modifier` (`types/pending.ts:241–246`, consumed in
`legal-actions/pending.ts:356–363`) **already** works the way we want:
card declares `{ add-constraint: check-modifier, check, value, scope }`,
the resolver iterates matching constraints and sums their values.
Halfling Strength uses it as data. That is the template.

### Target shape

Collapse all three Choking Shadows kinds (and any future attribute
override) into one constraint kind:

```ts
readonly type: 'attribute-modifier';
readonly attribute: AttributePath;   // 'auto-attack.prowess' | 'site.type' | 'region.type' | …
readonly op: 'add' | 'override' | 'multiply';
readonly value: number | string;
readonly target: AttributeTarget;    // closed union — company/site/region/character + selector
readonly filter?: Condition;         // extra gate evaluated at read time (e.g. only at R&L sites)
```

Cards declare it through existing `add-constraint`:

```json
{ "type": "on-event", "event": "company-arrives-at-site",
  "when": { "company.destinationSiteType": "ruins-and-lairs" },
  "apply": {
    "type": "add-constraint",
    "constraint": "attribute-modifier",
    "attribute": "auto-attack.prowess",
    "op": "add",
    "value": 2,
    "target": { "kind": "active-company" },
    "filter": { "site.type": "ruins-and-lairs" },
    "scope": "company-site-phase"
  }
}
```

```json
{ "type": "add-constraint",
  "constraint": "attribute-modifier",
  "attribute": "site.type",
  "op": "override",
  "value": "shadow-hold",
  "target": { "kind": "site", "resolve": "arrival-destination" },
  "scope": "turn" }
```

```json
{ "type": "add-constraint",
  "constraint": "attribute-modifier",
  "attribute": "region.type",
  "op": "override",
  "value": "shadow",
  "target": { "kind": "region", "resolve": "arrival-destination-region" },
  "scope": "turn" }
```

The engine side grows **one** new helper:

```ts
resolveEffective<T>(
  entity: { kind, id },
  attribute: AttributePath,
  baseValue: T,
  context: ReadContext,
  state: GameState,
): T;
```

It walks `state.activeConstraints`, keeps those whose `attribute`
matches, whose `target` selector resolves to this entity, and whose
`filter` evaluates true under `context`, then folds them (override
wins, adds sum). Every site/region/character/auto-attack read that
currently does `def.siteType` / `comp.destinationSiteType` /
`resolveAttackProwess()` is routed through this helper.

### Steps

1. Define `AttributePath`, `AttributeTarget`, `AttributeModifier` in
   `types/pending.ts`. Collapse `auto-attack-prowess-boost`,
   `site-type-override`, `region-type-override` into the union as
   deprecation aliases (kept readable by the new resolver until
   migration completes).
2. Add `resolveEffective()` in a new `engine/effective.ts` module. It
   must be pure (`(state, entity, attr, base, ctx) → value`). Start with
   three attribute paths: `auto-attack.prowess`, `site.type`,
   `region.type`.
3. Route every direct read of those three attributes through the helper
   (five call sites enumerated above plus `reducer-site.ts:431`). Do
   **not** touch unrelated attribute reads yet — each migration is its
   own commit with its own card test.
4. Teach `buildConstraintKind()` to produce the new `attribute-modifier`
   kind from the generic `add-constraint` shape.
5. Rewrite `tw-21` JSON to use the new shape. Delete the three
   deprecated kinds once the card test passes against the generic
   machinery.
6. Document `attribute-modifier` in `docs/card-effects-dsl.md`
   alongside `check-modifier`, with the three Choking Shadows modes as
   worked examples.

### Risk

Medium. The helper itself is small, but every attribute migration is a
potential regression site. Mitigation: do the three Choking Shadows
attributes first (they have the only consumers that currently respect
overrides, so regressions surface in `tw-21.test.ts`), then extend the
helper to other attributes only when a card demands it. No speculative
attribute coverage.

### Scale

Choking Shadows was 488 LoC across 8 files. Post-generalization the
card becomes ~30 lines of JSON and the engine-side diff collapses to
the one-time resolver + five call-site redirects. The second and third
cards needing attribute overrides will be pure JSON.

---

## 6. Constraint-gated granted actions + path DSL (HIGH priority)

### Smell

Great Ship (tw-248, commit `57d1ae3`) added **842 lines** for one card:
a bespoke constraint kind, a bespoke M/H chain action type, two
duplicated legal-action generators, two duplicated reducers, and an
inline coastal-path predicate implemented twice.

- `cancel-hazard-by-tap` constraint kind (`types/pending.ts:254–264`) —
  carries **no fields**, it's a pure discriminator. All logic lives in
  the consumers.
- `CancelHazardByTapAction` action type
  (`types/actions-movement-hazard.ts:304–322`) — a brand-new M/H chain
  action that taps a character and negates a chain entry.
- Legal-action generator
  `cancelHazardByTapChainActions()`
  (`legal-actions/chain.ts:201–279`) — hardcoded to this constraint,
  gates on `chainCoastalPath()` (lines 262–278).
- Duplicate coastal-path predicate `isCoastalPath()` at
  `legal-actions/movement-hazard.ts:588–612` — same logic,
  cut-and-pasted.
- Duplicate reducers: `handleChainCancelHazardByTap` in
  `chain-reducer.ts:1263–1318` and `handleCancelHazardByTap` in
  `reducer-movement-hazard.ts:1506–1568`. Same "tap character + negate
  entry + discard hazard" body, living in two modules.

Conceptually this is the same shape as the River cancel (#1, #4): *a
character in a specific company may pay a cost to cancel some pending
effect, when a condition is met*. The River side is already scheduled
to become generic `grant-action` + `remove-constraint` apply. Great
Ship just needs to be slotted into the same machinery.

### Target shape

**Reuse `grant-action` from section #1 inside the M/H chain window.**
The constraint becomes a *scoped granted action*, declared like any
other `grant-action` effect but produced by `on-event: self-enters-play`
with a `scope` instead of living statically on the card:

```json
{ "type": "on-event", "event": "self-enters-play",
  "apply": {
    "type": "add-constraint",
    "constraint": "granted-action",
    "scope": "turn",
    "target": { "kind": "company", "resolve": "play-target" },
    "action": {
      "id": "cancel-chain-entry",
      "phase": "movement-hazard",
      "window": "chain-declaring",
      "cost": { "tap": "character-in-target-company" },
      "when": { "path.matches": {
        "$and": [
          { "contains": { "regionType": "coastal" } },
          { "not": { "hasConsecutive": { "regionType": { "$ne": "coastal" } } } }
        ] } },
      "apply": {
        "type": "cancel-chain-entry",
        "select": "most-recent-unresolved-hazard"
      }
    }
  }
}
```

This requires three new generic primitives, none card-specific:

1. **`granted-action` constraint kind** — a `grant-action` effect
   attached dynamically (with a lifetime scope). Section #1 already
   plans the static `grant-action` pipeline; this extends it to allow
   constraints to carry the same shape.
2. **`cancel-chain-entry` apply kind** — a `TriggeredAction` that
   negates a chain entry and discards the source hazard. Parameterized
   by a selector (`most-recent-unresolved-hazard`, `entry-index`,
   filter). Reusable by any future "cancel a hazard by paying cost X"
   card, and by any chain-negation effect generally.
3. **Path-condition DSL** — a new condition family evaluated against
   the company's resolved site path:
   - `path.contains` / `path.containsAll` — region-type membership.
   - `path.hasConsecutive` — sliding-window predicate (with
     negation, this expresses "no two consecutive non-coastal").
   - `path.length` — numeric comparison.
   These go through the existing `matchesCondition` resolver so any
   future path-gated card (and Great Ship) reuses them as data.

Great Ship's JSON becomes ~25 lines. The engine gains the three
primitives and **loses** `cancel-hazard-by-tap`, `CancelHazardByTapAction`,
both `isCoastalPath` copies, both reducer handlers, and both legal-
action generators.

### Steps

1. Land section #1 first (static `grant-action` with `when`/`apply`
   pipeline) — required template.
2. Add `cancel-chain-entry` as a new `TriggeredAction` apply kind in
   `chain-reducer.ts`. Single handler: tap cost holder, mark entry
   negated, discard source. Replaces both existing Great Ship reducers.
3. Add `granted-action` constraint kind in `types/pending.ts` that
   carries a `GrantActionEffect` payload plus a target selector and
   scope. Teach the legal-action computer for the M/H chain window to
   iterate active `granted-action` constraints and emit their actions
   uniformly (same dispatch path that static `grant-action` effects
   use).
4. Add the path-condition DSL: extend `matchesCondition` with
   `path.contains`, `path.hasConsecutive`, `path.length`, evaluated
   against a context exposing `path: RegionType[]`. Delete both
   `isCoastalPath` copies.
5. Add `target.kind: "company"` / `target.resolve: "play-target"`
   resolution helpers so cards can aim a granted action at the company
   that played the source event. This is the only new piece of
   plumbing for Great Ship's "whichever company tapped a character to
   play me" targeting.
6. Rewrite `tw-248` JSON to use the generic shape. Delete
   `cancel-hazard-by-tap` constraint, `CancelHazardByTapAction`,
   both bespoke reducers, both bespoke generators. `tw-248.test.ts`
   proves the generic pipeline covers the old behavior exactly.
7. Migrate River (#1, #4) to the same pipeline — its "ranger taps to
   cancel a site-phase constraint" is exactly a `granted-action` with a
   different `when` and `apply`.

### Risk

High during migration, low after. The M/H chain is the most complex
window in the engine, and Great Ship's current implementation duplicates
reducers across `chain-reducer.ts` and `reducer-movement-hazard.ts` —
care is needed to confirm both old call sites converge on the new
unified handler. Mitigation: keep the old kind alive behind a feature
flag until `tw-248.test.ts` passes end-to-end against the generic path,
then delete. Path-condition DSL is independent and can land first as a
standalone primitive.

### Scale

Great Ship: 842 LoC → ~25 lines of JSON + reuse of primitives.
Every future card with a path precondition (sea voyages, mountain
crossings, forest ambushes) becomes pure data. Every future
"pay a cost to cancel a hazard" card becomes pure data.

---

## Sequencing

Recommended order:

1. ~~**#1 grant-action**~~ — done for all card-declared grant-actions.
   `cancel-constraint` remains as it is emitted by an active constraint
   (not a grant-action effect) and belongs to #6's machinery.
2. ~~**#5 attribute-modifier**~~ — done. Three Choking Shadows
   constraint kinds collapsed into one generic kind.
3. **#6 granted-action + path DSL** — remaining. Migrate Great Ship
   (tw-248) and River (tw-084) off their bespoke constraint kinds and
   reducers. Introduces granted-action constraint kind, path-condition
   DSL, `cancel-chain-entry` apply, `remove-constraint` apply.
4. ~~**#4 constraint collapse**~~ — done.
5. ~~**#2 play-restriction**~~ — done (`PlayFlagEffect` replaced the
   rule-string matching).
6. ~~**#3 combat-rule**~~ — done.

Each step is its own PR with card-test coverage on the cards it
touches, so regressions surface immediately in the nightly suite.

## Budget discipline

New rule of thumb for card certification: **if one card's PR adds more
than ~100 lines of engine code (tests and JSON excluded), stop and
reach for one of the generalizations in this plan first.** Choking
Shadows (488 LoC) and Great Ship (842 LoC) both blew past that budget
because the generalizations weren't in place — this plan exists so the
next card that wants the same primitive gets it as data, not code.
