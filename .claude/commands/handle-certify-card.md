Verify a card's playability by checking that all effects defined on the card are supported by the game engine.

The card ID argument is: $ARGUMENTS

If no card ID is given, stop and ask for one (e.g. `/certify-card tw-156`).

## Core principle — read before every certification

**NEVER mark a card `certified` unless it is FULLY playable.** "Fully" means every sentence of the card's printed text is implemented in the engine AND exercised by the card test with real assertions. Partial certification does not exist.

If **any** of the following are true, the card MUST NOT receive a `certified` date — land the partial work (data fixes, test scaffolding) under a PR description that explicitly says "NOT CERTIFIED", and stop:

- A rule on the card text is not implemented in the engine.
- A rule is "documented as deferred", "stubbed", "TODO", or "will be implemented later".
- An effect in the `effects` array maps to a NOT-IMPLEMENTED or type-only entry in step 4.
- For a site: the card text describes a special rule (auto-attack variant, playability override, hazard-limit tweak, hoard gate, etc.) that is not captured in `effects` AND not handled by existing engine code.
- The test uses `test.todo()` for any rule, or skips a rule the card text describes.
- You are tempted to write in the commit message that some mechanic is "deferred / not yet supported / engine-wide work".

When in doubt: **do not certify**. A false-certified card poisons the certification signal for every other card. An uncertified card with a good partial test is always recoverable later.

Follow these steps:

1. **Load the card:** Read the card definition from the appropriate data file in `packages/shared/src/data/`. The card ID prefix indicates the set (tw-, le-, as-, wh-, ba-). If the card is not found, report it and stop.

2. **Generate DSL effects from card text:** Read the card's `text` field (the official rules text). Using `docs/card-effects-dsl.md` as the reference for all supported effect types, conditions, and value expressions, generate the complete `effects` array that faithfully represents every rule and ability described in the card text. Compare the generated effects with the card's existing `effects` array. If the card has no `effects` array yet, or if the existing effects are missing rules from the text, update the card's data JSON file with the correct effects. Show what was added or changed.

2a. **For hazard creatures, verify keying against the canonical `playable` string.** The card's *text* does not always repeat the cost; the authoritative cost is `attributes.playable` in `data/cards.json`. Look up the card there (IDs are uppercase, e.g. `LE-69`) and read `attributes.playable`. Each token is one keying requirement:

   - Lowercase region tokens are **region types**: `{w}` wilderness, `{s}` shadow-land, `{d}` dark-domain, `{b}` border-land, `{f}` free-domain, `{c}` coastal-sea. **Count matters**: `{w}{w}` means two wildernesses in the path; `{w}{w}{w}` means three. Repeat the enum value in `regionTypes` once per token.
   - Uppercase site tokens are **site types**: `{R}` ruins-and-lairs, `{S}` shadow-hold, `{D}` dark-hold, `{B}` border-hold, `{F}` free-hold, `{H}` haven.
   - Text clauses like "may also be played keyed to Shadow-lands [{s}]", "If Doors of Night is in play, may also be played keyed to…" are **additional alternative entries** in `keyedTo`, each typically gated by a `when` condition. The *base* cost from `playable` must always appear as its own entry — do not drop or fold it into the alt clause.
   - Named-region and named-site clauses ("keyed to Grey Mountain Narrows, Iron Hills…", "may also be played at Moria") map to `regionNames` / specific site lookups, not region/site types.

   Cross-check the resulting `keyedTo` against `playable` token-by-token before proceeding. A common mistake is encoding `{w}{w}` as `regionTypes: ["wilderness"]` (a single wilderness instead of two) because the text only repeats the alt clause, not the base cost.

3. **List the card's effects:** Show the card name, card type, and all effects defined in the card's `effects` array. For each effect, show its `type` and a brief summary of what it does (condition, value, etc.).

4. **Check each effect against engine support:** For each effect, verify it is actually handled by the game engine. The current implementation status is:

   **Fully implemented:**
   - `stat-modifier` — prowess, body, direct-influence, corruption-points modifiers with value expressions, max caps, and override mechanism (`packages/shared/src/engine/effects/resolver.ts`). Direct-influence modifiers are also resolved during faction-influence-check (in `reducer.ts` and `site.ts`) and influence-check (in `organization.ts` `availableDI`).
   - `check-modifier` — bonus/penalty to corruption, faction-influence checks (`resolver.ts`). For corruption-check resolutions the modifier is collected from attached hazards **and** items (`legal-actions/pending.ts`), with a context exposing `source.keywords` (the keywords on the card that enqueued the check) so items can gate on "spell", "ritual", etc.
   - `company-modifier` — applies stat modifiers to all characters in bearer's company (`resolver.ts`)
   - `duplication-limit` — prevents multiple copies in scope "game" (`packages/shared/src/engine/reducer.ts`)

   **Partially implemented:**
   - `mp-modifier` — works for elimination pile with numeric values only; expression strings are ignored (`packages/shared/src/engine/recompute-derived.ts`)
   - `on-event` — infrastructure exists but `matchesTrigger()` is stubbed to always return false; no triggers fire (`packages/shared/src/engine/chain-reducer.ts`). Exception: `self-enters-play` with `discard-cards-in-play` is implemented directly in the reducer play handlers for permanent events (`packages/shared/src/engine/reducer.ts`)
   - `play-restriction` — only "no-hazard-limit" and "playable-as-resource" rules are implemented (`packages/shared/src/engine/reducer.ts`)
   - Combat-rule effects — `combat-attacker-chooses-defenders`, `combat-multi-attack`, and `combat-cancel-attack-by-tap` are implemented

   **Not implemented (type-only):**
   - `enemy-modifier` — no engine code
   - `hand-size-modifier` — hard-coded HAND_SIZE constant used everywhere
   - `grant-action` — no engine code
   - `cancel-strike` — no engine code

