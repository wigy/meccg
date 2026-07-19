---
name: project_wh57_rhosgobel
description: wh-57 Rhosgobel certified — new inherently-protected-Wizardhaven site-rule primitive
metadata:
  type: project
---

wh-57 Rhosgobel (Radagast's FW Wizardhaven, haven) certified 2026-07-17, PR #1514.

Four printed rules, all engine-backed + tested:
- "Only Radagast's companies may use this card" → existing `radagast-specific` keyword. Fix: deck-validation rule 1.07 (`deck-validation.ts`) `allSections` now also scans the `sites` section, so a wizard-specific site is only includable when that avatar is declared.
- "This site is a protected Wizardhaven" → **new** `site-rule: protected-wizardhaven` (inherent protection, no card needed — unlike Isengard/White Towers which need wh-68/wh-74). Two shared helpers in `reducer-utils.ts`: `inherentProtectedWizardhavenOwner(state, siteDefId)` (FW for whom it's a Wizardhaven via `isHavenForPlayer` AND who matches the site's `<wizard>-specific` keyword) and `isSiteProtectedForPlayer(state, siteDefId, playerId, match)` (ORs inherent onto the `site-protected` constraint check). All prior `site-protected` reads route through it; `playerHasProtectedWizardhaven` also true while a company occupies an inherent protected Wizardhaven.
- "all attacks against it are canceled" → existing `site-rule: cancel-attacks` (shared with [[project_wh58_the_white_towers]]-style siblings wh-56/wh-58).
- stage point while occupied → existing `stage-points` `whileCompanyAtSite` value 1 (same mechanism as Deep Mines wh-55).

Note: opponent MP-block side of "protected" is unreachable for Rhosgobel (radagast-specific ⇒ opponent can never be at it), so not asserted. Test uses Deep Mines descent from Rhosgobel (no injected constraint) as the engine-driven proof of inherent protection.
