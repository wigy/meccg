/**
 * @module tw-281.test
 *
 * Card test: Men of Northern Rhovanion (tw-281)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Lake-town if the influence check is greater than 6.
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

const MEN_OF_NORTHERN_RHOVANION = 'tw-281' as CardDefinitionId;
const LAKE_TOWN = 'tw-406' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Men of Northern Rhovanion (tw-281)', () => {
  beforeEach(() => resetMint());

  test('+1 influence check bonus when bearer is Man', () => {
    // Éowyn (man, base DI 0) attempts to influence Men of Northern Rhovanion at Lake-town.
    // Men of Northern Rhovanion influence number = 7, Men get +1 check modifier from faction card.
    //   modifier = DI 0 + check bonus 1 = 1
    //   need = 7 - 1 = 6
    const state = buildSitePhaseState({
      characters: [EOWYN],
      site: LAKE_TOWN,
      hand: [MEN_OF_NORTHERN_RHOVANION],
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

    // influenceNumber(7) - baseDI(0) - manCheckMod(1) = 6
    expect(eowynAttempt!.need).toBe(6);
  });

  test('no bonus when bearer is non-Man', () => {
    // Legolas (elf, base DI 2) attempts to influence Men of Northern Rhovanion at Lake-town.
    // Men of Northern Rhovanion influence number = 7, Man check modifier does NOT apply to elves.
    //   modifier = DI 2
    //   need = 7 - 2 = 5
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: LAKE_TOWN,
      hand: [MEN_OF_NORTHERN_RHOVANION],
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

    // influenceNumber(7) - baseDI(2) = 5 (no Man bonus)
    expect(legolasAttempt!.need).toBe(5);
  });
});