5. **Check conditions:** For each effect with a `when` condition, verify that the condition uses only supported operators and context paths. All operators ($includes, $gt, $gte, $lt, $lte, $ne, $in, $and, $or, $not) are implemented in `packages/shared/src/effects/condition-matcher.ts`. Check that the context paths referenced (e.g. `bearer.race`, `enemy.race`) are actually populated by the resolver.

6. **Check value expressions:** For effects with expression strings (e.g. `"max": "bearer.baseProwess * 2"`), verify the expression uses context variables that are actually provided by `packages/shared/src/engine/effects/resolver.ts`.

7. **Report:** Produce a summary table:

   ```
   Card: <name> (<id>)
   Type: <cardType>
   Effects: <count>

   | # | Effect Type      | Status          | Notes                          |
   |---|------------------|-----------------|--------------------------------|
   | 1 | stat-modifier    | OK              | +3 prowess, max 8              |
   | 2 | stat-modifier    | OK              | +3 prowess vs Orcs, max 9      |
   | 3 | on-event         | NOT IMPLEMENTED | triggers not firing yet         |
   | 4 | cancel-strike    | NOT IMPLEMENTED | no engine support               |

   Playable: YES / PARTIALLY / NO
   ```

   - **YES** — every effect is fully implemented AND every rule in the card's text is captured by an effect (or by structural engine support for sites). No deferred/stubbed pieces anywhere.
   - **PARTIALLY** — some effects work, some don't, OR the card text describes rules not represented in the `effects` array / not covered by engine support. The card cannot be certified.
   - **NO** — core effects (like play-restriction) are missing, card cannot work correctly. The card cannot be certified.

   For partially/no cases, explain specifically what won't work and what would need to be implemented. **Only YES is eligible for certification in step 13.** If you are about to classify something as YES but also write "the X rule is deferred" or "engine doesn't support Y yet" anywhere in your report/commit — the correct classification is PARTIALLY, not YES.

8. **If the card is a site** (hero-site, minion-site, fallen-wizard-site, balrog-site), check site-specific properties:

   **Structural checks (always verifiable from data):**
   - `siteType` is a valid type (haven, shadow-hold, free-hold, border-hold, ruins-and-lairs)
   - `automaticAttacks` entries have creatureType, strikes, and prowess
   - `playableResources` entries are valid subtypes (minor, major, greater, gold-ring, information)
   - `resourceDraws` and `hazardDraws` are present and reasonable (1-3)
   - For havens: `havenPaths` exists and maps to other havens with region-type arrays; `sitePath` is empty; `nearestHaven` is empty
   - For non-havens: `nearestHaven` names a valid haven in the card pool; `sitePath` is non-empty with valid region types (wilderness, border, free, coastal, shadow, dark, double-wilderness, double-shadow-land, double-coastal-sea)

   **Engine support checks:**
   - Basic site phase flow (select-company, enter-or-skip, play-resources): **implemented**
   - Item playability based on `playableResources`: **implemented**
   - Ally/faction playability at sites: **implemented**
   - Haven path usage for movement: **implemented** (movement-map.ts)
   - Automatic attacks triggering combat: **not implemented** (stubbed — pass through)
   - Special text-based rules (e.g. "hazard limit increased by 2", "healing effects affect all characters"): check whether the rule is captured in `effects`. If the card text describes rules NOT in the `effects` array, list them as **unimplemented special rules**

   Include the site-specific findings in the report table alongside any effects.

9. **If the card has no effects and is not a site:** Report that the card has no special effects and is fully playable (basic stats like prowess/body are always handled by the engine).

10. **Implement missing engine support:** If the report shows PARTIALLY or NO, implement the missing engine rules needed for this card's effects to work. Follow existing patterns in the engine code (resolver, reducer, legal-actions). Update the implementation status list in this command file if you add support for a new effect type or extend a partially-implemented one. If you cannot implement the required engine support, report that handling the certification request failed and explain why.

