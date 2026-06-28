# Architecture Roadmap

A prioritized roadmap of **larger structural improvements** to `@meccg/shared`,
produced by a multi-lens architectural review on 2026-06-28 (module cohesion,
the effects/DSL pipeline, dispatch patterns, type modeling, layering/coupling,
the state model, and test architecture). Each lens deep-read the relevant code;
the top candidates were then adversarially stress-tested for "is the pain real,
is there a simpler change, does it fight a project convention." Those caveats
are folded in below.

This is distinct from the line-level dedup work (the ~19 small
behaviour-preserving helper-extraction PRs): everything here changes *shape*,
not just removes duplicate lines.

## Overall assessment

This is a **healthy, well-architected codebase**, not a rescue job. The debt is
narrow and concentrated, and most of it is *finishing migrations the project
already started and specced*.

What is already good:

- Cross-package layering is clean — `game-server` / `text-client` /
  `lobby-server` import only the `@meccg/shared` public barrel; no reducer/rules
  logic leaks into the browser UI.
- The top-level `reduce()` / `computeLegalActions()` dispatch is generic and
  tidy; the movement/hazard step uses a clean `MH_STEP_HANDLERS` map.
- `GameState` is coherent and exceptionally well-documented; the
  `activeConstraints` / `pendingResolutions` unification was a real improvement.
- The **declarative** half of the card DSL (`CardEffect` discriminated union →
  `engine/effects/resolver.ts` → `effects/condition-matcher.ts` →
  `expression-eval.ts`) is exemplary "cards are data": one union, one uniform
  resolution pipeline, one MongoDB-style matcher reused everywhere.

Where the debt concentrates:

1. The **imperative** half of the DSL (the `TriggeredAction` "apply" verbs that
   drive events, grant-actions, and chain resolution) never received the
   discriminated-union + single-dispatcher treatment its declarative sibling
   has. The same ~28 apply types are hand-coded across ~58 switch arms in 9
   files, and the dispatcher migration is half-built and stalled
   (`apply-dispatcher.ts` is explicitly "Phase A", handling 3 of ~104 types).
2. Four engine **god-modules** bundle multiple concerns: `reducer-combat.ts`
   (~4772 lines), `reducer-movement-hazard.ts` (~3840), `chain-reducer.ts`
   (~2879), `pending-reducers.ts` (~2626), plus the `types/effects.ts` DSL type
   model (~3911).
3. The whole `@meccg/shared` package is **one import cycle** (strongly-connected
   component): 59 engine files import the top barrel that re-exports them.
4. **65% of the test suite — the card tests — never runs in CI**, so a
   DSL/resolver change can break dozens of cards and still merge green.

## Concrete bugs surfaced (fix regardless of the refactors)

The review turned up correctness issues worth fixing on their own:

- **Trophy "no-disappear" violation.** `handleTakeTrophy` stores captured
  creatures only in `CharacterInPlay.trophies`, but `resolveInstanceId`
  (`types/state.ts`) never walks `trophies` (nor `hazardHosts.hostCard` /
  `rescueSiteCard`, nor the setup `draftState` zones). Those instances become
  permanently unresolvable, violating the load-bearing "no card instance may
  ever disappear" invariant. Fix: add the missing zones to `resolveInstanceId`
  and add a test/dev-only `assertEveryInstanceReachable(state)` that diffs
  minted instances against it.
- **Two latent bugs from the earlier dedup scan** (still open, need test-backed
  fix PRs): the corruption-check double hazard-dispatch in
  `reducer-free-council.ts` `resolveCorruptionCheck`, and the dropped-hazard
  bug in `reducer-site.ts` `discardInfluencedCard`.

## Guiding principle

> Finish the half-built migrations and protect the investment with cheap guards,
> rather than starting new grand rewrites. The biggest single lever is making
> the imperative DSL as data-driven as the declarative one, so new event / grant
> cards become pure JSON with zero engine edits.

## Roadmap

Effort: **S** < ~half a day, **M**, **L**, **XL** > several days. Each entry
carries the adversarial caveat / simpler-alternative where the challenge pass
trimmed the original proposal.

### P01 — CI-gate the card tests (do first)

- **Effort / risk:** S / low. **Kind:** tooling (no production code).
- **Evidence:** CI runs only `npm test`, which excludes `src/tests/cards/**` —
  ~65% of the ~4744-test suite. The suite is green on master (4725 pass) and
  runs in ~3.3 min.
- **Change:** run `npm run test:nightly` as a per-PR CI job.
- **Simpler alternative (preferred):** skip the proposed cron + path-filter; just
  run the nightly suite unconditionally on every PR (a path-filter is a
  correctness-gate footgun — card behaviour can break from changes outside
  `data/`/`effects/`/resolver and still merge green).
