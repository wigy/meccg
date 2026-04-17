/**
 * @module tw-280.test
 *
 * Card test: Men of Lebennin (tw-280)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Pelargir if the influence check is greater than 7.
 *  Standard Modifications: Dúnedain (+1)."
 *
 * Tests:
 * 1. check-modifier: +1 influence check bonus when bearer is dunadan
 * 2. No bonus when bearer is non-dunadan
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  FARAMIR, LEGOLAS,
  PELARGIR,
  MEN_OF_LEBENNIN,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Men of Lebennin (tw-280)', () => {
  beforeEach(() => resetMint());

  test('+1 influence check bonus when bearer is dunadan', () => {
    // Faramir (dunadan, base DI 1) attempts to influence Men of Lebennin at Pelargir.
    // Men of Lebennin influence number = 8, Dúnadan get +1 check modifier from faction card.
    //   modifier = DI 1 + check bonus 1 = 2
    //   need = 8 - 2 = 6
    const state = buildSitePhaseState({
      characters: [FARAMIR],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const faramirAttempt = influenceActions.find(
      a => a.influencingCharacterId === faramirId,
    );
    expect(faramirAttempt).toBeDefined();

    // influenceNumber(8) - baseDI(1) - dúnadanCheckMod(1) = 6
    expect(faramirAttempt!.need).toBe(6);
  });

  test('no bonus when bearer is non-dunadan', () => {
    // Legolas (elf, base DI 2) attempts to influence Men of Lebennin at Pelargir.
    // Men of Lebennin influence number = 8, Dúnadan check modifier does NOT apply to elves.
    //   modifier = DI 2
    //   need = 8 - 2 = 6
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
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
