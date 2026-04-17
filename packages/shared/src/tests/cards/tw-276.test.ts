/**
 * @module tw-276.test
 *
 * Card test: Men of Anfalas (tw-276)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Lond Galen if the influence check is greater than 8.
 *  Standard Modifications: Dúnedain (+1)."
 *
 * This tests the single effect:
 * 1. check-modifier: +1 to influence check when bearer (influencing character) is Dúnadan race
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, LEGOLAS,
  LOND_GALEN,
  MEN_OF_ANFALAS,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Men of Anfalas (tw-276)', () => {
  beforeEach(() => resetMint());

  test('Dúnadan character gets +1 check modifier when influencing', () => {
    // Aragorn (dunadan, base DI 3) attempts to influence Men of Anfalas at Lond Galen.
    // Men of Anfalas influence number = 9.
    // Faction card gives Dúnedain +1 check modifier.
    //   modifier = DI 3 + check bonus 1 (Dúnadan) = 4
    //   need = 9 - 4 = 5
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: LOND_GALEN,
      hand: [MEN_OF_ANFALAS],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const aragornAttempt = influenceActions.find(
      a => a.influencingCharacterId === aragornId,
    );
    expect(aragornAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(3) - dúnadanCheckMod(1) = 5
    expect(aragornAttempt!.need).toBe(5);
  });

  test('non-Dúnadan character does not get the +1 check modifier', () => {
    // Legolas (elf, base DI 2) attempts to influence Men of Anfalas at Lond Galen.
    // Men of Anfalas influence number = 9.
    // Legolas is not dunadan, so the Dúnedain +1 check modifier does NOT apply.
    //   modifier = DI 2
    //   need = 9 - 2 = 7
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: LOND_GALEN,
      hand: [MEN_OF_ANFALAS],
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(2) = 7 (no Dúnadan bonus)
    expect(legolasAttempt!.need).toBe(7);
  });

});
