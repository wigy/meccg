/**
 * @module rule-10.25-auto-attack-targeting
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.25: Automatic-Attack Targeting
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * An automatic-attack may be targeted or affected by hazards that affect either "automatic-attacks" or "attacks" at any time while its site is in play, and may be targeted or affected by resources/characters that specifically affect an "automatic-attack" at any time while its site is in play, but can only be affected by resources/characters that target or affect an "attack" during combat.
 */

import { describe, test } from 'vitest';

// This distinguishes "affects automatic-attacks" DSL effects (the `target:
// 'all-automatic-attacks'`/`'all-attacks'` stat-modifiers already used by
// rule-6.02's on-guard-reveal gating) from generic "affects an attack" cards
// that only apply once combat exists. The engine's cancel/modify-attack
// window (rule 8.02/8.04) is only ever reachable once `state.combat` is
// active, which already structurally enforces the "resources can only
// affect an attack during combat" half. What's not separately verified is
// the "specifically automatic-attack" resource carve-out that would let a
// resource affect the attack outside combat — no card in the pool declares
// such an effect for resources/characters (only hazard events do), so
// there's no reachable scenario for that half.
describe('Rule 10.25 — Automatic-Attack Targeting', () => {
  test.todo('Auto-attacks targetable by hazards anytime while site in play; by resources only during combat or if specifically "automatic-attack"');
});
