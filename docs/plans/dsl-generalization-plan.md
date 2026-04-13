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

## 3. `combat-rule` rule IDs (MEDIUM priority)

### Smell

`chain-reducer.ts` (~722, ~730, ~738) dispatches on literal
`combat-rule` strings:

- `attacker-chooses-defenders`
- `multi-attack` (carries `count`)
- `cancel-attack-by-tap` (carries `maxCancels`)

These are already parameterized — the rule-ID dispatch is redundant.

### Target shape

Replace `combat-rule` with three distinct effect types
(`combat-attacker-chooses-defenders`, `combat-multi-attack`,
`combat-cancel-attack-by-tap`) or keep one effect with a closed enum and
drop the string-compare. The reducer dispatches on effect type, not
on an opaque string.

### Steps

1. Narrow the `rule: string` field to a closed union of the three known
   values, or split into three effect types.
2. Update the three reducer sites to dispatch on type, not on string
   equality.
3. Update card JSON (tw-008 Cave-drake, tw-020 / tw-074 creatures, etc.)
   accordingly.

### Risk

Low. Mechanical refactor.

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

## Sequencing

Recommended order:

1. **#1 grant-action** — biggest win (6 card-specific handlers
   collapse to one). Unblocks #4.
2. **#4 constraint collapse** — depends on #1's `remove-constraint`
   apply kind.
3. **#2 play-restriction** — independent; can run in parallel with #1
   if desired. Higher file count but lower per-file risk.
4. **#3 combat-rule** — lowest priority, mechanical cleanup.

Each step is its own PR with card-test coverage on the cards it
touches, so regressions surface immediately in the nightly suite.
