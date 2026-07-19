Verify a card's playability by checking that all effects defined on the card are supported by the game engine.

The card ID argument is: $ARGUMENTS

If no card ID is given, stop and ask for one (e.g. `/certify-card tw-156`).

## Core principle — read before every certification

Certification's job is to make the card **FULLY playable and then certify it.** "Fully" means every sentence of the card's printed text is implemented in the engine AND exercised by the card test with real assertions. Partial certification does not exist.

**When a rule on the card is not yet supported, IMPLEMENT IT.** Building the missing engine mechanic is the heart of this skill — never an optional extra, never something to defer to "engine-wide work later." Do NOT open a "NOT CERTIFIED — needs engine support" PR and stop; that is the exact failure mode this process exists to prevent. If the mechanic is shared by many cards, that is precisely when to build it properly as a reusable DSL primitive.

Each of the following means **you still have work to do (go implement it), not that the card is un-certifiable:**

- A rule on the card text is not implemented in the engine.
- A rule would otherwise be "documented as deferred", "stubbed", "TODO", or "implemented later".
- An effect in the `effects` array maps to a NOT-IMPLEMENTED or type-only entry in step 4.
- For a site: the card text describes a special rule (auto-attack variant, playability override, hazard-limit tweak, hoard gate, etc.) not captured in `effects` AND not handled by existing engine code.

**NEVER false-certify.** Implementing a mechanic means implementing it for real (engine + a card test that will pass in CI) — never stubbing it, never `test.todo()`, never certifying with the rule unhandled. A false-certified card poisons the certification signal for every other card.

The ONLY acceptable reason to stop without certifying is a blocker that needs a **human decision** — a genuinely ambiguous rule that needs wigy's ruling, or card text that contradicts the data. "This is a lot of work" is not such a reason. When you must stop, name the exact question for the human; never dress up "I didn't implement it" as "not certifiable."

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

4. **Check each effect against engine support:** Read `docs/certification-engine-support.md` — the engine-support catalog. It lists every DSL effect type the engine implements (**Fully implemented**, **Partially implemented**, **Not implemented (type-only)**) together with the precedent set by each card certified so far. For each effect on this card, find the matching entry and verify the engine really handles it.

   The catalog is deliberately kept OUT of this prompt: it grows by one entry per certified card, and when it was inline it pushed this prompt past the 128KB single-argument `execve` limit, breaking every certification. Read it as a file; do not paste it back in here.

   An effect that maps to a **Not implemented** / type-only entry, or to no entry at all, is NOT a reason to stop — it is step 10 work. Go implement it.