11. **Implement card test:** A complete card test MUST exist in `packages/shared/src/tests/cards/` for this card. The test file must cover every rule and special ability described in the card's text with real assertions (no `test.todo()`). If no test exists or the existing test is incomplete, **write or complete the test yourself** — do not just report what's missing. Follow the patterns from existing card tests in the same directory. If you cannot implement the test (e.g. the engine lacks required support), report that handling the certification request failed and explain why.

    **NEVER write tautological tests.** Do NOT add test blocks that load a card definition via `pool[ID]` and then `expect` its fields (`cardType`, `id`, `name`, `strikes`, `prowess`, `body`, `unique`, `race`, `effects[i].type`, `keyedTo`, `extended`, etc.) to match values that are literally in the card JSON. Those assertions verify JSON data against itself and prove nothing. Every test must build a game state, drive the reducer or legal-action computation, and assert on resulting state/actions. Document card shape in the module-level JSDoc comment, not in tests.

12. **Verify tests pass (blocking, in-turn):** Run these checks **sequentially as foreground Bash calls**, waiting for each to finish before the next:

    1. `npm run build` — type-check.
    2. `npx vitest run packages/shared/src/tests/cards/<cardId>.test.ts` — the card's own test file.
    3. `npm test` — full rules test suite.
    4. `npm run lint` — ESLint. If it fails, first try `npm run lint:fix`, re-run `npm run lint`, and only hand-fix what remains. The branch CI runs this exact command and will go red if you skip it.
    5. `npm run test:nightly` — card tests. Must not introduce new failures compared to master. The branch CI runs this too.

    ⚠️ **Do NOT use `run_in_background=true` for any of these.** Each one must complete within the tool call that started it. The nightly suite is the slowest — budget for it, don't skip it.

    ⚠️ **Do NOT end your turn while any of these is still running or unstarted.** If you post an interim message like "waiting for tests…" and stop calling tools, the hosting session ends and steps 13–14 never execute, leaving your work orphaned in the working tree.

    Fix any failures and re-run until all five pass. Do not open the PR until every one is green — a red CI on a freshly-opened certify PR blocks the whole inbox and wastes a human round-trip.

13. **Certify on success — strict gate:** Before writing `"certified": "<date>"` on a card, ALL of the following must hold. If any one fails, **do not add the field** (and remove it if it was already present):

    - Step 7 classification is **YES** (not PARTIALLY, not NO).
    - Every rule in the card's `text` is represented either by an implemented effect in `effects[]` or by structural engine support (for sites: siteType, playableResources, haven paths, basic auto-attack list, etc.).
    - For sites specifically: no "unimplemented special rule" was identified in step 8. Dynamic auto-attack variants (e.g. "opponent plays a creature from hand as this site's auto-attack"), playability overrides, or hazard/corruption tweaks that the engine does not handle are **disqualifying** — even if the rest of the site data is correct.
    - The card test covers every rule in the text with real assertions. No `test.todo()`, no skipped rule, no "future work" comment substituting for coverage.
    - Your commit message does not contain words like "deferred", "stubbed", "not yet supported", "engine-wide work needed", or similar about any card rule. If it does, you are certifying something you shouldn't.

    If all five hold, set the `certified` field to today's date (ISO 8601 format, e.g. `"2026-03-28"`). If the card was already certified, update the date. Otherwise remove any existing `certified` field and make sure the PR title/body says the card is **NOT CERTIFIED** and names the missing mechanic.

    After writing the field, **run this shell command and confirm it returns a line** before proceeding:

    ```sh
    grep '"certified"' packages/shared/src/data/<set-file>.json
    ```

    If the grep returns nothing, you did not write the field — go back and write it now. Do not open the PR until this check passes.

14. **Create branch and open PR:** ⚠️ **MANDATORY — do NOT commit to master.** All certification changes include test files, and CLAUDE.md requires all test changes to go through a PR. You MUST:
    - Create a branch named `certify-<cardId>-<card-slug>` (e.g. `certify-tw-243-gates-of-morning`)
    - Commit all changes to that branch
    - Push the branch to origin
    - Open a pull request using `gh pr create`
    - Report the PR URL and the git hash of the commit

    ⚠️ **The working tree MUST be clean before your turn ends.** The mail handler checks `git status --porcelain` after your session and treats any uncommitted change as a certification failure — the user will be told you abandoned the work mid-step. Nothing is stashed: the leftover files stay in place and the run-ai loop refuses to handle any further mail until a human either opens a PR for them or reverts. One aborted turn blocks every subsequent AI request, not just yours.

    If, despite the guidance above, you find yourself about to end the turn with uncommitted changes, commit them to the certify branch first (even if tests/lint haven't finished — a PR with follow-up commits is always recoverable; an orphaned diff on master is not). If you genuinely cannot land the work (engine support missing, rules unclear, etc.), revert everything (`git checkout -- .`, delete any new files) before ending the turn and emit a certification-failure result.

    Never merge directly to master. This is a hard requirement.
