/**
 * @module tw-258.test
 *
 * Card test: Hobbits (tw-258)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Bag End if the influence check is greater than 8.
 *  Standard Modifications: Hobbits (+4)."
 *
 * Tests:
 * 1. check-modifier: +4 influence check bonus when bearer is Hobbit race
 * 2. No bonus when bearer is non-Hobbit race
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  FRODO, LEGOLAS,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, BAG_END } from '../../index.js';
import type { InfluenceAttemptAction, CardDefinitionId } from '../../index.js';

const HOBBITS = 'tw-258' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Hobbits (tw-258)', () => {
  beforeEach(() => resetMint());

  test('+4 influence check bonus when bearer is Hobbit', () => {
    // Frodo (hobbit, base DI 1) attempts to influence Hobbits at Bag End.
    // Hobbits influence number = 9, Hobbits get +4 check modifier from faction card.
    //   modifier = DI 1 + check bonus 4 = 5
    //   need = 9 - 5 = 4
    const state = buildSitePhaseState({
      characters: [FRODO],
      site: BAG_END,
      hand: [HOBBITS],
    });

    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const frodoAttempt = influenceActions.find(
      a => a.influencingCharacterId === frodoId,
    );
    expect(frodoAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(1) - hobbitCheckMod(4) = 4
    expect(frodoAttempt!.need).toBe(4);
  });

  test('no bonus when bearer is non-Hobbit', () => {
    // Legolas (elf, base DI 2) attempts to influence Hobbits at Bag End.
    // Hobbits influence number = 9, Hobbit check modifier does NOT apply to elves.
    //   modifier = DI 2
    //   need = 9 - 2 = 7
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: BAG_END,
      hand: [HOBBITS],
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

    // influenceNumber(9) - baseDI(2) = 7 (no Hobbit bonus)
    expect(legolasAttempt!.need).toBe(7);
  });
});
