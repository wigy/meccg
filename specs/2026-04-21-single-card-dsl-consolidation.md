# Single-card DSL keyword consolidation

Audit of DSL keywords with 0-1 card fan-out and concrete plan to
remove the engine branches they carry. Follows up on
`2026-04-13-dsl-generalization-plan.md` — that spec marks several
items done, but a per-keyword grep (2026-04-21) shows a long tail of
action IDs, apply kinds, and on-event types that are still matched by
string literal in the engine despite being referenced by zero or one
cards.

## Guiding principle

A keyword that appears in both (a) the card JSON and (b) a
string-literal comparison in the engine, where only one card emits it,
is worse than useless — it inflates the type surface, fans out switch
statements, and blocks the next card's certification from being pure
data. If the behaviour decomposes into existing primitives, the
keyword must go.

## Audit findings (2026-04-21)

Card counts verified by grepping `packages/shared/src/data/*.json`;
engine cost measured against `packages/shared/src/engine/`.

### Zero-card keywords (dead code)

Corrected 2026-04-21 after re-grepping `packages/shared/src/data/`.
Four of the five keywords originally listed here are **in use** and
were reported as dead by the first-pass audit in error:

- `no-creature-hazards-on-company` — used by Stealth (`tw-resources.json`).
- `deny-scout-resources` — used by a dm-creature (`dm-creatures.json`).
- `site-path` (play-condition `requires`) — used in `dm-hazards.json`
  for *Two or Three Tribes Present*.
- `discard-named-card` (play-condition `requires`) — used in
  `tw-resources.json`.

Only one keyword is genuinely unreferenced:

| Keyword | Kind | Status |
|---|---|---|
| `site-phase-do-nothing-unless-ranger-taps` | constraint | Already removed from `packages/shared/src/` in the River migration that introduced `site-phase-do-nothing` + `cancelWhen`. No engine, test, or card-JSON references remain. |

Only residue: a single enumeration in `docs/card-effects-dsl.md`
(cleaned up on 2026-04-21) and references in historical specs
(`2026-04-08-pending-effects-plan.md`, `2026-04-13-dsl-generalization-plan.md`
§4) — both preserved as history. A frozen dev snapshot at
`packages/game-server/data/dev/snapshots/001.json` also contains an
inert pre-migration copy of the River card pool; it is replay data,
not reached by the live engine.

**Step 1 outcome**: docs-only cleanup, no engine diff. The ~90 LOC
reduction forecast was wrong — previous migrations had already done
the work.

### Single-card `grant-action` IDs

Each of these carries a precondition + cost + apply in a per-ID engine
branch. The 2026-04-13 plan §1 introduced generic `when` / `apply` on
`grant-action`, but the ID-based switch path is still alive alongside
it.

| ID | Card(s) | Decomposition |
|---|---|---|
| `gwaihir-special-movement` | Gwaihir (tw-251) | discard-self + add-constraint(movement-flag) |
| `untap-bearer` | Cram (td-105) | discard-self + set-character-status(bearer, untapped) |
| `extra-region-movement` | Cram (td-105) | discard-self + add-constraint(extra-region) |
| `saruman-fetch-spell` | Saruman (tw-181) | tap-self + enqueue-pending-fetch(filter=spell) |
| `cancel-return-and-site-tap` | Promptings of Wisdom (wh-34) | tap-bearer + add-constraint + force-check |
| `stinker-discard-with-ring` | Stinker (le-154) | discard-self + discard-in-play-matching(name="The One Ring", scope=bearer-site) |
| `test-gold-ring` | Gandalf (tw-156) | tap-self + enqueue gold-ring-test |
| `palantir-fetch-discard` | Palantír of Orthanc (tw-300), The Mouth (le-24) | tap-self + enqueue-pending-fetch + force-check |
| `company-prowess-boost` | Orc-draughts (le-328), The Mouth (le-24) | discard-self + add-constraint(company-stat-modifier) |
| `recall-to-deck` | The Mouth (le-24) | already uses generic apply — template for the rest |

Combined ~80 LOC of per-ID plumbing across `reducer-organization.ts`,
`legal-actions/organization.ts`, `reducer-end-of-turn.ts`.

### Single-card top-level effect types

