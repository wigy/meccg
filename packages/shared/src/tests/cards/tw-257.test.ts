/**
 * @module tw-257.test
 *
 * Card test: Hillmen (tw-257)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Cameth Brin if the influence check is greater than 9.
 *  Standard Modifications: Men (+1)."
 *
 * Tests:
 * 1. check-modifier: +1 influence check bonus when bearer is Man race
 * 2. No bonus when bearer is non-Man race
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  EOWYN, LEGOLAS,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction, CardDefinitionId } from '../../index.js';

const HILLMEN = 'tw-257' as CardDefinitionId;
const CAMETH_BRIN = 'tw-379' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Hillmen (tw-257)', () => {
  beforeEach(() => resetMint());

  test('+1 influence check bonus when bearer is Man', () => {
    // Éowyn (man, base DI 0) attempts to influence Hillmen at Cameth Brin.
    // Hillmen influence number = 10, Men get +1 check modifier from faction card.
    //   modifier = DI 0 + check bonus 1 = 1
    //   need = 10 - 1 = 9
    const state = buildSitePhaseState({
      characters: [EOWYN],
      site: CAMETH_BRIN,
      hand: [HILLMEN],
    });

    const eowynId = findCharInstanceId(state, RESOURCE_PLAYER, EOWYN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const eowynAttempt = influenceActions.find(
      a => a.influencingCharacterId === eowynId,
    );
    expect(eowynAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(0) - manCheckMod(1) = 9
    expect(eowynAttempt!.need).toBe(9);
  });

  test('no bonus when bearer is non-Man', () => {
    // Legolas (elf, base DI 2) attempts to influence Hillmen at Cameth Brin.
    // Hillmen influence number = 10, Man check modifier does NOT apply to elves.
    //   modifier = DI 2
    //   need = 10 - 2 = 8
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: CAMETH_BRIN,
      hand: [HILLMEN],
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

    // influenceNumber(10) - baseDI(2) = 8 (no Man bonus)
    expect(legolasAttempt!.need).toBe(8);
  });
});