- **Payoff:** turns the largest part of the test investment into a real
  regression gate. **This protects every DSL/engine item below — do it before
  P05–P08.**

### P03 — Fix the trophy bug + add an instance-reachability invariant

- **Effort / risk:** S–M / low. **Kind:** behaviour-preserving + bug fix.
- **Change:** add the missing zones (trophies, `hazardHosts` cards, setup draft
  zones) to `resolveInstanceId`; add `assertEveryInstanceReachable(state)` as a
  test/dev-only check and run it across the suite to surface any other gaps.
- **Caveat (from challenge):** do **only** this kernel. Do **not** route the
  game-server projection redaction through a new "zone registry" — projection
  applies conditional, phase-gated visibility a static descriptor can't express,
  and rewriting the redaction boundary risks leaking hidden information. The
  registry would be a single-consumer abstraction dressed as a tri-consumer one.
- **Payoff:** fixes a live invariant violation and makes "no card disappears"
  machine-checkable instead of convention-checked.

### P02 — Break the engine↔barrel import cycle + add a lint guard

- **Effort / risk:** L / low. **Kind:** behaviour-preserving.
- **Evidence:** 59 engine files import `../index.js` / `../../index.js` while
  `index.ts` re-exports those same modules → the whole package is one SCC. The
  symbols pulled (`shuffle`, `Phase`, `getPlayerIndex`, `isSiteCard`,
  `matchesContext`) all live in dependency-free leaf modules.
- **Simpler alternative (preferred):** repoint only the runtime **value** imports
  to their leaf modules (`Phase`/`CardStatus` → `types/`, `shuffle` → `rng.js`,
  `getPlayerIndex`/`setupStepContext` → `state-utils.js`, matchers →
  `effects/`), which breaks the actual runtime cycle. Enforce with a native
  ESLint `no-restricted-imports` rule banning `index.js` inside `engine/` (zero
  new deps). Leave the type-only inline `import('...')` refs alone (erased at
  compile time); run `madge` as a one-off/CI check rather than wiring
  `import/no-cycle` into the hot pre-push path.
- **Payoff:** an honest, greppable dependency graph; removes a latent
  imported-before-initialised bug class; the guard keeps later splits (P09) from
  silently re-tangling. Do before P09.

### P04 — Split the `types/effects.ts` DSL god-module by effect family

- **Effort / risk:** M / low. **Kind:** behaviour-preserving (types only).
- **Evidence:** ~3911 lines, ~104 effect interfaces, ~18 cohesive families,
  imported by ~32 files; it is the repo's #1 hot file.
- **Change:** move the interfaces into `types/effects/{conditions, stat-mp,
  grant-trigger, combat, site-rules, agent, move}.ts` with an `index.ts` that
  re-exports everything and assembles the terminal `CardEffect` /
  `SiteRuleEffect` unions; keep the public import path (`types/effects.js`)
  identical.
- **Caveat (from challenge):** do it as **one atomic PR in a quiet window**, not
  family-by-family — the file has ~20 in-flight branches and incremental splits
  maximise merge conflicts. `EffectBase` (currently non-exported) must move to a
  `base.ts`. The assembled union in `index.ts` becomes the new shared edit point,
  so the collision win is partial.
- **Payoff:** each family becomes navigable/ownable; de-risks P05 (which lives
  here).

### P10 — Typed phase/kind accessors

- **Effort / risk:** L / low. **Kind:** behaviour-preserving.
- **Evidence:** ~49 unchecked `phaseState as XPhaseState` casts that silently lie
  if a handler runs in the wrong phase; `PendingResolution.kind` (22) and
  `ActiveConstraint.kind` (37) are anonymous inline mega-unions narrowed by
  find-then-cast at 40+ sites.
- **Change:** add `requirePhaseState<P>(state, phase)` (the `setupStepContext`
  pattern already blessed in-house); name each `kind` member interface; add
  generic `findResolution<T>` / `findConstraint<T>` that narrow via `Extract`.
- **Payoff:** turns silent wrong-phase bugs into clean early-returns; named
  members make handlers extractable as typed functions (enables P07/P08); reuses
  an already-approved pattern (no design buy-in needed).

### P12 — Branded-id records + lint-ban reflexive `as string`

- **Effort / risk:** M / low. **Kind:** behaviour-preserving.
- **Evidence:** ~1349 reflexive `as string` casts on already-branded ids in the
  engine; id-keyed records typed `Record<string, V>` accept any string key, so
  indexing `characters` with a `CompanyId` is a silent bug today.
- **Change:** introduce `ById<V> = Readonly<Record<CardInstanceId, V>>` (and
  `CompanyId`/`PlayerId` variants), apply to the id-keyed records, delete the now
  unnecessary casts, add a lint rule banning `as string` on branded expressions.
