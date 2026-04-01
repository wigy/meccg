Verify a card's playability by checking that all effects defined on the card are supported by the game engine.

The card ID argument is: $ARGUMENTS

If no card ID is given, stop and ask for one (e.g. `/certify-card tw-156`).

Follow these steps:

1. **Load the card:** Read the card definition from the appropriate data file in `packages/shared/src/data/`. The card ID prefix indicates the set (tw-, le-, as-, wh-, ba-). If the card is not found, report it and stop.

2. **Generate DSL effects from card text:** Read the card's `text` field (the official rules text). Using `docs/card-effects-dsl.md` as the reference for all supported effect types, conditions, and value expressions, generate the complete `effects` array that faithfully represents every rule and ability described in the card text. Compare the generated effects with the card's existing `effects` array. If the card has no `effects` array yet, or if the existing effects are missing rules from the text, update the card's data JSON file with the correct effects. Show what was added or changed.

3. **List the card's effects:** Show the card name, card type, and all effects defined in the card's `effects` array. For each effect, show its `type` and a brief summary of what it does (condition, value, etc.).

4. **Check each effect against engine support:** For each effect, verify it is actually handled by the game engine. The current implementation status is:

   **Fully implemented:**
   - `stat-modifier` — prowess, body, direct-influence, corruption-points modifiers with value expressions, max caps, and override mechanism (`packages/shared/src/engine/effects/resolver.ts`). Direct-influence modifiers are also resolved during faction-influence-check (in `reducer.ts` and `site.ts`) and influence-check (in `organization.ts` `availableDI`).
   - `check-modifier` — bonus/penalty to corruption, faction-influence checks (`resolver.ts`)
   - `company-modifier` — applies stat modifiers to all characters in bearer's company (`resolver.ts`)
   - `duplication-limit` — prevents multiple copies in scope "game" (`packages/shared/src/engine/reducer.ts`)

   **Partially implemented:**
   - `mp-modifier` — works for elimination pile with numeric values only; expression strings are ignored (`packages/shared/src/engine/recompute-derived.ts`)
   - `on-event` — infrastructure exists but `matchesTrigger()` is stubbed to always return false; no triggers fire (`packages/shared/src/engine/chain-reducer.ts`). Exception: `self-enters-play` with `discard-cards-in-play` is implemented directly in the reducer play handlers for permanent events (`packages/shared/src/engine/reducer.ts`)
   - `play-restriction` — only "no-hazard-limit" and "playable-as-resource" rules are implemented (`packages/shared/src/engine/reducer.ts`)
   - `combat-rule` — only "attacker-chooses-defenders" is implemented

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

   - **YES** — all effects are fully implemented
   - **PARTIALLY** — some effects work, some don't (card is playable but some abilities won't function)
   - **NO** — core effects (like play-restriction) are missing, card cannot work correctly

   For partially/no cases, explain specifically what won't work and what would need to be implemented.

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

12. **Verify everything passes:** Run `npm run build`, `npm run lint`, `npm test`, and `npm run test:nightly` in parallel. Fix any type errors, lint violations, test failures, or new nightly test failures. Repeat until all four pass cleanly. If `npm run lint` fails, try `npm run lint:fix` first.

13. **Certify on success:** If the result is **YES** (all effects fully implemented, or no effects) AND a complete card test exists with no `test.todo()` gaps, set the `certified` field on the card definition in its data JSON file to today's date (ISO 8601 format, e.g. `"2026-03-28"`). This records when the card was last verified as engine-compatible and fully tested. If the card was already certified, update the date. If the result is PARTIALLY or NO, or tests are incomplete, remove any existing `certified` field.
