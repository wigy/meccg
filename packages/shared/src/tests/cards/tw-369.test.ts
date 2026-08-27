/**
 * @module tw-369.test
 *
 * Card test: Woses of Old Pûkel-land (tw-369)
 * Type: hero-resource-faction · alignment: wizard · race: wose · UNIQUE
 *       · faction MP 3 · influence # 9
 *
 * Card text:
 *   "Unique. Playable at Wose Passage-hold if the influence check is greater
 *    than 8. Standard Modifications: none."
 *
 * Rules modelled (and how):
 *  - "Playable at Wose Passage-hold" — `playableAt: [{ site: "Wose Passage-hold" }]`;
 *    the faction influence-attempt generator only offers the attempt when the
 *    company's current site name matches exactly (`siteMatchesEntry`). It is NOT
 *    offered at any other site. (The data previously carried a truncated site
 *    name `"Wose"` that matched no site — fixed here, same class of bug as
 *    Woses of the Drúadan Forest tw-370 and The Great Eagles tw-344.)
 *  - "if the influence check is greater than 8" — `influenceNumber: 9`; the
 *    engine succeeds on `total >= influenceNumber`, so a modified roll of 9
 *    (i.e. "greater than 8") is the minimum. The computed `need = 9 - DI`.
 *  - "Standard Modifications: none" — the faction carries NO `check-modifier`
 *    effects, so `need` is exactly `influenceNumber - DI` regardless of the
 *    influencing character's race (no ± faction adjustment is applied).
 *  - "Unique" — `unique: true`; a copy already in play blocks a second
 *    influence attempt (the unique duplicate-in-play gate).
 *
 * | # | Rule                                                           | Status |
 * |---|-----------------------------------------------------------------|--------|
 * | 1 | influence-able at Wose Passage-hold; DI-0 man needs 9 ("> 8")    | OK     |
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

const WOSES_PUKEL = 'tw-369' as CardDefinitionId;       // the faction under test (UNIQUE, wose, inf # 9)
const WOSE_PASSAGE_HOLD = 'tw-439' as CardDefinitionId; // its only playable site (border-hold)
const DUNHARROW = 'tw-389' as CardDefinitionId;         // another border-hold — NOT Wose Passage-hold

describe('Woses of Old Pûkel-land (tw-369)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable at Wose Passage-hold; influence # 9 ("greater than 8") ───

  test('influence-able at Wose Passage-hold; a DI-0 man needs a modified roll of 9', () => {
    // Éowyn (man, DI 0) attempts to influence the Woses at Wose Passage-hold.
    //   need = influenceNumber(9) − DI(0) = 9  → "greater than 8"
    const state = buildSitePhaseState({
      characters: [EOWYN],
      site: WOSE_PASSAGE_HOLD,
      hand: [WOSES_PUKEL],
    });
    const wosesId = findHandCardId(state, RESOURCE_PLAYER, WOSES_PUKEL);
    const attempt = firstFactionInfluenceAttempt(state, wosesId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  // ── Rule 2: DI reduces need; "Standard Modifications: none" ───────────────────

  test('direct influence reduces need with no faction check modifier applied', () => {
    // Aragorn II (DI 3) attempts to influence the Woses at Wose Passage-hold.
    // The faction has NO Standard Modifications, so no race-based ± is applied.
    //   need = influenceNumber(9) − DI(3) = 6
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: WOSE_PASSAGE_HOLD,
      hand: [WOSES_PUKEL],
    });
    const wosesId = findHandCardId(state, RESOURCE_PLAYER, WOSES_PUKEL);
    const attempt = firstFactionInfluenceAttempt(state, wosesId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  // ── Rule 3: named-site restriction ───────────────────────────────────────────

  test('NOT playable at a different border-hold (only Wose Passage-hold qualifies)', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: DUNHARROW,
      hand: [WOSES_PUKEL],
    });
    const wosesId = findHandCardId(state, RESOURCE_PLAYER, WOSES_PUKEL);

    expect(firstFactionInfluenceAttempt(state, wosesId)).toBeUndefined();
  });

  // ── Rule 4: unique — a copy already in play blocks a second ───────────────────

  test('unique: a copy already in play blocks a second influence attempt', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: WOSE_PASSAGE_HOLD,
      hand: [WOSES_PUKEL],
    });
    const state = addCardInPlay(base, RESOURCE_PLAYER, WOSES_PUKEL);
    const wosesId = findHandCardId(state, RESOURCE_PLAYER, WOSES_PUKEL);

    expect(firstFactionInfluenceAttempt(state, wosesId)).toBeUndefined();
  });
});
