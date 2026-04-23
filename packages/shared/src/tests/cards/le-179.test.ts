/**
 * @module le-179.test
 *
 * Card test: Deeper Shadow (le-179)
 * Type: minion-resource-event (short)
 * Effects: 0 — NOT CERTIFIED. Core mechanics missing from the engine.
 *
 * Card text:
 *   "Magic. Shadow-magic. Playable during the movement/hazard phase on a
 *    moving shadow-magic-using character. In character's site path, change
 *    a Ruins & Lairs [{R}] to a Shadow-hold [{S}] or one Wilderness [{w}]
 *    to a Shadow-land [{s}]. Alternatively, decrease the hazard limit
 *    against his company by one (to no minimum). Unless he is a
 *    Ringwraith, he makes a corruption check modified by -3."
 *
 * Blockers preventing certification:
 *   - No `shadow-magic` skill/keyword is wired up on any character
 *     definition. No existing card in the pool carries the property that
 *     would make this card's play-restriction satisfiable.
 *   - No play-restriction predicate for "moving character" at MH-phase
 *     play-time (as opposed to post-reveal combat-time).
 *   - No DSL effect for mutating the character's resolved site-path
 *     (change `{R}` → `{S}` or `{w}` → `{s}`). `resolvedSitePath` is
 *     immutable after reveal.
 *   - No DSL effect for forcing a corruption check on a named character
 *     with a check modifier (distinct from check-modifier, which only
 *     tweaks an already-initiated check).
 */

import { describe, test } from 'vitest';

describe('Deeper Shadow (le-179) — NOT CERTIFIED', () => {
  test.todo('play-restriction: only during movement/hazard phase on a moving character');
  test.todo('play-restriction: target must be a shadow-magic-using character');
  test.todo('option A: change one Ruins & Lairs [{R}] to Shadow-hold [{S}] in target\'s site path');
  test.todo('option A: change one Wilderness [{w}] to Shadow-land [{s}] in target\'s site path');
  test.todo('option B: decrease hazard limit against target\'s company by one (no minimum)');
  test.todo('option B: unless target is a Ringwraith, force corruption check on target modified by -3');
  test.todo('options A and B are mutually exclusive (either/or, not both)');
});
