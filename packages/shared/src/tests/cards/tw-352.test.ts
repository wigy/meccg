/**
 * @module tw-352.test
 *
 * Card test: Tower Guard of Minas Tirith (tw-352)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Minas Tirith if the influence check is greater than 7.
 *  Standard Modifications: Dúnedain (+1)."
 *
 * influenceNumber = 8 (need roll > 7, i.e. roll >= 8)
 * playableAt = [Minas Tirith]
 *
 * Effect 1: check-modifier +1 to influence check when bearer is Dúnadan race.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, LEGOLAS,
  MINAS_TIRITH,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';

const TOWER_GUARD_OF_MINAS_TIRITH = 'tw-352' as CardDefinitionId;

describe('Tower Guard of Minas Tirith (tw-352)', () => {
  beforeEach(() => resetMint());

  test('Dúnadan character gets +1 check modifier when influencing', () => {
    // Aragorn (dunadan, base DI 3) attempts to influence Tower Guard at Minas Tirith.
    // Tower Guard influence number = 8 (need roll > 7).
    // Faction card gives Dúnedain +1 check modifier.
    //   modifier = DI 3 + check bonus 1 (Dúnadan) = 4
    //   need = 8 - 4 = 4
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MINAS_TIRITH,
      hand: [TOWER_GUARD_OF_MINAS_TIRITH],
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

    // influenceNumber(8) - baseDI(3) - dúnadanCheckMod(1) = 4
    expect(aragornAttempt!.need).toBe(4);
  });

  test('non-Dúnadan character does not get the +1 check modifier', () => {
    // Legolas (elf, base DI 2) attempts to influence Tower Guard at Minas Tirith.
    // Tower Guard influence number = 8.
    // Legolas is not dunadan, so the Dúnedain +1 check modifier does NOT apply.
    //   modifier = DI 2
    //   need = 8 - 2 = 6
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: MINAS_TIRITH,
      hand: [TOWER_GUARD_OF_MINAS_TIRITH],
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

    // influenceNumber(8) - baseDI(2) = 6 (no Dúnadan bonus)
    expect(legolasAttempt!.need).toBe(6);
  });
});
