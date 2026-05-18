/**
 * @module tw-168.test
 *
 * Card test: Legolas (tw-168)
 * Type: hero-character
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Wood-elves faction."
 *
 * Tests:
 * 1. stat-modifier: +2 DI during faction-influence-check for Wood-elves
 * 2. Negative: +2 DI bonus does not apply to other characters
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LEGOLAS, ARAGORN,
  WOOD_ELVES,
  THRANDUILS_HALLS,
  buildSitePhaseState,
  findCharInstanceId, resetMint, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

describe('Legolas (tw-168)', () => {
  beforeEach(() => resetMint());

  test('+2 direct influence against Wood-elves faction', () => {
    // Legolas (elf, base DI 2) attempts to influence Wood-elves at Thranduil's Halls.
    // Wood-elves influence number = 8.
    // Legolas has +2 DI bonus specifically for Wood-elves.
    // Wood-elves card gives Elves +1 check modifier.
    //   modifier = DI 2 + DI bonus 2 + elf check bonus 1 = 5
    //   need = 8 - 5 = 3
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
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

    // influenceNumber(8) - baseDI(2) - legolasBonus(2) - elfCheckMod(1) = 3
    expect(legolasAttempt!.need).toBe(3);
  });

  test('+2 DI bonus does not apply to other characters', () => {
    // Aragorn (dunadan, DI 3) attempts Wood-elves at Thranduil's Halls.
    // Aragorn gets no Legolas-specific bonus and no elf check modifier.
    //   need = 8 - 3 = 5
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
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

    // influenceNumber(8) - baseDI(3) = 5 (no Legolas-specific bonus, dunadan has no check modifier)
    expect(aragornAttempt!.need).toBe(5);
  });
});