- **Payoff:** wrong-id-type indexing becomes a compile error; restores the
  signal value of genuine casts.

### P05 — `TriggeredAction` → discriminated union (prerequisite for P06)

- **Effort / risk:** L / medium. **Kind:** behaviour-preserving.
- **Evidence:** the one DSL "apply/verb" payload still a `type: string` bag with
  ~58 optional fields; none of the dispatch arms narrow, every field read is
  unchecked.
- **Change:** one small interface per verb (`AddConstraintApply`, `ForceCheck`,
  `RollThenApply`, `SetCharacterStatus`, `Sequence`, `Move`, …) unioned with a
  literal `type`; convert dispatch if-chains to exhaustive switches; delete the
  structural `.apply as {...}` casts. Migrate one verb-family per PR, starting
  with `add-constraint`.
- **Caveat (from challenge):** the "this validates card JSON" justification is
  **false** — card data is imported via `as unknown as CardDefinition[]`
  (`data/index.ts`), which erases structural checking. Bill this honestly as
  internal type hygiene + the prerequisite that makes P06 mechanical. If
  validating card JSON is the real goal, add a runtime `zod`/`ajv` validator at
  load time instead (separate, smaller change).
- **Payoff:** the union becomes the single source of truth replacing ~300 lines
  of "For X type:" prose; exhaustiveness across the 9 dispatch sites.

### P06 — Finish the stalled apply-effect dispatcher (the biggest lever)

- **Effort / risk:** XL / medium. **Kind:** design change.
- **Evidence:** `apply-dispatcher.ts` (~150 lines) handles only 3 effect types
  at one call site, while `resolveEntry` (~680 lines, grown from 6 to ~18
  bespoke branches) and ~58 switch arms across 9 files reimplement the same ~28
  apply types with divergent semantics — so a card can behave differently
  depending on which path runs it. The migration is fully specced in
  `specs/2026-04-23-chain-effect-dispatch-plan.md` (Phases A+B already landed).
