/**
 * @module tw-268.test
 *
 * Card test: Lossoth (tw-268)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Lossadan Camp if the influence check is greater than 8.
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

const LOSSOTH = 'tw-268' as CardDefinitionId;
const LOSSADAN_CAMP = 'tw-410' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Lossoth (tw-268)', () => {
  beforeEach(() => resetMint());

  test('+1 influence check bonus when bearer is Man', () => {
    // Éowyn (man, base DI 0) attempts to influence Lossoth at Lossadan Camp.
    // Lossoth influence number = 9, Men get +1 check modifier from faction card.
    //   modifier = DI 0 + check bonus 1 = 1
    //   need = 9 - 1 = 8
    const state = buildSitePhaseState({
      characters: [EOWYN],
      site: LOSSADAN_CAMP,
      hand: [LOSSOTH],
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

    // influenceNumber(9) - baseDI(0) - manCheckMod(1) = 8
    expect(eowynAttempt!.need).toBe(8);
  });

  test('no bonus when bearer is non-Man', () => {
    // Legolas (elf, base DI 2) attempts to influence Lossoth at Lossadan Camp.
    // Lossoth influence number = 9, Man check modifier does NOT apply to elves.
    //   modifier = DI 2
    //   need = 9 - 2 = 7
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: LOSSADAN_CAMP,
      hand: [LOSSOTH],
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

    // influenceNumber(9) - baseDI(2) = 7 (no Man bonus)
    expect(legolasAttempt!.need).toBe(7);
  });
});
