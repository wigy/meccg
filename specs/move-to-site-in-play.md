# Plan: Moving to a site in play

## Context

MECCG rule **2.II.7.2** permits a company to declare movement to a site card the resource player already has in play (because another of their companies is there). In that case, the destination site is **not** played from the site deck — the company targets the existing site instance, and that site must remain in play until the moving company's M/H phase ends.

The companion rule **2.II.7.1** forbids two companies from declaring movement *from the same site of origin to the same new site* during the same organization phase. This constraint barely fired before — under the old rules a destination drawn from the deck was already removed by the first declaration — but with 2.II.7.2 in place a second company at the same origin could otherwise also target the in-play site. Both rules must land together.

Today, `planMovementActions()` only offers destinations drawn from the player's `siteDeck`, so a player cannot move a second company to a site a sibling company already occupies even when the movement path is legal. This plan closes that gap and adds the same-origin/same-destination guard.

Scope: enable the in-play destination, commit the movement without double-touching `siteDeck`, enforce 2.II.7.1, and fix the symmetric end-of-M/H cleanup so a site of origin still occupied by a sibling stays in play instead of being returned to the deck.

## Affected files

- `packages/shared/src/engine/legal-actions/organization-companies.ts` — add in-play destinations.
- `packages/shared/src/engine/reducer-organization.ts` — `handlePlanMovement()` must not remove the site from the deck when the destination is already in play.
- `packages/shared/src/engine/reducer-movement-hazard.ts` — `currentSite` assignment at end of M/H must preserve the shared instance; skip origin return when a sibling still occupies it.
- `packages/shared/src/tests/rules/02-organization-phase/` — new rules tests for 2.II.7.1 and 2.II.7.2 (both legs).
- `packages/lobby-server/src/browser/render-piles.ts` — `openMovementViewer()` must list in-play destinations alongside deck cards with a distinct highlight.
- `packages/lobby-server/public/style.css` — new class for the in-play-destination highlight; reuse existing `.company-card--site-ghost` for the arrived-at-shared-site state.
- `docs/coe-rules.md` — no change (rule text already present).

## Existing code to reuse

- `planMovementActions()` — `organization-companies.ts:29` — current legal-action generator; extend rather than fork.
- `getReachableSites()` — called from `organization-companies.ts:29`; takes a candidate site definition and checks starter/region reachability from `company.currentSite`. Reusable as-is; we just feed it a different candidate pool.
- `handlePlanMovement()` — `reducer-organization.ts:1417` — keep the single entry point; branch on whether the destination instance is in `player.siteDeck` or in a sibling's `currentSite`.
- `SiteInPlay` type and `Company.siteCardOwned` flag (`state-cards.ts`) — reuse the existing shape. The `siteCardOwned=false` case was originally introduced for split-at-haven and is exactly what we need for a company arriving at a shared site.
- `resolveInstanceId` — already the canonical way to look up any `CardInstance`; use when validating the incoming `destinationSite` instance id.
- `openMovementViewer()` — `packages/lobby-server/src/browser/render-piles.ts:511` — the existing site-deck selector modal. It already paints `.site-selectable` (golden border + glow, reachable deck candidates) and `.site-dimmed` (greyed-out, unreachable). We extend its card list with in-play destinations.
- `company-site.ts:114–141` — already reads `siteCardOwned` and applies `.company-card--site-ghost` (defined at `public/style.css:3809`: 20% opacity, desaturated, dashed gold border). This gives the visual for the arrived-at-shared-site case for free.

## Implementation steps

0. **Save this plan** to `specs/move-to-site-in-play.md` in the repo (copy of this file, verbatim) so the plan is checked in alongside the code that implements it.

