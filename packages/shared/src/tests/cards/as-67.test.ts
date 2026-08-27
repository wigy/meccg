/**
 * @module as-67.test
 *
 * Card test: Woses of the Eryn Vorn (as-67)
 * Type: hero-resource-faction · alignment: wizard · race: wose · UNIQUE
 *       · faction MP 2 · influence # 11
 *
 * Card text:
 *   "Unique. Manifestation of minion Woses of the Eryn Vorn. Playable at The
 *    Worthy Hills if the influence check is greater than 10. Standard
 *    Modifications: none."
 *
 * Rules modelled (and how):
 *  - "Playable at The Worthy Hills" — `playableAt: [{ site: "The Worthy Hills" }]`;
 *    the faction influence-attempt generator only offers the attempt when the
 *    company's current site name matches exactly (`siteMatchesEntry`). It is NOT
 *    offered at any other site. (The data previously carried a truncated site
 *    name `"The"` that matched no site — same class of bug as The Great Eagles
 *    tw-344 and Woses of the Drúadan Forest tw-370.)
 *  - "if the influence check is greater than 10" — `influenceNumber: 11`; the
 *    engine succeeds on `total >= influenceNumber`, so a modified roll of 11
 *    (i.e. "greater than 10") is the minimum. The computed `need = 11 - DI`.
 *  - "Standard Modifications: none" — the faction carries NO `check-modifier`
 *    effects, so `need` is exactly `influenceNumber - DI` regardless of the
 *    influencing character's race (no ± faction adjustment is applied).
 *  - "Unique" — `unique: true`; a copy already in play blocks a second
 *    influence attempt (the unique duplicate-in-play gate).
 *  - "Manifestation of minion Woses of the Eryn Vorn" — flavor text only, no
 *    rules effect (mirrors an existing minion faction of the same name).
 *
 * | # | Rule                                                            | Status |
 * |---|------------------------------------------------------------------|--------|
 * | 1 | influence-able at The Worthy Hills; DI-0 man needs 11 ("> 10")    | OK     |
 * | 2 | DI reduces need; no faction check modifier (Std Mods: none)       | OK     |
 * | 3 | NOT playable at a different site (even another ruins-and-lairs)  | OK     |
 * | 4 | unique: a copy already in play blocks a second attempt            | OK     |
 * | 5 | manifestation uniqueness vs. minion version (le-296)              | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  RESOURCE_PLAYER, PLAYER_1, HAZARD_PLAYER,
  ARAGORN, EOWYN,
  buildSitePhaseState, addCardInPlay, resetMint,
  findHandCardId, firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const WOSES_ERYN_VORN = 'as-67' as CardDefinitionId;       // the faction under test (UNIQUE, wose, inf # 11)
const WOSES_ERYN_VORN_MINION = 'le-296' as CardDefinitionId; // same-named minion faction — manifestation uniqueness
const WORTHY_HILLS = 'as-142' as CardDefinitionId;   // its only playable site (ruins-and-lairs)
const WEATHERTOP = 'as-169' as CardDefinitionId;     // another ruins-and-lairs — NOT The Worthy Hills

describe('Woses of the Eryn Vorn (as-67)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable at The Worthy Hills; influence # 11 ("greater than 10") ──

  test('influence-able at The Worthy Hills; a DI-0 man needs a modified roll of 11', () => {
    // Éowyn (man, DI 0) attempts to influence the Woses at The Worthy Hills.
    //   need = influenceNumber(11) − DI(0) = 11  → "greater than 10"
    const state = buildSitePhaseState({
      characters: [EOWYN],
      site: WORTHY_HILLS,
      hand: [WOSES_ERYN_VORN],
    });
    const wosesId = findHandCardId(state, RESOURCE_PLAYER, WOSES_ERYN_VORN);
    const attempt = firstFactionInfluenceAttempt(state, wosesId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(11);
  });

  // ── Rule 2: DI reduces need; "Standard Modifications: none" ────────────────────

  test('direct influence reduces need with no faction check modifier applied', () => {
    // Aragorn II (DI 3) attempts to influence the Woses at The Worthy Hills.
    // The faction has NO Standard Modifications, so no race-based ± is applied.
    //   need = influenceNumber(11) − DI(3) = 8
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: WORTHY_HILLS,
      hand: [WOSES_ERYN_VORN],
    });
    const wosesId = findHandCardId(state, RESOURCE_PLAYER, WOSES_ERYN_VORN);
    const attempt = firstFactionInfluenceAttempt(state, wosesId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  // ── Rule 3: named-site restriction ──────────────────────────────────────────────

  test('NOT playable at a different ruins-and-lairs (only The Worthy Hills qualifies)', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: WEATHERTOP,
      hand: [WOSES_ERYN_VORN],
    });
    const wosesId = findHandCardId(state, RESOURCE_PLAYER, WOSES_ERYN_VORN);

    expect(firstFactionInfluenceAttempt(state, wosesId)).toBeUndefined();
  });

  // ── Rule 4: unique — a copy already in play blocks a second ────────────────────

  test('unique: a copy already in play blocks a second influence attempt', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: WORTHY_HILLS,
      hand: [WOSES_ERYN_VORN],
    });
    const state = addCardInPlay(base, RESOURCE_PLAYER, WOSES_ERYN_VORN);
    const wosesId = findHandCardId(state, RESOURCE_PLAYER, WOSES_ERYN_VORN);

    expect(firstFactionInfluenceAttempt(state, wosesId)).toBeUndefined();
  });

  // ── Rule 5: manifestation uniqueness vs. the minion version ────────────────────

  test('manifestation uniqueness: hero version cannot be played if minion version is in play', () => {
    // The engine's name-based faction uniqueness check prevents playing as-67
    // when le-296 (same name "Woses of the Eryn Vorn") is already in play,
    // even on the opponent's side.
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: WORTHY_HILLS,
      hand: [WOSES_ERYN_VORN],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, WOSES_ERYN_VORN_MINION);

    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions.filter(
      a => a.viable && a.action.type === 'influence-attempt',
    );
    expect(influenceActions).toHaveLength(0);

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable',
    );
    expect(notPlayable).toBeDefined();
  });
});
