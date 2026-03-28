Verify a card's playability by checking that all effects defined on the card are supported by the game engine.

The card ID argument is: $ARGUMENTS

If no card ID is given, stop and ask for one (e.g. `/certify-card tw-156`).

Follow these steps:

1. **Load the card:** Read the card definition from the appropriate data file in `packages/shared/src/data/`. The card ID prefix indicates the set (tw-, le-, as-, wh-, ba-). If the card is not found, report it and stop.

2. **List the card's effects:** Show the card name, card type, and all effects defined in the card's `effects` array. For each effect, show its `type` and a brief summary of what it does (condition, value, etc.).

3. **Check each effect against engine support:** For each effect, verify it is actually handled by the game engine. The current implementation status is:

   **Fully implemented:**
   - `stat-modifier` — prowess, body, direct-influence, corruption-points modifiers with value expressions, max caps, and override mechanism (`packages/shared/src/engine/effects/resolver.ts`)
   - `check-modifier` — bonus/penalty to corruption, faction-influence checks (`resolver.ts`)
   - `company-modifier` — applies stat modifiers to all characters in bearer's company (`resolver.ts`)
   - `duplication-limit` — prevents multiple copies in scope "game" (`packages/shared/src/engine/reducer.ts`)

   **Partially implemented:**
   - `mp-modifier` — works for elimination pile with numeric values only; expression strings are ignored (`packages/shared/src/engine/recompute-derived.ts`)
   - `on-event` — infrastructure exists but `matchesTrigger()` is stubbed to always return false; no triggers fire (`packages/shared/src/engine/chain-reducer.ts`)
   - `play-restriction` — only "no-hazard-limit" and "playable-as-resource" rules are implemented (`packages/shared/src/engine/reducer.ts`)
   - `combat-rule` — only "attacker-chooses-defenders" is implemented

   **Not implemented (type-only):**
   - `enemy-modifier` — no engine code
   - `hand-size-modifier` — hard-coded HAND_SIZE constant used everywhere
   - `grant-action` — no engine code
   - `cancel-strike` — no engine code

4. **Check conditions:** For each effect with a `when` condition, verify that the condition uses only supported operators and context paths. All operators ($includes, $gt, $gte, $lt, $lte, $ne, $in, $and, $or, $not) are implemented in `packages/shared/src/effects/condition-matcher.ts`. Check that the context paths referenced (e.g. `bearer.race`, `enemy.race`) are actually populated by the resolver.

5. **Check value expressions:** For effects with expression strings (e.g. `"max": "bearer.baseProwess * 2"`), verify the expression uses context variables that are actually provided by `packages/shared/src/engine/effects/resolver.ts`.

6. **Report:** Produce a summary table:

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

7. **If the card is a site** (hero-site, minion-site, fallen-wizard-site, balrog-site), check site-specific properties:

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

8. **If the card has no effects and is not a site:** Report that the card has no special effects and is fully playable (basic stats like prowess/body are always handled by the engine).

9. **Check card test:** Verify that a complete card test exists in `packages/shared/src/tests/cards/` for this card. The test file should cover every rule and special ability described in the card's text. If no test exists, or the test has `test.todo()` entries for untested rules, the card cannot be certified — report what's missing and stop (do not set `certified`).

10. **Certify on success:** If the result is **YES** (all effects fully implemented, or no effects) AND a complete card test exists with no `test.todo()` gaps, set the `certified` field on the card definition in its data JSON file to today's date (ISO 8601 format, e.g. `"2026-03-28"`). This records when the card was last verified as engine-compatible and fully tested. If the card was already certified, update the date. If the result is PARTIALLY or NO, or tests are incomplete, remove any existing `certified` field.