1. **Legal actions** (`organization-companies.ts`, inside `planMovementActions`):
   - After building the deck-based candidate list, walk `player.companies` and collect each **sibling** company's `currentSite` (skipping the company for which we're computing actions, and skipping any site already represented in the deck list to avoid duplicates).
   - For each sibling `currentSite`, call `getReachableSites`-style reachability against the active company's `currentSite`. If reachable, emit a `plan-movement` action with that `instanceId` as the destination. The reducer infers in-play vs deck at apply time (see step 2), so no extra flag on the action payload.
   - Do **not** emit if the sibling's site is the active company's own `currentSite` (moving-in-place is not a move).
   - **Rule 2.II.7.1 filter:** before emitting any `plan-movement` action (deck-based or in-play), drop any destination already chosen by another sibling company that shares this company's `currentSite` (i.e. another company at the same origin already has `destinationSite.instanceId === candidate.instanceId`). Apply this to **both** branches — deck destinations are normally protected because the first sibling already pulled the card from `siteDeck`, but the in-play branch needs the explicit check, and the deck branch needs it too for the rare case of a non-unique site with multiple copies.

2. **Reducer** (`reducer-organization.ts`, `handlePlanMovement`):
   - Look up the destination instance id. If it exists in `player.siteDeck`, keep the current code path (remove from deck, set `destinationSite`).
   - If it does **not** exist in `siteDeck` but matches the `currentSite` of another of the player's companies, set `company.destinationSite` to a fresh `SiteInPlay` carrying the same `instanceId`/`definitionId` (status `Untapped` — the moving company hasn't arrived yet; the sibling's own tap status is unaffected). Do not modify `siteDeck`.
   - If neither, reject (existing invariant).
   - **Rule 2.II.7.1 guard:** before applying either branch, reject if any sibling company sharing this company's `currentSite` already has `destinationSite.instanceId === action.destinationSite`. The legal-actions filter prevents the action from being offered, but the reducer must still defend against direct invocation.
   - Add a `logDetail` line for the in-play branch so traces show "destination already in play at sibling company N — not drawing from site deck", and a separate `logDetail` for the 2.II.7.1 rejection.

3. **M/H cleanup** (`reducer-movement-hazard.ts` around lines 457–478):
   - The block that sets `company.currentSite = destinationSite` is almost correct, but must now also set `siteCardOwned` correctly. Detect whether any other company of the same player already has `currentSite.instanceId === destinationSite.instanceId`: if yes, the moving company's `siteCardOwned` becomes `false` (reuses the split-at-haven "ghost" concept) so the UI paints it with `.company-card--site-ghost` for free; otherwise `siteCardOwned=true` as before.
   - **Origin cleanup fix:** before returning `siteOfOrigin` to `siteDeck` (or discarding it), check whether *any other company of the same player* still has `currentSite.instanceId === siteOfOrigin.instanceId`. If so, skip both the deck-return and the discard — the site stays in play under the sibling. The moving company's own `siteOfOrigin` field is still cleared (it has left).
   - Add `logDetail` lines for (a) the shared-arrival case ("arrived at site already in play at sibling company N — siteCardOwned=false") and (b) the skipped-cleanup case ("site of origin remains in play — still occupied by company N").