| Effect type | Card | Engine LOC | Notes |
|---|---|---|---|
| `discard-named-card-from-company` | Stinker (le-154) | ~50 | Nested site/company/character traversal. Prime target for generalization. |
| `bounce-hazard-events` | Wizard Uncloaked (td-169) | ~10 | Could become a generic discard-matching with `target=opponent-hand`. |
| `call-council` | Sudden Call (le-235) | ~15 | Endgame transition — leave. |
| `reshuffle-self-from-hand` | Sudden Call (le-235) | ~10 | Safety valve — leave. |
| `call-of-home-check` | Call of Home (tw-18) | ~20 | Unique check shape — leave. |
| `dodge-strike` | Dodge (tw-209) | ~10 | Unique timing window — leave. |
| `creature-race-choice` | Two or Three Tribes Present (dm-97) | ~15 | Leave — no second card plausible soon. |
| `control-restriction` | Rebel-talk (le-132) | ~10 | Leave — cheap, cleanly scoped. |

### Single-card on-events

| Event | Card | Notes |
|---|---|---|
| `attack-not-defeated` | Little Snuffler (dm-108) | Leave — 10 LOC. |
| `end-of-company-mh` | Alone and Unadvised (as-24) | Collapse into `company-composition-changed` with `at-phase-end` filter. |
| `company-composition-changed` | Alone and Unadvised (as-24) | Keep — the general form. |
| `bearer-company-moves` | Align Palantír (tw-190) | Leave — natural shape, second card plausible. |

### Single-card site-rules

| Rule | Card | Notes |
|---|---|---|
| `attacks-not-detainment` | Moria (le-392) | Leave — already filter-driven, reuses detainment machinery. |
| `healing-affects-all` | Old Forest (tw-417) + Ioreth via `company-rule` | Leave — 10 LOC, cross-used by company-rule. |

---

## Work plan

Five steps, ordered by risk. Each is its own PR with card-test
coverage so regressions surface in the nightly suite.

### Step 1 — Delete dead keywords ✅ done (docs only)

Re-audit on 2026-04-21 found that four of the five keywords originally
listed are still in active use (see the corrected *Zero-card keywords*
table above). Only `site-phase-do-nothing-unless-ranger-taps` is
genuinely dead, and its engine code was already removed during an
earlier River migration. The remaining cleanup was a single stale
reference in `docs/card-effects-dsl.md` §`add-constraint`, removed in
the same 2026-04-21 pass.

Lesson for future audits: grep the JSON corpus manually — the
subagent's "0 cards" report was wrong on four keywords. The forecast
~90 LOC win for this step was illusory.

### Step 2 — Collapse `grant-action` ID enum ✅ done

Recon on 2026-04-21 found the migration was already ~95% complete
from earlier PRs. Every card in the migration list already carries an
explicit `apply` clause, and `GrantActionEffect.apply` is the actual
dispatch axis in `handleGrantActionApply`. The primitives the earlier
plan called for (`sequence`, `enqueue-pending-fetch` with full filter
support, `set-character-status`, `set-company-special-movement`,
`increment-company-extra-region-distance`, `roll-then-apply`,
`discard-named-card-from-company` apply, etc.) already existed.

What actually remained and was done in this PR:

1. **Deleted fall-through cruft in `reducer-organization.ts`** —
   ~30 LOC of `if (actionId === X)` branches that all routed to the
   same `handleGrantActionApply`.
2. **Converted `ANY_PHASE_GRANT_ACTIONS` hardcoded ID set to a
   card-declared `anyPhase: boolean` flag** on `GrantActionEffect`.
   Cram (td-105) and Orc-draughts (le-328) JSON now carry
   `"anyPhase": true`. The filter in `grantedActionActivations` now
   reads `effect.anyPhase` directly — no engine-side list of card IDs.
3. **Simplified per-phase reducer guards** in `reducer-site.ts`,
   `reducer-events.ts`, and `reducer-end-of-turn.ts`: each used to
   match a specific `actionId` literal as a whitelist; now they
   delegate any `activate-granted-action` to `handleGrantActionApply`
   and rely on the legal-action layer (authoritative) for
   phase-legality. Side benefit: fixes a latent bug where Orc-draughts'
   site-phase activation would have been rejected (site-phase
   reducer only accepted `untap-bearer` by literal match, but
   Orc-draughts is also `anyPhase`).

