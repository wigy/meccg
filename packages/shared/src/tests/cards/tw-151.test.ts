/**
 * @module tw-151.test
 *
 * Card test: Forlong (tw-151)
 * Type: hero-character (wizard alignment)
 * Effects: 2
 *
 * "Unique. -1 to all of his corruption checks. -1 to influence checks against factions."
 *
 * Forlong is a unique Warrior Dunadan with base prowess 3, body 7, mind 1,
 * direct influence 0. His -1 corruption modifier makes all corruption checks
 * harder. His -1 influence check modifier penalises faction influence attempts.
 *
 * Effects:
 * 1. check-modifier: -1 to corruption checks (always)
 * 2. check-modifier: -1 to influence checks against factions
 *
 * Playable: YES
 * Certified: 2026-05-23
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  GLAMDRING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BLUE_MOUNTAIN_DWARF_HOLD,
  BLUE_MOUNTAIN_DWARVES,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  enqueueTransferCorruptionCheck,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction, CorruptionCheckAction } from '../../index.js';

const FORLONG = 'tw-151' as CardDefinitionId;

describe('Forlong (tw-151)', () => {
  beforeEach(() => resetMint());

  test('-1 corruption modifier increases need on pending corruption check', () => {
    // Forlong (corruptionModifier = -1) holds Glamdring (2 CP).
    // need = CP + 1 - modifier = 2 + 1 - (-1) = 4.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: FORLONG, items: [GLAMDRING] }, ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const forlongId = findCharInstanceId(state, RESOURCE_PLAYER, FORLONG);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, FORLONG).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, forlongId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(forlongId);
    // corruptionModifier is -1 (Forlong's penalty)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier = 2 + 1 - (-1) = 4
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  test('-1 to influence checks increases need when influencing a faction', () => {
    // Forlong (dunadan, DI 0) at Blue Mountain Dwarf-hold influences Blue Mountain Dwarves
    // (influence number 9). Forlong is dunadan so no racial check bonus applies.
    // Without Forlong's -1 penalty: modifier = 0, need = 9 - 0 - 0 = 9.
    // With Forlong's -1 penalty: modifier = 0 + (-1) = -1, need = 9 - 0 - (-1) = 10.
    const state = buildSitePhaseState({
      characters: [FORLONG],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const forlongId = findCharInstanceId(state, RESOURCE_PLAYER, FORLONG);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const forlongAttempt = influenceActions.find(a => a.influencingCharacterId === forlongId);
    expect(forlongAttempt).toBeDefined();
    // need = 10 (influenceNumber) - 0 (DI) - (-1) (Forlong penalty) = 11
    expect(forlongAttempt!.need).toBe(11);
  });
});
