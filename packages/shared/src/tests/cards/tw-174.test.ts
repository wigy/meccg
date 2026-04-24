/**
 * @module tw-174.test
 *
 * Card test: Orophin (tw-174)
 * Type: hero-character, Elf, Warrior/Ranger
 * Effects: 2
 *
 * "Unique. -1 to all of his corruption checks. -1 to influence checks against factions."
 *
 * Effect 1: check-modifier corruption -1 (corruptionModifier field; effect is for documentation)
 * Effect 2: check-modifier influence -1 (applied via DSL when influencing factions)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, THRANDUILS_HALLS,
  WOOD_ELVES, GLAMDRING,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  enqueueTransferCorruptionCheck,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction, CorruptionCheckAction, CardDefinitionId } from '../../index.js';

const OROPHIN = 'tw-174' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Orophin (tw-174)', () => {
  beforeEach(() => resetMint());

  test('-1 corruption modifier increases need on pending corruption check', () => {
    // Build an organization phase state with Orophin holding Glamdring,
    // and a pending corruption check (as if Orophin just transferred an item).
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THRANDUILS_HALLS, characters: [{ defId: OROPHIN, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const orophinId = findCharInstanceId(state, RESOURCE_PLAYER, OROPHIN);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, OROPHIN).items[0].instanceId;

    // Enqueue a pending corruption-check resolution as if Orophin just
    // gave away an item via transfer.
    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, orophinId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(orophinId);
    // corruptionModifier should be -1 (Orophin's penalty)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier. With modifier -1, need = CP + 2.
    // This makes it harder for Orophin to pass corruption checks.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  test('-1 to influence checks increases need when influencing a faction', () => {
    // Orophin (elf, DI 0) attempts to influence Wood-elves (influence # 8) at
    // Thranduil's Halls. Wood-elves give Elves +1 check modifier.
    // Without Orophin's -1 penalty: modifier = DI(0) + elf bonus(+1) = 1, need = 8 - 1 = 7.
    // With Orophin's -1 penalty: modifier = DI(0) + elf bonus(+1) + penalty(-1) = 0, need = 8.
    const state = buildSitePhaseState({
      characters: [OROPHIN],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const orophinId = findCharInstanceId(state, RESOURCE_PLAYER, OROPHIN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const orophinAttempt = influenceActions.find(
      a => a.influencingCharacterId === orophinId,
    );
    expect(orophinAttempt).toBeDefined();

    // need = influenceNumber(8) - DI(0) - elfBonus(+1) - orophinPenalty(-1) = 8
    expect(orophinAttempt!.need).toBe(8);
  });

  test('-1 influence penalty makes faction checks harder than for a character without the penalty', () => {
    // Compare Orophin vs Legolas influencing Wood-elves at Thranduil's Halls.
    // Legolas (elf, DI 2, +2 DI vs Wood-elves): need = 8 - DI(2) - elfBonus(+1) - diBonus(+2) = 3
    // Orophin (elf, DI 0): need = 8 - DI(0) - elfBonus(+1) - penalty(-1) = 8
    const legolasState = buildSitePhaseState({
      characters: [LEGOLAS],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const legolasId = findCharInstanceId(legolasState, RESOURCE_PLAYER, LEGOLAS);
    const legolasActions = computeLegalActions(legolasState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const legolasAttempt = legolasActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();
    expect(legolasAttempt!.need).toBe(3);

    // Orophin's need is much higher due to lower DI and the -1 penalty
    const orophinState = buildSitePhaseState({
      characters: [OROPHIN],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const orophinId = findCharInstanceId(orophinState, RESOURCE_PLAYER, OROPHIN);
    const orophinActions = computeLegalActions(orophinState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const orophinAttempt = orophinActions.find(
      a => a.influencingCharacterId === orophinId,
    );
    expect(orophinAttempt).toBeDefined();
    expect(orophinAttempt!.need).toBeGreaterThan(legolasAttempt!.need);
  });
});
