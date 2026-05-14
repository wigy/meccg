/**
 * @module tw-278.test
 *
 * Card test: Men of Dorwinion (tw-278)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Shrel-Kain if the influence check is greater than 6.
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

const MEN_OF_DORWINION = 'tw-278' as CardDefinitionId;
const SHREL_KAIN = 'tw-425' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Men of Dorwinion (tw-278)', () => {
  beforeEach(() => resetMint());

  test('+1 influence check bonus when bearer is Man', () => {
    // Éowyn (man, base DI 0) attempts to influence Men of Dorwinion at Shrel-Kain.
    // Men of Dorwinion influence number = 6, Men get +1 check modifier from faction card.
    //   modifier = DI 0 + check bonus 1 = 1
    //   need = 6 - 1 = 5
    const state = buildSitePhaseState({
      characters: [EOWYN],
      site: SHREL_KAIN,
      hand: [MEN_OF_DORWINION],
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

    // influenceNumber(6) - baseDI(0) - manCheckMod(1) = 5
    expect(eowynAttempt!.need).toBe(5);
  });

  test('no bonus when bearer is non-Man', () => {
    // Legolas (elf, base DI 2) attempts to influence Men of Dorwinion at Shrel-Kain.
    // Men of Dorwinion influence number = 6, Man check modifier does NOT apply to elves.
    //   modifier = DI 2
    //   need = 6 - 2 = 4
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: SHREL_KAIN,
      hand: [MEN_OF_DORWINION],
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

    // influenceNumber(6) - baseDI(2) = 4 (no Man bonus)
    expect(legolasAttempt!.need).toBe(4);
  });
});
