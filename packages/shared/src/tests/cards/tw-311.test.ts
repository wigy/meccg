/**
 * @module tw-311.test
 *
 * Card test: Rangers of the North (tw-311)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Bree if the influence check is greater than 9.
 *  Standard Modifications: Dúnedain (+1)."
 *
 * This tests the single effect:
 * 1. check-modifier: +1 to influence check when bearer (influencing character) is Dúnadan race
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, LEGOLAS,
  BREE,
  RANGERS_OF_THE_NORTH,
  buildSitePhaseState, resetMint,
  findCharInstanceId,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Rangers of the North (tw-311)', () => {
  beforeEach(() => resetMint());

  test('Dúnadan character gets +1 check modifier when influencing', () => {
    // Aragorn (dunadan, base DI 3) attempts to influence Rangers of the North at Bree.
    // Rangers influence number = 10.
    // Aragorn has +2 DI bonus specifically for Rangers of the North faction.
    // Faction card gives Dúnedain +1 check modifier.
    //   modifier = DI 3 + DI bonus 2 (Aragorn specific) + check bonus 1 (Dúnadan) = 6
    //   need = 10 - 6 = 4
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const aragornAttempt = influenceActions.find(
      a => a.influencingCharacterId === aragornId,
    );
    expect(aragornAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(3) - aragornDIBonus(2) - dúnadanCheckMod(1) = 4
    expect(aragornAttempt!.need).toBe(4);
  });

  test('non-Dúnadan character does not get the +1 check modifier', () => {
    // Legolas (elf, base DI 2) attempts to influence Rangers of the North at Bree.
    // Rangers influence number = 10.
    // Legolas is not dunadan, so the Dúnedain +1 check modifier does NOT apply.
    //   modifier = DI 2
    //   need = 10 - 2 = 8
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const legolasId = findCharInstanceId(state, 0, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(2) = 8 (no Dúnadan bonus)
    expect(legolasAttempt!.need).toBe(8);
  });

});
