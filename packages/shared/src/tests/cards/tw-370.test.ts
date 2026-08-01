/**
 * @module tw-370.test
 *
 * Card test: Woses of the Drúadan Forest (tw-370)
 * Type: hero-resource-faction · alignment: wizard · race: wose · UNIQUE
 *       · faction MP 3 · influence # 10
 *
 * Card text:
 *   "Unique. Playable at Drúadan Forest if the influence check is greater than 9.
 *    Standard Modifications: none."
 *
 * Rules modelled (and how):
 *  - "Playable at Drúadan Forest" — `playableAt: [{ site: "Drúadan Forest" }]`;
 *    the faction influence-attempt generator only offers the attempt when the
 *    company's current site name matches exactly (`siteMatchesEntry`). It is NOT
 *    offered at any other site. (The data previously carried a truncated site
 *    name `"Drúadan"` that matched no site — fixed here, same class of bug as
 *    The Great Eagles tw-344.)
 *  - "if the influence check is greater than 9" — `influenceNumber: 10`; the
 *    engine succeeds on `total >= influenceNumber`, so a modified roll of 10
 *    (i.e. "greater than 9") is the minimum. The computed `need = 10 - DI`.
 *  - "Standard Modifications: none" — the faction carries NO `check-modifier`
 *    effects, so `need` is exactly `influenceNumber - DI` regardless of the
 *    influencing character's race (no ± faction adjustment is applied).
 *  - "Unique" — `unique: true`; a copy already in play blocks a second
 *    influence attempt (the unique duplicate-in-play gate).
 *
 * | # | Rule                                                           | Status |
 * |---|-----------------------------------------------------------------|--------|
 * | 1 | influence-able at Drúadan Forest; DI-0 man needs 10 ("> 9")      | OK     |
 * | 2 | DI reduces need; no faction check modifier (Std Mods: none)      | OK     |
 * | 3 | NOT playable at a different site (even another border-hold)      | OK     |
 * | 4 | unique: a copy already in play blocks a second attempt           | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  RESOURCE_PLAYER,
  ARAGORN, EOWYN,
  buildSitePhaseState, addCardInPlay, resetMint,
  findHandCardId, firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const WOSES_DRUADAN = 'tw-370' as CardDefinitionId;  // the faction under test (UNIQUE, wose, inf # 10)
const DRUADAN_FOREST = 'tw-388' as CardDefinitionId; // its only playable site (border-hold, Anórien)
const DUNHARROW = 'tw-389' as CardDefinitionId;      // another border-hold — NOT Drúadan Forest

describe('Woses of the Drúadan Forest (tw-370)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable at Drúadan Forest; influence # 10 ("greater than 9") ─────

  test('influence-able at Drúadan Forest; a DI-0 man needs a modified roll of 10', () => {
    // Éowyn (man, DI 0) attempts to influence the Woses at Drúadan Forest.
    //   need = influenceNumber(10) − DI(0) = 10  → "greater than 9"
    const state = buildSitePhaseState({
      characters: [EOWYN],
      site: DRUADAN_FOREST,
      hand: [WOSES_DRUADAN],
    });
    const wosesId = findHandCardId(state, RESOURCE_PLAYER, WOSES_DRUADAN);
    const attempt = firstFactionInfluenceAttempt(state, wosesId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  // ── Rule 2: DI reduces need; "Standard Modifications: none" ───────────────────

  test('direct influence reduces need with no faction check modifier applied', () => {
    // Aragorn II (DI 3) attempts to influence the Woses at Drúadan Forest.
    // The faction has NO Standard Modifications, so no race-based ± is applied.
    //   need = influenceNumber(10) − DI(3) = 7
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: DRUADAN_FOREST,
      hand: [WOSES_DRUADAN],
    });
    const wosesId = findHandCardId(state, RESOURCE_PLAYER, WOSES_DRUADAN);
    const attempt = firstFactionInfluenceAttempt(state, wosesId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  // ── Rule 3: named-site restriction ───────────────────────────────────────────

  test('NOT playable at a different border-hold (only Drúadan Forest qualifies)', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: DUNHARROW,
      hand: [WOSES_DRUADAN],
    });
    const wosesId = findHandCardId(state, RESOURCE_PLAYER, WOSES_DRUADAN);

    expect(firstFactionInfluenceAttempt(state, wosesId)).toBeUndefined();
  });

  // ── Rule 4: unique — a copy already in play blocks a second ───────────────────

  test('unique: a copy already in play blocks a second influence attempt', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: DRUADAN_FOREST,
      hand: [WOSES_DRUADAN],
    });
    const state = addCardInPlay(base, RESOURCE_PLAYER, WOSES_DRUADAN);
    const wosesId = findHandCardId(state, RESOURCE_PLAYER, WOSES_DRUADAN);

    expect(firstFactionInfluenceAttempt(state, wosesId)).toBeUndefined();
  });
});