5. **Check conditions:** For each effect with a `when` condition, verify that the condition uses only supported operators and context paths. All operators ($includes, $gt, $gte, $lt, $lte, $ne, $in, $exists, $noConsecutiveOtherThan, $and, $or, $not) are implemented in `packages/shared/src/effects/condition-matcher.ts`. `$exists` is a presence test (`{ "$exists": false }` matches an absent/undefined field — e.g. `lairOf`/`adjacentSites` to exclude Dragon's lairs / Under-deeps sites). Check that the context paths referenced (e.g. `bearer.race`, `enemy.race`) are actually populated by the resolver.

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

   For partially/no cases, explain specifically what won't work and what would need to be implemented. **Only YES is eligible for certification in step 15.** If you are about to classify something as YES but also write "the X rule is deferred" or "engine doesn't support Y yet" anywhere in your report/commit — the correct classification is PARTIALLY, not YES.

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
   - Automatic attacks triggering combat: **implemented** (`reducer-site.ts` initiates each `automaticAttacks[]` entry as a combat; supports multiple sequential attacks, `body`, and `combatRules`: `attacker-chooses-defenders`, `each-character`, `cannot-be-canceled`, `wound-eliminates`, `weapons-ineffective`)
   - Covert/overt site guardians (MELE): **implemented** (`reducer-site.ts`). An `automaticAttacks[]` entry may carry `appliesTo: "overt" | "covert"` — the attack is skipped for a company of the other status (e.g. Minas Tirith le-391's Dúnedain attack "against overt company only"), preserving printed-list indices. A "(detainment against covert company)" attack carries **no** `appliesTo` (overt companies still face it as a regular attack); its detainment is a `combat-detainment` site effect gated on `defender.covert`, with the company's covert status threaded into `isDetainmentAttack` as `defendingCovert`.
   - Special text-based rules (e.g. "hazard limit increased by 2", "healing effects affect all characters"): check whether the rule is captured in `effects`. If the card text describes rules NOT in the `effects` array, list them as **unimplemented special rules**

   Include the site-specific findings in the report table alongside any effects.

9. **If the card has no effects and is not a site:** Report that the card has no special effects and is fully playable (basic stats like prowess/body are always handled by the engine).

10. **Implement missing engine support — MANDATORY:** If the report shows PARTIALLY or NO, implement the missing engine rules so the card becomes fully playable. This is the core of certification, not an optional step and never something to defer. Follow existing patterns in the engine code (resolver, reducer, legal-actions); when the mechanic is shared by other cards, build it as a reusable DSL primitive rather than a one-off. Whenever you add or extend an effect type, record it in the engine-support catalog at `docs/certification-engine-support.md` — add or update the entry there, **never in this command file** (an inline catalog is what once grew this prompt past the 128KB `execve` argument limit and broke every certification). Keep the new entry to the essentials so the catalog stays readable. Do NOT skip this step or fall back to a "NOT CERTIFIED" PR — the only reason to stop is a genuine human-decision blocker (an ambiguous rule needing wigy's ruling), which you must state concretely.

11. **Implement card test:** A complete card test MUST exist in `packages/shared/src/tests/cards/` for this card. The test file must cover every rule and special ability described in the card's text with real assertions (no `test.todo()`). If no test exists or the existing test is incomplete, **write or complete the test yourself** — do not just report what's missing. Follow the patterns from existing card tests in the same directory. If the engine lacks support the test needs, that means step 10 is not finished — go back and implement the support; do not report failure or write a partial test.

    **NEVER write tautological tests.** Do NOT add test blocks that load a card definition via `pool[ID]` and then `expect` its fields (`cardType`, `id`, `name`, `strikes`, `prowess`, `body`, `unique`, `race`, `effects[i].type`, `keyedTo`, `extended`, etc.) to match values that are literally in the card JSON. Those assertions verify JSON data against itself and prove nothing. Every test must build a game state, drive the reducer or legal-action computation, and assert on resulting state/actions. Document card shape in the module-level JSDoc comment, not in tests.

**⚠️ Ordering principle for steps 12–14 — FINISH THE WORK, THEN LAND ONE PR.** Certification produces a single, finished pull request whose title states the outcome. There is **no intermediate "verifying" PR**, and you never open a PR you intend to retitle later. You implement everything the card needs (step 10), write and commit the card's own test (step 11), set the `certified` field (step 13), and only then open the PR — once — with its final title (step 14). **Do not run the full test suite, lint, or the nightly card tests, and do not gate the PR on any of them: confirming CI is green is the reviewer's and branch CI's job, not yours.** You write the card's test and commit it; you do not have to prove it green in-turn. If your turn dies before you open the PR, the mail handler finalizes your uncommitted work into a fallback PR — so leftover work is never lost and the loop is never blocked. That backstop is the safety net; it is **not** a licence to open a premature "verifying" PR.

12. **Quick build gate (in-turn):** Run `npm run build` as a foreground Bash call and wait for it to finish. This is the only check that must pass *before* you commit, because broken TypeScript should never reach a branch. If it fails, fix it and re-run until green. (It is fast — do not skip ahead.)

13. **Set the `certified` field — the certify decision:** Now that the card is fully implemented (step 10) and its test written (step 11), decide: certify, or — rarely — stop for a genuine human-decision blocker. Certify only if ALL of the following hold. **If any one fails, you are not done implementing: return to step 10.** Do NOT fall back to a NOT-CERTIFIED PR unless the blocker genuinely needs a human ruling.

    - Step 7 classification is **YES** (not PARTIALLY, not NO).
    - Every rule in the card's `text` is represented either by an implemented effect in `effects[]` or by structural engine support (for sites: siteType, playableResources, haven paths, basic auto-attack list, etc.).
    - For sites specifically: no "unimplemented special rule" remains from step 8. Dynamic auto-attack variants (e.g. "opponent plays a creature from hand as this site's auto-attack"), playability overrides, or hazard/corruption tweaks the engine does not handle must have been **implemented** in step 10 — an unimplemented one means go back, not bail.
    - The card test covers every rule in the text with real assertions. No `test.todo()`, no skipped rule, no "future work" comment substituting for coverage.
    - Your commit message does not contain words like "deferred", "stubbed", "not yet supported", or "engine-wide work needed" about any card rule.

    If all hold, set the `certified` field to today's date (ISO 8601 format, e.g. `"2026-03-28"`), then **run this shell command and confirm it returns a line**:

    ```sh
    grep '"certified"' packages/shared/src/data/<set-file>.json
    ```

    If the grep returns nothing, you did not write the field — write it now.

14. **Branch, commit, push, open ONE final PR — the last action:** ⚠️ **Do NOT commit to master.** Only now do you create the PR, and you create it **once**, already in its final state:

    - Create a branch named `certify-<cardId>-<card-slug>` (e.g. `certify-tw-243-gates-of-morning`).
    - `git add -A`, commit with a clean message describing the implementation, and push the branch to origin.
    - Open the PR with `gh pr create`, titled with the **final outcome** — never a placeholder:
      - certified → `certify <cardId>: <name> — certified`
      - blocked on a human decision only → `certify <cardId>: <name> — NOT CERTIFIED: <one-line concrete reason>`
    - **Never** title a PR "verifying" or "verification pending", and never open a PR you intend to retitle later. The PR is finished when you open it.
    - **Do NOT run the full `npm test` suite, `npm run lint`, or `npm run test:nightly`, and do NOT gate the PR on them.** Confirming CI is green is the reviewer's and branch CI's job — you wrote the card's test and committed it; that is your part.
    - Verify the title landed and report it, along with the final commit hash and PR URL:

    ```sh
    gh pr view <pr-number> --json title --jq .title
    ```

    ⚠️ **Leave the working tree clean before your turn ends.** The mail handler checks `git status --porcelain` after your session; any uncommitted change is finalized by the handler into a fallback PR rather than your own clean one. If you genuinely cannot land the work (blocked on a human decision), revert everything (`git checkout -- .`, delete any new files) before ending the turn and emit a certification-failure result naming the concrete question — never leave files uncommitted.

    Never merge directly to master. This is a hard requirement.
