/**
 * @module tw-277.test
 *
 * Card test: Men of Anórien (tw-277)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Minas Tirith if the influence check is greater than 7.
 *  Standard Modifications: Dúnedain (+1)."
 *
 * Tests:
 * 1. check-modifier: +1 influence check bonus when bearer is dunadan
 * 2. No bonus when bearer is non-dunadan
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ANBORN, LEGOLAS,
  MINAS_TIRITH,
  MEN_OF_ANORIEN,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Men of Anórien (tw-277)', () => {
  beforeEach(() => resetMint());

  test('+1 influence check bonus when bearer is dunadan', () => {
    // Anborn (dunadan, base DI 0) attempts to influence Men of Anórien at Minas Tirith.
    // Men of Anórien influence number = 8, Dúnadan get +1 check modifier from faction card.
    //   modifier = DI 0 + check bonus 1 = 1
    //   need = 8 - 1 = 7
    const state = buildSitePhaseState({
      characters: [ANBORN],
      site: MINAS_TIRITH,
      hand: [MEN_OF_ANORIEN],
    });

    const anbornId = findCharInstanceId(state, RESOURCE_PLAYER, ANBORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const anbornAttempt = influenceActions.find(
      a => a.influencingCharacterId === anbornId,
    );
    expect(anbornAttempt).toBeDefined();

    // influenceNumber(8) - baseDI(0) - dúnadanCheckMod(1) = 7
    expect(anbornAttempt!.need).toBe(7);
  });

  test('no bonus when bearer is non-dunadan', () => {
    // Legolas (elf, base DI 2) attempts to influence Men of Anórien at Minas Tirith.
    // Men of Anórien influence number = 8, Dúnadan check modifier does NOT apply to elves.
    //   modifier = DI 2
    //   need = 8 - 2 = 6
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: MINAS_TIRITH,
      hand: [MEN_OF_ANORIEN],
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

    // influenceNumber(8) - baseDI(2) = 6
    expect(legolasAttempt!.need).toBe(6);
  });
});
