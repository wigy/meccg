/**
 * @module tw-357.test
 *
 * Card test: Variags of Khand (tw-357)
 * Type: hero-resource-faction · alignment: wizard · race: man · UNIQUE
 *       · faction MP 4 · influence # 10
 *
 * Card text:
 *   "Unique. Playable at Variag Camp if the influence check is greater than 9.
 *    Standard Modifications: none."
 *
 * Rules modelled (and how):
 *  - "Playable at Variag Camp" — `playableAt: [{ site: "Variag Camp" }]`; the
 *    faction influence-attempt generator only offers the attempt when the
 *    company's current site's name matches exactly (`siteMatchesEntry`). It is
 *    NOT offered at any other site, even another border-hold.
 *  - "if the influence check is greater than 9" — `influenceNumber: 10`; the
 *    engine succeeds on `total >= influenceNumber`, so a roll of 10 (i.e.
 *    "greater than 9") is the minimum. The computed `need = 10 - modifier`.
 *  - "Standard Modifications: none" — the faction carries NO `check-modifier`
 *    effects, so `need` is exactly `influenceNumber - DI` regardless of the
 *    influencing character's race (no ± faction adjustment is applied).
 *  - "Unique" — `unique: true`; a copy already in play blocks a second
 *    influence attempt (the unique duplicate-in-play gate).
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | influence-able at Variag Camp; DI-0 man needs 10 ("> 9")      | OK     |
 * | 2 | DI reduces need; no faction check modifier (Std Mods: none)   | OK     |
 * | 3 | NOT playable at a different site (even another border-hold)   | OK     |
 * | 4 | unique: a copy already in play blocks a second attempt        | OK     |
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

const VARIAGS = 'tw-357' as CardDefinitionId;       // the faction under test (UNIQUE, man, inf # 10)
const VARIAG_CAMP = 'tw-435' as CardDefinitionId;   // its only playable site (border-hold, Khand)
const VALE_OF_ERECH = 'tw-434' as CardDefinitionId; // another border-hold — NOT Variag Camp

describe('Variags of Khand (tw-357)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable at Variag Camp; influence # 10 ("greater than 9") ────────

  test('influence-able at Variag Camp; a DI-0 man needs a modified roll of 10', () => {
    // Éowyn (man, DI 0) attempts to influence Variags of Khand at Variag Camp.
    //   need = influenceNumber(10) − DI(0) = 10  → "greater than 9"
    const state = buildSitePhaseState({
      characters: [EOWYN],
      site: VARIAG_CAMP,
      hand: [VARIAGS],
    });
    const variagsId = findHandCardId(state, RESOURCE_PLAYER, VARIAGS);
    const attempt = firstFactionInfluenceAttempt(state, variagsId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  // ── Rule 2: DI reduces need; "Standard Modifications: none" ───────────────────

  test('direct influence reduces need with no faction check modifier applied', () => {
    // Aragorn II (DI 3) attempts to influence Variags of Khand at Variag Camp.
    // The faction has NO Standard Modifications, so no race-based ± is applied.
    //   need = influenceNumber(10) − DI(3) = 7
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: VARIAG_CAMP,
      hand: [VARIAGS],
    });
    const variagsId = findHandCardId(state, RESOURCE_PLAYER, VARIAGS);
    const attempt = firstFactionInfluenceAttempt(state, variagsId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  // ── Rule 3: named-site restriction ───────────────────────────────────────────

  test('NOT playable at a different border-hold (only Variag Camp qualifies)', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: VALE_OF_ERECH,
      hand: [VARIAGS],
    });
    const variagsId = findHandCardId(state, RESOURCE_PLAYER, VARIAGS);

    expect(firstFactionInfluenceAttempt(state, variagsId)).toBeUndefined();
  });

  // ── Rule 4: unique — a copy already in play blocks a second ───────────────────

  test('unique: a copy already in play blocks a second influence attempt', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: VARIAG_CAMP,
      hand: [VARIAGS],
    });
    const state = addCardInPlay(base, RESOURCE_PLAYER, VARIAGS);
    const variagsId = findHandCardId(state, RESOURCE_PLAYER, VARIAGS);

    expect(firstFactionInfluenceAttempt(state, variagsId)).toBeUndefined();
  });
});
