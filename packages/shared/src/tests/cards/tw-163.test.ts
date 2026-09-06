/**
 * @module tw-163.test
 *
 * Card test: Haldalam (tw-163)
 * Type: hero-character
 * Prowess 4 / Body 9 / Mind 5 / DI 1 / MP 2
 * Skills: warrior, diplomat
 * Race: dunadan
 * Homesite: Shrel-Kain
 * Effects: 1
 *
 * "Unique. +4 direct influence against the Easterlings faction."
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                                          |
 * |---|---------------------------------------|-------------|-------------------------------------------------|
 * | 1 | +4 DI vs Easterlings (faction)         | IMPLEMENTED | stat-modifier, reason=faction-influence-check   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  buildSitePhaseState,
  findCharInstanceId, resetMint, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const HALDALAM = 'tw-163' as CardDefinitionId;
const EASTERLINGS = 'tw-222' as CardDefinitionId;
const EASTERLING_CAMP = 'tw-392' as CardDefinitionId;

describe('Haldalam (tw-163)', () => {
  beforeEach(() => resetMint());

  test('+4 direct influence against Easterlings faction', () => {
    // Haldalam (dunadan, base DI 1) attempts to influence Easterlings at
    // Easterling Camp. Easterlings influence number = 10.
    // Easterlings' own Standard Modification is Dúnedain (-2), which applies
    // to Haldalam since he is a dunadan.
    //   modifier = DI 1 + Haldalam bonus 4 + dunadan check mod (-2) = 3
    //   need = 10 - 3 = 7
    const state = buildSitePhaseState({
      characters: [HALDALAM],
      site: EASTERLING_CAMP,
      hand: [EASTERLINGS],
    });

    const haldalamId = findCharInstanceId(state, RESOURCE_PLAYER, HALDALAM);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const haldalamAttempt = influenceActions.find(
      a => a.influencingCharacterId === haldalamId,
    );
    expect(haldalamAttempt).toBeDefined();

    // influenceNumber(10) - (baseDI(1) + haldalamBonus(4) + dunadanCheckMod(-2)) = 7
    expect(haldalamAttempt!.need).toBe(7);
  });

  test('+4 DI bonus does not apply to other characters', () => {
    // Aragorn (dunadan, DI 3) attempts Easterlings at Easterling Camp.
    // Aragorn gets no Haldalam-specific bonus but still takes the -2 dunadan
    // Standard Modification.
    //   modifier = DI 3 + dunadan check mod (-2) = 1
    //   need = 10 - 1 = 9
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: EASTERLING_CAMP,
      hand: [EASTERLINGS],
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

    // influenceNumber(10) - (baseDI(3) + dunadanCheckMod(-2)) = 9
    expect(aragornAttempt!.need).toBe(9);
  });
});
