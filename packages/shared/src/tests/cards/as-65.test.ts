/**
 * @module as-65.test
 *
 * Card test: Petty-dwarves (as-65)
 * Type: minion-resource-faction · alignment: ringwraith · race: dwarf · UNIQUE
 *       · faction MP 3 · influence # 12
 *
 * Card text:
 *   "Unique. Playable at The Worthy Hills if the influence check is greater
 *    than 11."
 *
 * Rules modelled (and how):
 *  - "Playable at The Worthy Hills" — `playableAt: [{ site: "The Worthy Hills" }]`;
 *    the faction influence-attempt generator only offers the attempt when the
 *    company's current site name matches exactly (`siteMatchesEntry`). It is NOT
 *    offered at any other site.
 *  - "if the influence check is greater than 11" — `influenceNumber: 12`; the
 *    engine succeeds on `total >= influenceNumber`, so a modified roll of 12
 *    (i.e. "greater than 11") is the minimum. The computed `need = 12 - DI`.
 *  - No "Standard Modifications" clause — the faction carries NO
 *    `check-modifier` effects, so `need` is exactly `influenceNumber - DI`
 *    regardless of the influencing character's race.
 *  - "Unique" — `unique: true`; a copy already in play blocks a second
 *    influence attempt (the unique duplicate-in-play gate).
 *  - Same-named hero-side manifestation (as-61 "Manifestation of minion
 *    Petty-dwarves") — manifestation uniqueness vs. as-65.
 *
 * | # | Rule                                                            | Status |
 * |---|------------------------------------------------------------------|--------|
 * | 1 | influence-able at The Worthy Hills; DI-0 orc needs 12 ("> 11")    | OK     |
 * | 2 | DI reduces need; no faction check modifier                       | OK     |
 * | 3 | NOT playable at a different site (even another ruins-and-lairs)  | OK     |
 * | 4 | unique: a copy already in play blocks a second attempt            | OK     |
 * | 5 | manifestation uniqueness vs. hero version (as-61)                 | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  RESOURCE_PLAYER, PLAYER_1, HAZARD_PLAYER,
  buildSitePhaseState, addCardInPlay, resetMint,
  findHandCardId, firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const PETTY_DWARVES = 'as-65' as CardDefinitionId;      // the faction under test (UNIQUE, dwarf, inf # 12)
const PETTY_DWARVES_HERO = 'as-61' as CardDefinitionId; // same-named hero faction — manifestation uniqueness
const CIRYAHER = 'le-6' as CardDefinitionId;             // minion dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;              // minion orc, DI 0, no effects
const WORTHY_HILLS = 'as-142' as CardDefinitionId;       // its only playable site (ruins-and-lairs)
const WEATHERTOP = 'as-169' as CardDefinitionId;         // another ruins-and-lairs — NOT The Worthy Hills

describe('Petty-dwarves (as-65)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable at The Worthy Hills; influence # 12 ("greater than 11") ──

  test('influence-able at The Worthy Hills; a DI-0 orc needs a modified roll of 12', () => {
    // Lagduf (orc, DI 0) attempts to influence the Petty-dwarves at The Worthy Hills.
    //   need = influenceNumber(12) − DI(0) = 12  → "greater than 11"
    const state = buildSitePhaseState({
      characters: [LAGDUF],
      site: WORTHY_HILLS,
      hand: [PETTY_DWARVES],
    });
    const factionId = findHandCardId(state, RESOURCE_PLAYER, PETTY_DWARVES);
    const attempt = firstFactionInfluenceAttempt(state, factionId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(12);
  });

  // ── Rule 2: DI reduces need; no Standard Modifications ──────────────────────────

  test('direct influence reduces need with no faction check modifier applied', () => {
    // Ciryaher (dúnadan, DI 2) attempts to influence the Petty-dwarves.
    // The faction has no Standard Modifications, so no race-based ± is applied.
    //   need = influenceNumber(12) − DI(2) = 10
    const state = buildSitePhaseState({
      characters: [CIRYAHER],
      site: WORTHY_HILLS,
      hand: [PETTY_DWARVES],
    });
    const factionId = findHandCardId(state, RESOURCE_PLAYER, PETTY_DWARVES);
    const attempt = firstFactionInfluenceAttempt(state, factionId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  // ── Rule 3: named-site restriction ──────────────────────────────────────────────

  test('NOT playable at a different ruins-and-lairs (only The Worthy Hills qualifies)', () => {
    const state = buildSitePhaseState({
      characters: [CIRYAHER],
      site: WEATHERTOP,
      hand: [PETTY_DWARVES],
    });
    const factionId = findHandCardId(state, RESOURCE_PLAYER, PETTY_DWARVES);

    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  // ── Rule 4: unique — a copy already in play blocks a second ────────────────────

  test('unique: a copy already in play blocks a second influence attempt', () => {
    const base = buildSitePhaseState({
      characters: [CIRYAHER],
      site: WORTHY_HILLS,
      hand: [PETTY_DWARVES],
    });
    const state = addCardInPlay(base, RESOURCE_PLAYER, PETTY_DWARVES);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, PETTY_DWARVES);

    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  // ── Rule 5: manifestation uniqueness vs. the hero version ──────────────────────

  test('manifestation uniqueness: minion version cannot be played if hero version is in play', () => {
    // The engine's name-based faction uniqueness check prevents playing as-65
    // when as-61 (same name "Petty-dwarves") is already in play, even on the
    // opponent's side.
    const base = buildSitePhaseState({
      characters: [CIRYAHER],
      site: WORTHY_HILLS,
      hand: [PETTY_DWARVES],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, PETTY_DWARVES_HERO);

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