4. **Browser UI** (`packages/lobby-server/src/browser/render-piles.ts`, `public/style.css`):
   - In `openMovementViewer()`, after building the deck-card list, append cards representing the sibling in-play destinations the engine is offering. Source of truth: the `plan-movement` legal actions from the server already include the `destinationSite` instance id — resolve each one to its `SiteCard` definition via the existing card-pool lookup used by the viewer.
   - Apply a **new** CSS class `.site-in-play-selectable` (not `.site-selectable`) to these cards so they are visually distinguishable from deck-drawn playable sites. Requirements:
     - clearly selectable (mouse/tap affordance same as `.site-selectable`),
     - distinct border colour from the golden `.site-selectable` border (e.g. the same dashed-gold border already used by `.company-card--site-ghost`, or a solid contrasting colour like the UI's "shared" blue — pick whichever reads as "different but still active"),
     - same click handler as `.site-selectable` (emits the same `plan-movement` action; the server's legal-action list already includes it).
   - Add the new CSS rule alongside `.site-selectable` in `style.css`. Keep `.site-dimmed` behaviour unchanged for unreachable sites in either pool.
   - Add a small label/badge ("in play") on the in-play card in the modal so the treatment is readable without relying purely on colour. Reuse the existing pile-card label pattern if one exists; if not, a simple absolute-positioned span with an existing badge class is fine.
   - **Current-site visual:** no work needed. `company-site.ts:114–141` already branches on `siteCardOwned` and applies `.company-card--site-ghost`. Step 3 setting `siteCardOwned=false` for shared arrivals wires the visual automatically — identical to the split-company appearance.

5. **Rules tests** (`packages/shared/src/tests/rules/02-organization-phase/`):
   - **`rule-2.II.7.2-move-to-site-in-play.test.ts`:**
     - Build a state with two companies of the same player: company A at a site X (site X is A's `currentSite`, not in `siteDeck`), company B at haven, path from haven to X legal.
     - Call `computeLegalActions()` for B; assert a `plan-movement` action exists with `destinationSite = X.instanceId`.
     - Apply the reduce step; assert (a) `siteDeck` length unchanged, (b) `B.destinationSite.instanceId === X.instanceId`, (c) `A.currentSite` unchanged.
     - Walk through to end of M/H; assert both A and B have `currentSite.instanceId === X.instanceId`.
   - **`rule-2.II.7.1-no-duplicate-destination-from-same-origin.test.ts`:**
     - Build a state with two companies B and C both at the same haven (shared origin), and a third company A at site X (so X is in play and reachable from the haven).
     - Apply `plan-movement` for B targeting X.
     - Call `computeLegalActions()` for C; assert no `plan-movement` action targets X.
     - Try to invoke the reducer directly with C → X; assert it is rejected.
     - Negative control: a fourth company D at a *different* origin should still be allowed to plan movement to X (rule applies per-origin, not per-player).
   - **`rule-2.II.7.2-origin-stays-in-play.test.ts`** (origin-cleanup leg of 7.2):
     - Build a state with two companies A and B both at site X (X is `currentSite` of both — set up via prior turn or test fixture).
     - Plan and resolve movement for A to a different reachable site Y.
     - At end of A's M/H, assert: (a) A.`currentSite.instanceId === Y.instanceId`, (b) B.`currentSite.instanceId === X.instanceId` (unchanged), (c) X is **not** in `siteDeck` and **not** in `siteDiscardPile`.
     - Then plan and resolve movement for B away from X to some other site Z. At end of B's M/H, assert X *is* now back in `siteDeck` (or discard, depending on tap state) — the last occupant left, so cleanup runs normally.

## Verification

- `npm run build` — type check.
- `npm test` — all rules tests including the new ones (must pass).
- Manual (browser client): start the lobby dev mode, set up a save with two companies of the same player (A at a non-haven site X, B at haven, path X reachable from haven). Open the movement selector for B; confirm X appears alongside deck cards with the new `.site-in-play-selectable` styling (distinct border/badge) and is clickable. Pick it; confirm B's `destinationSite` gets X and `siteDeck` is unchanged.
- Walk through to end of M/H; confirm in the UI that B's new current site is rendered with `.company-card--site-ghost` (dashed gold border, faded) — same visual as a split-off company — while A's is still solid.
- Negative UI check: set up a second company C at the same origin as B. After B plans movement to X, re-open C's movement selector — X must no longer appear (rule 2.II.7.1).
- Check server logs for all four new `logDetail` lines (in-play candidate added, plan-movement shared branch, shared arrival, origin skip) to confirm the branches were exercised.

## Out of scope

Nothing flagged — both 2.II.7.1 and the origin-cleanup leg of 2.II.7.2 are covered above.
