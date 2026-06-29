/**
 * @module stone-trolls-leader-control.test
 *
 * Regression test for bug d12c2900ba9405ec: when an Orc/Troll leader influences
 * a `leader-control` faction (Stone Trolls le-288), the engine emits TWO
 * influence-attempt variants for the same (faction, character) pair — a plain
 * attempt (taps the site) and one with `placeUnderLeaderControl` (places the
 * faction under the leader's control, site not tapped). The board renderer used
 * `legalActions.find(...)` when the player clicked the influencing character, so
 * it always fired the first (plain) variant and the player could never choose to
 * collect the faction under the troll leader. `findInfluenceVariants` now returns
 * all variants so the click handler can present a disambiguation menu.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findInfluenceVariants, influenceVariantLabel } from './company-block.js';

const STONE_TROLLS = 'p1-4' as CardInstanceId;   // le-288 faction in hand
const TROLL_CHIEF = 'p1-94' as CardInstanceId;   // le-45, the influencing Orc/Troll leader
const OTHER_CHAR = 'p1-2' as CardInstanceId;     // a character in a different company

/** The two variants the engine emits for an eligible leader (mirrors the seq-291 log). */
const variants: GameAction[] = [
  {
    type: 'influence-attempt',
    player: 'p1',
    factionInstanceId: STONE_TROLLS,
    influencingCharacterId: TROLL_CHIEF,
    need: 4,
    explanation: 'Need roll >= 4 (influence # 11, DI 1, DI bonus +6)',
  },
  {
    type: 'influence-attempt',
    player: 'p1',
    factionInstanceId: STONE_TROLLS,
    influencingCharacterId: TROLL_CHIEF,
    need: 4,
    explanation: "Need roll >= 4 — place under Troll-chief's control, site not tapped (...)",
    placeUnderLeaderControl: true,
  },
] as GameAction[];

describe('Stone Trolls leader-control influence variant is reachable in the UI', () => {
  test('both variants are surfaced for the influencing leader', () => {
    const found = findInfluenceVariants(variants, STONE_TROLLS, TROLL_CHIEF);
    expect(found).toHaveLength(2);
    expect(found.some(v => v.placeUnderLeaderControl === true)).toBe(true);
    expect(found.some(v => !v.placeUnderLeaderControl)).toBe(true);
  });

  test('variants for an unrelated character are not returned', () => {
    expect(findInfluenceVariants(variants, STONE_TROLLS, OTHER_CHAR)).toHaveLength(0);
  });

  test('the leader-control variant has a distinct, descriptive label', () => {
    const found = findInfluenceVariants(variants, STONE_TROLLS, TROLL_CHIEF);
    const labels = found.map(influenceVariantLabel);
    expect(new Set(labels).size).toBe(2); // the two options are distinguishable
    expect(labels).toContain("Place under leader's control (site not tapped)");
  });
});
