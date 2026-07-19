/**
 * @module tw-344.test
 *
 * Card test: The Great Eagles (tw-344)
 * Type: hero-resource-faction · alignment: wizard · race: eagle · UNIQUE
 *       · faction MP 3 · influence # 10
 *
 * Card text:
 *   "Unique. Playable at Eagles’ Eyrie if the influence check is greater than 9.
 *    Standard Modifications: none."
 *
 * Rules modelled (and how):
 *  - "Playable at Eagles’ Eyrie" — `playableAt: [{ site: "Eagles’ Eyrie" }]`; the
 *    faction influence-attempt generator only offers the attempt when the
 *    company's current site name matches exactly (`siteMatchesEntry`). It is NOT
 *    offered at any other site, even another Free-hold. (The data previously
 *    carried a truncated site name `"Eagles’"` that matched no site — fixed here.)
 *  - "if the influence check is greater than 9" — `influenceNumber: 10`; the
 *    engine succeeds on `total >= influenceNumber`, so a modified roll of 10
 *    (i.e. "greater than 9") is the minimum. The computed `need = 10 - DI`.
 *  - "Standard Modifications: none" — the faction carries NO `check-modifier`
 *    effects, so `need` is exactly `influenceNumber - DI` regardless of the
 *    influencing character's race (no ± faction adjustment is applied).
 *  - "Unique" — `unique: true`; a copy already in play blocks a second
 *    influence attempt (the unique duplicate-in-play gate).
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | influence-able at Eagles’ Eyrie; DI-0 man needs 10 ("> 9")    | OK     |
 * | 2 | DI reduces need; no faction check modifier (Std Mods: none)   | OK     |
 * | 3 | NOT playable at a different site (even another Free-hold)     | OK     |
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

const GREAT_EAGLES = 'tw-344' as CardDefinitionId;   // the faction under test (UNIQUE, eagle, inf # 10)
const EAGLES_EYRIE = 'tw-391' as CardDefinitionId;   // its only playable site (free-hold, Anduin Vales)
const MINAS_TIRITH = 'tw-412' as CardDefinitionId;   // another free-hold — NOT Eagles’ Eyrie

describe('The Great Eagles (tw-344)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable at Eagles’ Eyrie; influence # 10 ("greater than 9") ──────

  test('influence-able at Eagles’ Eyrie; a DI-0 man needs a modified roll of 10', () => {
    // Éowyn (man, DI 0) attempts to influence The Great Eagles at Eagles’ Eyrie.
    //   need = influenceNumber(10) − DI(0) = 10  → "greater than 9"
    const state = buildSitePhaseState({
      characters: [EOWYN],
      site: EAGLES_EYRIE,
      hand: [GREAT_EAGLES],
    });
    const eaglesId = findHandCardId(state, RESOURCE_PLAYER, GREAT_EAGLES);
    const attempt = firstFactionInfluenceAttempt(state, eaglesId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  // ── Rule 2: DI reduces need; "Standard Modifications: none" ───────────────────

  test('direct influence reduces need with no faction check modifier applied', () => {
    // Aragorn II (DI 3) attempts to influence The Great Eagles at Eagles’ Eyrie.
    // The faction has NO Standard Modifications, so no race-based ± is applied.
    //   need = influenceNumber(10) − DI(3) = 7
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: EAGLES_EYRIE,
      hand: [GREAT_EAGLES],
    });
    const eaglesId = findHandCardId(state, RESOURCE_PLAYER, GREAT_EAGLES);
    const attempt = firstFactionInfluenceAttempt(state, eaglesId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  // ── Rule 3: named-site restriction ───────────────────────────────────────────

  test('NOT playable at a different free-hold (only Eagles’ Eyrie qualifies)', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MINAS_TIRITH,
      hand: [GREAT_EAGLES],
    });
    const eaglesId = findHandCardId(state, RESOURCE_PLAYER, GREAT_EAGLES);

    expect(firstFactionInfluenceAttempt(state, eaglesId)).toBeUndefined();
  });

  // ── Rule 4: unique — a copy already in play blocks a second ───────────────────

  test('unique: a copy already in play blocks a second influence attempt', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: EAGLES_EYRIE,
      hand: [GREAT_EAGLES],
    });
    const state = addCardInPlay(base, RESOURCE_PLAYER, GREAT_EAGLES);
    const eaglesId = findHandCardId(state, RESOURCE_PLAYER, GREAT_EAGLES);

    expect(firstFactionInfluenceAttempt(state, eaglesId)).toBeUndefined();
  });
});
