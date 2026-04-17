/**
 * @module tw-263.test
 *
 * Card test: Knights of Dol Amroth (tw-263)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Dol Amroth if the influence check is greater than 8.
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
  DOL_AMROTH,
  KNIGHTS_OF_DOL_AMROTH,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Knights of Dol Amroth (tw-263)', () => {
  beforeEach(() => resetMint());

  test('+1 influence check bonus when bearer is dunadan', () => {
    // Anborn (dunadan, base DI 0) attempts to influence Knights of Dol Amroth at Dol Amroth.
    // Knights influence number = 9, Dúnadan get +1 check modifier from faction card.
    //   modifier = DI 0 + check bonus 1 = 1
    //   need = 9 - 1 = 8
    const state = buildSitePhaseState({
      characters: [ANBORN],
      site: DOL_AMROTH,
      hand: [KNIGHTS_OF_DOL_AMROTH],
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

    // influenceNumber(9) - baseDI(0) - dúnadanCheckMod(1) = 8
    expect(anbornAttempt!.need).toBe(8);
  });

  test('no bonus when bearer is non-dunadan', () => {
    // Legolas (elf, base DI 2) attempts to influence Knights of Dol Amroth at Dol Amroth.
    // Knights influence number = 9, Dúnadan check modifier does NOT apply to elves.
    //   modifier = DI 2
    //   need = 9 - 2 = 7
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: DOL_AMROTH,
      hand: [KNIGHTS_OF_DOL_AMROTH],
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

    // influenceNumber(9) - baseDI(2) = 7
    expect(legolasAttempt!.need).toBe(7);
  });
});
