---
name: project_ba81_stabbing_tongue
description: ba-81 Stabbing Tongue of Fire — combat.strikeMode prowess gate primitive
metadata:
  type: project
---

Certified ba-81 Stabbing Tongue of Fire (PR #1430, 2026-07-13). Unique Balrog-specific "special" item, borne only by The Balrog.

New primitive: **`combat.strikeMode` resolver-context path**. `computeCombatProwess` (recompute-derived.ts) now takes the strike-resolution mode (`'tap'|'untap'|'dodge'|'reroll'`) and exposes it as `combat.strikeMode`; `resolveStrikeCore` (combat-strike.ts) passes the real mode and `legal-actions/combat.ts` computes the tap/untap need per-mode. Lets a `stat-modifier` prowess apply only "when tapping to face a strike" via `when: { "combat.strikeMode": "tap" }` — never when staying untapped, never in effective-stats. Inert for any card without such a gate.

Effects: `item-play-site` (`allowTapped`, filter `under-deeps` keyword AND `siteType != haven` = non-Darkhaven Under-deeps; Darkhaven = The Under-gates ba-100 haven) + `play-target` char `{target.name:"The Balrog"}` + prowess +1 tap-gated + two `bearer-combat` `body-check-modifier` reused verbatim from [[project_ba58_flame_of_udun]] (Flame of Udûn ba-58): failed-strike-vs-Balrog +1, CvCC-attack +1 defender body check.

Sibling ba-82 Whip of Many Thongs shares the play-site + bearer + "+1 prowess when tapping to face a strike" lines (reuse this primitive), but adds a tap-to-cancel-weapon combat ability (not yet built).