Net engine diff: ~50 LOC removed, 3 files simplified, one latent
reducer bug fixed. Card data gains one declared flag on two cards.
Saruman's spell-fetch filter and Gandalf's gold-ring target
enumeration still live in their respective legal-action emitters —
generalizing them (filter-on-move-target-from-discard-to-hand) would
be a speculative DSL extension and is deferred until a second card
needs it.

### Step 3 — Generalize `discard-named-card-from-company` ❌ skipped

Current apply already accepts a `cardName` string and performs the
correct bearer-site cross-player search. A filter-based
generalization was proposed but has no immediate consumer — Stinker
is the only card that needs this behaviour today. Adding a `filter` +
`scope` would increase DSL surface area for zero present benefit.
Deferred until a second card demands it.

The spec's claim that `discard-cards-in-play` and
`discard-non-special-items` could fold into the same primitive is
overstated: they live in different phase contexts (self-enters-play
vs character-wounded) with different entity reachability constraints.
Not worth unifying.

### Step 4 — Merge `end-of-company-mh` into `company-composition-changed`

Alone and Unadvised is the only card using either event. Add an
`at-phase-end: "company-mh"` filter to `company-composition-changed`
and route the existing per-region corruption-check enqueue logic
through it. Delete `end-of-company-mh` from the event union.

Expected diff: ~15 LOC removed from `reducer-movement-hazard.ts`,
one card JSON change, one card test verification.

### Step 5 — Reassess and stop

After Steps 1-4, re-run the single-card audit. The remaining single-
card keywords (`bounce-hazard-events`, `call-council`,
`reshuffle-self-from-hand`, `call-of-home-check`, `dodge-strike`,
`creature-race-choice`, `control-restriction`, `attack-not-defeated`,
`bearer-company-moves`, `attacks-not-detainment`) are either cheap
(<15 LOC) or express a semantically distinct primitive that doesn't
decompose. Do not generalize further without a second card demanding
it — speculative DSL surface is worse than duplication.

## Actual totals

| Step | Engine LOC change | Card JSON churn | Status |
|---|---|---|---|
| 1 | 0 (docs only; prior migration already swept the code) | 0 | ✅ done |
| 2 | −50 net (fall-through cruft + ID whitelist → card flag) | 2 (Cram, Orc-draughts gain `anyPhase`) | ✅ done |
| 3 | 0 (current apply is already generic enough) | 0 | ❌ skipped |
| 4 | 0 (events are semantically distinct) | 0 | ❌ skipped |
| **Total** | **≈ −50 LOC** | **2 cards** | |

Result was smaller than the forecast because prior PRs had already
done most of the heavy lifting. The remaining Step 2 work was pure
cleanup: removing fall-through dispatch, replacing a hardcoded ID
set with a card-declared flag, and simplifying per-phase reducer
guards that had drifted out of sync with the authoritative legal-
action layer (fixing one latent bug as a side effect).

## Explicit non-goals

- **Combat-rules quartet** (`combat-multi-attack`,
  `combat-attacker-chooses-defenders`, `combat-cancel-attack-by-tap`,
  `combat-one-strike-per-character`). These were already migrated to
  discriminated effect-types by the 2026-04-13 plan §3. Merging them
  back into a single `combat-rule` with a `rule` field is not a win —
  the current type-driven dispatch is more statically checked than a
  string tag would be, and each handler carries parameters (`count`,
  `maxCancels`) that differ per rule.
- **`dragon-at-home` / `ahunt-attack`** (9 + several dragons). Fan-out
  is large enough that these are genuine reusable primitives, not
  per-card keywords.
- **Adding speculative apply kinds** for cards that don't yet exist.
  Each new primitive is justified by an immediate in-tree consumer.

## Risk

Low for Step 1 (dead code). Medium for Step 2 (touches the
organization phase, the most heavily reducer-tested layer, but card
tests cover each ID-removal individually). Low for Steps 3-4 (isolated
to one or two reducers with dedicated card tests).

Mitigation throughout: keep the legacy path alive until each card's
test passes against the generic machinery, then delete in the same
commit that removes the ID from the type union.