- **Change:** grow `applyEffect` into the one write-side registry keyed by apply
  type (`Record<ApplyType, ApplyHandler>` returning `{ state, needsInput?,
  effects? }`, built on P05's union); make `runGrantApply`, the chain
  self-enters-play loop, `applyShortEventArrivalTrigger`, the `reducer-events`
  option arms, and combat triggers thin callers; card tests are the parity
  oracle.
- **Caveat (from challenge):** the proposal's stated first step is wrong —
  `parseConstraintScope` / `buildConstraintKind` already exist as shared
  functions. Do the high-value, low-risk slice: make the generic `applyEffect`
  loop the spine so the file stops accreting; do Phase D (arrival /
  self-enters-play, no `move` dependency); add a generic enqueue-roll/check apply
  type (collapses the ~7 roll/check branches). **Defer** the move-dependent
  phases and **leave** the ~3 combat-handoff branches (creature / Tidings /
  Cruel Caradhras) bespoke.
- **Payoff:** new event/short/long-event and grant cards become pure JSON with
  zero engine edits; eliminates `resolveEntry` and per-path drift. Directly
  realises the cards-as-data invariant. **Do P01 first** (card tests are the
  oracle).

### P07 — Pending-resolution handler registry

- **Effort / risk:** L / medium. **Kind:** behaviour-preserving.
- **Evidence:** `pending-reducers.ts` (~2626) and `legal-actions/pending.ts`
  (~1901) re-list the same 22 resolution kinds as case labels that must stay in
  lockstep — a kind's two halves live ~700 lines apart and can drift. Separately,
  `reduce()` hardcodes a 24-element `combatActionTypes` array duplicating the
  combat switch (forgetting an entry silently misroutes), and
  `applyOneConstraint` is a 37-case switch where 35 cases are no-ops.
- **Change:** `const PENDING_HANDLERS: { [K in PendingKind['type']]: Handler<K> }`
  (mapped type enforces exhaustiveness), one small module per kind under
  `engine/pending/`; the two big files become thin dispatchers + shared helpers.
  Export the combat/chain routing sets from their handler modules; replace the
  dead constraint switch with a `Partial<Record<...>>` filter table.
- **Payoff:** each kind self-contained; adding one touches one module + one
  registry line; the legal-action and reducer halves can no longer drift.

### P08 — Generic dice-check primitive

- **Effort / risk:** L / medium. **Kind:** design change.
- **Evidence:** ~11 roll-vs-threshold resolution kinds (muster, call-of-home,
  seized-by-terror, body-check, gold-ring, glamour-hazard, …) share byte-for-byte
  scaffolding (validate, `roll2d6`, store `lastDiceRoll`, dequeue, compare, chain
  re-entry); only the consequence differs, and consequences are already
  expressible as `TriggeredAction`.
- **Change:** one generic roll-check resolution kind + one DSL effect + one
  resolve-roll action carrying `{ roller, dice, modifiers, threshold, comparison,
  onPass, onFail }`, with outcomes resolved via the existing resolver. Keep
  genuinely-different kinds (corruption-check table lookup, faction-influence UI
  banner) bespoke.
- **Sequencing:** after P06/P07 so it lands on the unified apply + handler
  registry. **Caveat:** keep the resolver generic — do not let it drift into a
  per-card union.
- **Payoff:** a new die-roll card drops from a 5-file/~80-line change to a few
  lines of JSON; removes ~700 lines of duplicated scaffolding and shrinks the
  `PendingResolution` union.

### P09 — Decompose the combat / movement-hazard god-modules

- **Effort / risk:** L / medium. **Kind:** behaviour-preserving.
- **Evidence:** `reducer-combat.ts` (~4772) and `reducer-movement-hazard.ts`
  (~3840) already have clean dispatch but bundle 4+ concerns; `finalizeCombat`
  is one ~790-line function doing 6 separable jobs. Confirmed value cycles:
  `chain-reducer` imports `currentHazardLimit` from `reducer-movement-hazard`;
  `reducer-organization` ↔ `reducer-events` import each other.
- **Change:** extract cohesive sub-modules (`combat-cancel`, `combat-finalize`,
  `combat-strike-resolution`; `mh-agents`, `mh-hazard-play`, `mh-progression`,
  `mh-movement`); turn `finalizeCombat` into a readable pipeline; move shared
  seams (`currentHazardLimit`, event-play/grant) into neutral lower-layer modules
  to invert the cycles.
- **Sequencing:** after P02 (so the cycle-inversion is lint-enforced).
- **Payoff:** the most-feared, most-edited code becomes sub-1.5k single-purpose
  files; the two confirmed cycles vanish.

### P11 — Site-flag constraint primitive + typed constraint queries

- **Effort / risk:** L / medium. **Kind:** design change.
- **Evidence:** `ActiveConstraint` has 37 kinds, 9 of which are the same
  "flag matched by `siteDefinitionId`, read at one site" shape — the per-card
  branch growth the cards-as-data convention exists to prevent. 42 ad-hoc
  `activeConstraints.filter/find` scans across 26 files each re-derive narrowing
  by hand.
- **Change:** fold the 9 site-keyed flags into one parameterised `site-flag`
  constraint (following the existing `attribute-modifier` precedent that folded 3
  former kinds); add `constraintsOfKind` / `constraintsTargeting` / `siteFlag`
  accessors and route the 42 scans through them.
- **Sequencing:** builds on P06's constraint factory and P10's named members.
- **Payoff:** shrinks the union, makes new site-modifier cards mostly data,
  eliminates the "added a kind, missed a read-site" bug class.

### P13 — Test-harness modernization

- **Effort / risk:** L / low. **Kind:** design change (tests only).
- **Evidence:** `test-helpers.ts` is ~3730 lines imported by 816/926 test files
  (a merge-conflict magnet under the no-rebase/no-amend workflow); board setup is
  copy-pasted per test; 431 unsafe `.action as {...}` casts hand-roll union
  narrowing.
- **Change:** split `test-helpers.ts` into a `tests/helpers/` directory behind a
  pure re-export barrel (zero import churn); add a composable `scenario()`
  builder over `buildTestState`; add a typed `findViableAction` /
  `viableActionsOfType` query layer; migrate the 431 cast sites incrementally,
  then lint-ban `.action as`.
- **Payoff:** new tests read as spec (a few lines) instead of board plumbing;
  typo'd action types / stale field names become compile errors; lowers the cost
  of growing the suite that everything else leans on as a parity oracle.

## Recommended sequencing

1. **Guards first:** P01 (CI-gate card tests), P03 (trophy bug + invariant),
   P02 (value-import cycle break + lint). Cheap, low-risk, and they protect
   everything after.
2. **Type & module prep:** P04 (atomic `effects.ts` split), P10 (typed
   accessors), P12 (branded-id records). Low-risk, and they de-risk the DSL work.
3. **The DSL unification:** P05 → P06 → P07 → P08, in that order. P05 makes P06
   mechanical; P06 is the central lever; P07/P08 ride on the unified
   infrastructure.
4. **Then:** P09 (god-module split, after P02), P11 (site-flag primitive, after
   P06/P10), P13 (test harness, any time — it helps all of the above).

## Notes

- Source: multi-lens architectural review workflow (2026-06-28), 7 analysis
  lenses + synthesis + adversarial challenge of the top 6 proposals.
- Nothing here is implemented yet — this is a planning document for review and
  prioritisation. The small behaviour-preserving dedup PRs are tracked
  separately.
