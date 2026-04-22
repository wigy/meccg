# Detainment Attacks — Implementation Plan

## Context

"Detainment" is a combat modifier in MECCG: a detainment attack cannot wound or
eliminate defending characters — on any strike outcome that would normally
wound or eliminate, the character is **tapped** instead, and **no body check**
is rolled. Detainment also suppresses "when wounded" passive conditions, and
defeated detainment creatures are worth **0 MP** (discarded instead of placed
in the attacked player's MP pile; trophies from them score 0 kill-MP).

The engine is roughly 40% there:

- `CombatState.detainment: boolean` already exists — `packages/shared/src/types/state-combat.ts:146`.
- `reducer-combat.ts:347-371` already substitutes `CardStatus.Tapped` for
  `CardStatus.Inverted` when `combat.detainment === true` and a strike result
  is `'wounded'`.
- But the flag is hard-coded `false` at every combat-initiation site
  (`reducer-site.ts:380,447`, `reducer-movement-hazard.ts:1507`,
  `chain-reducer.ts:1064`), so detainment never actually activates in play.
- The reducer still transitions to `phase: 'body-check'` when
  `detainment=true` and the strike was wounded (`reducer-combat.ts:304,
  377-378`), contradicting rule 3.II.1 ("no body checks are initiated").
- Three rule-stub test files already exist
  (`rule-8.32-detainment-attacks.test.ts`,
  `rule-8.33-minion-detainment-rules.test.ts`,
  `rule-8.34-detainment-creature-mp.test.ts`), each containing a single
  catch-all `test.todo(...)`. `test-helpers.ts::makeBodyCheckCombat` already
  accepts a `detainment?: boolean` override.

This plan covers the full rules-engine implementation plus the rules-as-spec
test coverage in one landing. Sources: `docs/coe-rules.md` §3.II (lines
1010–1033), §3.IV.2 (line 1071), glossary line 1654.

## Implementation

### 1. DSL primitive — `combat-detainment`

Add a new zero-field effect type so a creature/hazard card can declare its
own attack detainment (rule 3.II.2: "or depends on an effect of the attack
itself").

- **File:** `packages/shared/src/types/effects.ts` — append
  `CombatDetainmentEffect extends EffectBase { readonly type: 'combat-detainment' }`
  and add it to the `CardEffect` union. Follow the pattern of the other
  `combat-*` effects (`combat-multi-attack`,
  `combat-attacker-chooses-defenders`, `combat-cancel-attack-by-tap`) already
  in that file.
- **File:** `docs/card-effects-dsl.md` — append a §12 entry
  `combat-detainment` (no fields) under existing combat-rules effects with a
  one-line note: "Marks the attack as detainment (CoE §3.II). Suppresses
  wound/body-check and zeros MP for defeated creature."

No resolver is required — the effect is a marker read by the detection
helper below.

### 2. Detainment-detection helper

Add a pure function that returns whether an attack is detainment, consulting
the attack source, the defending company, the defending player's alignment,
and whether the attack is an automatic-attack.

- **New file:** `packages/shared/src/engine/combat/detainment.ts`
  exporting `isDetainmentAttack(ctx)` where `ctx` carries:
  - `attackEffects: readonly CardEffect[]` (creature/hazard card effects)
  - `attackRace: CreatureRace | null`
  - `attackKeying: { regionTypes, siteTypes, keyedByName }` derived from the
    creature/site definition
  - `defendingAlignment: Alignment` (hero / minion / fallen-wizard /
    fallen-wizard-minion / balrog)
  - `defendingCompanyLocation: { region, site }` (resolved)
  - `isAgentHazard: boolean`
  - `isNazgulAttack: boolean`
  - `isAutomaticAttack: boolean`
- Decision tree, in order:
  1. If any `combat-detainment` effect on the attack → `true` (rule 3.II.2
     "effect of the attack itself").
  2. If `defendingAlignment === 'minion'` and `isNazgulAttack` and
     `!isAutomaticAttack` → `true` (rule 3.II.4).
  3. If `defendingAlignment` is `'minion'` (Ringwraith player) or
     `'balrog'`:
     - **3.II.2.R1/B1:** attack keyed to Dark-domain / Dark-hold /
       Shadow-hold / Darkhaven region/site (including keyed-by-name) →
       `true`.
     - **3.II.2.R2/B2:** attack race ∈ {Orc, Troll, Undead, Man} and keyed
       to Shadow-land region (including keyed-by-name) → `true`.
     - **3.II.2.R3/B3:** `isAgentHazard` → `true`.
  4. Default → `false`.
- Log every branch via `logDetail` from
  `src/engine/legal-actions/log.ts` per the server-side logging policy.

### 3. Wire the flag at combat-initiation sites

Replace the hard-coded `detainment: false` at every call site with a call to
`isDetainmentAttack(...)`.

- `packages/shared/src/engine/reducer-site.ts:380,447` — site automatic-attack
  initiation.
- `packages/shared/src/engine/reducer-movement-hazard.ts:1507` — hazard
  creature play.
- `packages/shared/src/engine/chain-reducer.ts:1064` — chain-resolved creature
  attack entry (`resolveCreatureChainEntry`).

Each site already has access to the creature definition and the defending
company; thread through `isAutomaticAttack` (true at the site call sites,
false at the chain-resolved hazard call sites — verify per CoE §3.II.4
"unless the attack is an automatic-attack"). Agent-hazard detection reads an
existing `tag: 'agent'` on the hazard card if present; otherwise add the tag
on the small handful of agent hazards.

### 4. Body-check suppression fix (rule 3.II.1)

`reducer-combat.ts:296-309` currently sets `bodyCheckTarget = 'character'`
and `result = 'wounded'` whenever `characterTotal < strikeProwess`, and line
377 then transitions to `phase: 'body-check'` regardless of detainment.

Change: when `combat.detainment === true` and `result === 'wounded'`, do
**not** set `bodyCheckTarget`. The existing lines 366-371 already apply
`CardStatus.Tapped`; with the body-check skipped, the strike advances via
`nextStrikePhase` exactly like a no-body-check outcome. Log the
suppression: `logDetail('Strike succeeds — detainment: character tapped, no
body check')`.

Preserve the creature-body-check path: rule 3.II.1 suppresses the
*character* body check only, not the creature body check on a successful
defender roll (line 300).

### 5. Wound-passive suppression (rule 3.II.1.1)

Rule 3.II.1.1 says the defending character "is not considered to have been
wounded" — so `on-wounded` passive conditions must not fire.

- **File:** wherever the engine currently publishes a "character was
  wounded" signal (grep for `wasWounded` / `on-wounded` triggers during
  implementation — most likely in `reducer-combat.ts` right after the status
  mutation at lines 348/364).
- Under detainment, skip emitting the wounded trigger. The strike assignment
  field `wasAlreadyWounded` (which tracks the pre-strike state, not the
  outcome) stays untouched.

### 6. MP / discard split (rule 3.II.3)

`finalizeCombat` (bottom of `reducer-combat.ts`) currently routes defeated
creatures to the attacked player's MP pile unconditionally.

Change: if `combat.detainment === true` and the creature was defeated and at
least one strike was assigned, send the creature card to the **discard
pile** instead of the MP pile. If zero strikes were assigned (rule 3.II.3
requires "at least one strike assigned" before the discard rule applies),
fall back to the existing cancelled-attack routing — no trophy, no discard,
just the card leaving combat per existing paths.

### 7. Trophy MP zeroing (rule 3.IV.2)

A defeated detainment creature may still be taken as a trophy by an Orc or
Troll under §3.IV.1 (which has no detainment exclusion); §3.IV.2 says such
trophies are worth 0 kill-MP at scoring time.

- **File:** wherever trophy MP is tallied (grep for `trophy` /
  `marshallingPoints` during implementation). Add a `wasDetainment: boolean`
  field to the `Trophy` type and set it when the trophy is claimed. Scoring
  reads this flag and returns 0 instead of the creature's printed MP.
- Preserve §3.IV.3 attribute bonuses (+DI / +prowess based on *printed* MP):
  those use the printed number, not the scoring value, so they are
  unaffected.

### 8. Test implementation

Replace the single `test.todo` in each stub file with the full test list
below, implemented as real `test(...)` calls (not `test.todo`). Each test
follows the house pattern: build a minimal state via `test-helpers.ts`
fixtures → call `reduce()` with the action sequence → assert on
`CombatState` / `PlayerData.characters`. The `/* RULING: */` block at the
top of each file stays; quote the new sub-sentences verbatim.

#### `rule-8.32-detainment-attacks.test.ts` (§3.II.1 + §3.II.1.1)

1. **3.II.1** — Failed strike under detainment taps the character instead
   of wounding it (`status === CardStatus.Tapped`, not `Inverted`).
2. **3.II.1** — Failed strike under detainment: `combat.phase` advances to
   `nextStrikePhase`, **not** `'body-check'`.
3. **3.II.1** — Successful strike under detainment vs a bodied creature:
   creature body check still runs (`phase === 'body-check'`,
   `bodyCheckTarget === 'creature'`).
4. **3.II.1** — Tied strike under detainment still taps the character (no
   change from non-detainment tie behaviour).
5. **3.II.1.1** — An `on-wounded` passive (wired via a test-fixture probe
   item) does **not** trigger when the strike would normally wound but the
   attack is detainment.
6. **3.II.1.1** — A character already `Inverted` hit by a detainment strike
   is **not** re-wounded/eliminated: the strike fails/taps harmlessly and
   no body check runs.
7. **3.II.2** — Setting either a `combat-detainment` card effect **or** a
   §3.II.2.Rx/Bx condition flips `combat.detainment` at combat start (union
   anchor; individual branches covered in 8.33).

#### `rule-8.33-minion-detainment-rules.test.ts` (§3.II.2.R`*` and §3.II.2.B`*`)

1. **3.II.2.R1** `[MINION]` — Ringwraith company attacked by a creature
   keyed to Dark-domain / Dark-hold / Shadow-hold / Darkhaven →
   `combat.detainment === true`.
2. **3.II.2.R1** `[MINION]` — same when the creature is keyed *by name* to
   a region/site of those types.
3. **3.II.2.R2** `[MINION]` — Ringwraith company attacked by Orc / Troll /
   Undead / Man keyed to a Shadow-land → detainment; likewise for
   keyed-by-name-to-Shadow-land region.
4. **3.II.2.R3** `[MINION]` — Agent hazard attack → detainment.
5. **3.II.2.B1 / B2 / B3** `[BALROG]` — three tests mirroring R1, R2, R3
   for a Balrog company.
6. **3.II.2** negative — Ringwraith/Balrog company attacked by a
   non-matching-race creature keyed to a Shadow-land (e.g. a Dragon) →
   **not** detainment.
7. **3.II.2** negative — Wizard/Hero company at a Dark-domain site → **not**
   auto-detained (the R/B conditionals don't apply).

#### `rule-8.34-detainment-creature-mp.test.ts` (§3.II.3 + §3.II.4)

1. **3.II.3** — Creature defeated on a non-detainment attack → card in
   attacked player's MP pile (baseline control).
2. **3.II.3** — Creature defeated on a detainment attack with ≥1 strike
   assigned → card in discard pile, MP total unchanged.
3. **3.II.3** — Detainment creature where zero strikes were assigned →
   follows existing cancelled-attack routing (no discard, no trophy).
4. **3.II.4** — Nazgûl non-automatic attack vs minion company → detainment.
5. **3.II.4** — Nazgûl automatic-attack vs minion company → **not**
   detainment (unless an effect overrides).
6. **3.II.4** — Nazgûl attack vs hero / fallen-wizard company → **not**
   auto-detainment.

#### `rule-8.37-trophies.test.ts` (§3.IV.2 cross-reference)

1. **3.IV.2** — Detainment-creature trophy on an Orc/Troll character is
   worth **0 MP** at scoring time (cross-link to §3.II.3); §3.IV.3
   printed-MP attribute bonuses on the same trophy are unaffected.

Test authoring notes:

- Reuse `makeBodyCheckCombat({ detainment: true, ... })` from
  `test-helpers.ts` for the strike-outcome tests — it already accepts the
  flag.
- For the §3.II.2 tests, build the full company/site/creature via
  `buildTestState` and drive the combat-initiation action so
  `isDetainmentAttack` actually runs (not just the state shortcut).
- Use minion fixtures (AS/LE card IDs) for Ringwraith tests and balrog
  fixtures (BA) for Balrog tests per the "match fixtures to alignment"
  rule in CLAUDE.md.
- All helpers live in `test-helpers.ts`; no `function` declarations in the
  test files (per `feedback_no_helpers_in_tests`).

## Critical Files

Edit:

- `packages/shared/src/types/effects.ts` — add `CombatDetainmentEffect`.
- `packages/shared/src/engine/combat/detainment.ts` — **new**,
  `isDetainmentAttack` helper.
- `packages/shared/src/engine/reducer-combat.ts` — body-check suppression
  (~line 296-309, 377-378); wound-passive suppression; MP/discard split in
  `finalizeCombat`.
- `packages/shared/src/engine/reducer-site.ts` — wire `isDetainmentAttack`
  at lines 380, 447.
- `packages/shared/src/engine/reducer-movement-hazard.ts` — wire at line
  1507.
- `packages/shared/src/engine/chain-reducer.ts` — wire at line 1064.
- Wherever trophies and kill-MP scoring live (locate during implementation;
  grep `trophy`, `marshallingPoints`).
- `packages/shared/src/tests/rules/08-combat/rule-8.32-detainment-attacks.test.ts`
- `packages/shared/src/tests/rules/08-combat/rule-8.33-minion-detainment-rules.test.ts`
- `packages/shared/src/tests/rules/08-combat/rule-8.34-detainment-creature-mp.test.ts`
- `packages/shared/src/tests/rules/08-combat/rule-8.37-trophies.test.ts`
- `docs/card-effects-dsl.md`

Read-only references:

- `packages/shared/src/tests/test-helpers.ts` —
  `makeBodyCheckCombat(detainment?: boolean)`, `buildTestState`,
  `findCharInstanceId`, `viableActions`.
- `packages/shared/src/types/state-combat.ts:141-146` — existing
  `detainment` field JSDoc (good anchor for test comments).
- `docs/coe-rules.md:1010-1033, 1071, 1654` — ruling source to quote
  verbatim in each test's leading `/* RULING: */` comment block.

## Verification

Run all five pre-push checks in parallel and fix any failures:

1. `npm run build` — type-check passes (new effect type in union, new
   helper module, modified reducers).
2. `npm test` — rules tests pass, including all ~21 new detainment tests.
3. `npm run test:nightly` — no new card-test regressions (existing cards
   shouldn't be touched; verify that non-detainment attacks still route
   MP/wound correctly as a sanity baseline).
4. `npm run lint` — lint clean.
5. `npm run lint:md` — markdown clean (includes the DSL-doc append).

Smoke-check scenarios manually via the text client
(`npm run start -w @meccg/game-server -- Alice Bob`):

- Start a Ringwraith deck, move to a Dark-domain site, trigger a
  Dark-domain-keyed creature — confirm wound results in tap, no body check
  dialog, and the creature discards (not MP-piles) on defeat.
- Start a hero deck at the same Dark-domain site — confirm normal
  wound/body-check behaviour (regression guard for §3.II.2 negative
  branch).
- Draw a Nazgûl as a non-automatic attack vs a minion company — confirm
  detainment; then as an automatic-attack — confirm normal wounding.
