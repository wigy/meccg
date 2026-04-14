/**
 * @module tw-127.test
 *
 * Card test: Beregond (tw-127)
 * Type: hero-character
 * Effects: 2
 *
 * "Unique. -1 to all of his corruption checks. -1 to influence checks against factions."
 *
 * This tests both effects:
 * 1. check-modifier: -1 to corruption checks (via corruptionModifier base stat)
 * 2. check-modifier: -1 to influence checks against factions
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BEREGOND, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, PELARGIR,
  MEN_OF_LEBENNIN, GLAMDRING,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  enqueueTransferCorruptionCheck,
  getCharacter,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction, CorruptionCheckAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Beregond (tw-127)', () => {
  beforeEach(() => resetMint());


  test('-1 corruption modifier increases need on pending corruption check', () => {
    // Build an organization phase state with Beregond holding Glamdring,
    // and a pending corruption check (as if Beregond just transferred an item).
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [{ defId: BEREGOND, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const beregondId = findCharInstanceId(state, 0, BEREGOND);
    const glamdringInstId = getCharacter(state, 0, BEREGOND).items[0].instanceId;

    // Enqueue a pending corruption-check resolution as if Beregond just
    // gave away an item via transfer.
    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, beregondId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(beregondId);
    // corruptionModifier should be -1 (Beregond's penalty)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier. With modifier -1, need = CP + 2.
    // This makes it harder for Beregond to pass corruption checks.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  test('-1 to influence checks increases need when influencing a faction', () => {
    // Beregond (dunadan, DI 0) attempts to influence Men of Lebennin (influence # 8) at Pelargir.
    // Men of Lebennin give Dúnedain +1 check modifier.
    // Without Beregond's -1 penalty: modifier = DI(0) + dunadan bonus(+1) = 1, need = 8 - 1 = 7.
    // With Beregond's -1 penalty: modifier = DI(0) + dunadan bonus(+1) + penalty(-1) = 0, need = 8.
    const state = buildSitePhaseState({
      characters: [BEREGOND],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const beregondId = findCharInstanceId(state, 0, BEREGOND);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const beregondAttempt = influenceActions.find(
      a => a.influencingCharacterId === beregondId,
    );
    expect(beregondAttempt).toBeDefined();

    // need = influenceNumber(8) - DI(0) - dunadanBonus(+1) - beregondPenalty(-1) = 8
    expect(beregondAttempt!.need).toBe(8);
  });

  test('-1 influence penalty makes faction checks harder than for a normal character', () => {
    // Compare Beregond vs Aragorn influencing Men of Lebennin.
    // Aragorn (dunadan, DI 3): need = 8 - DI(3) - dunadanBonus(+1) = 4
    // Beregond (dunadan, DI 0): need = 8 - DI(0) - dunadanBonus(+1) - penalty(-1) = 8
    const aragornState = buildSitePhaseState({
      characters: [ARAGORN],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const aragornId = findCharInstanceId(aragornState, 0, ARAGORN);
    const aragornActions = computeLegalActions(aragornState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const aragornAttempt = aragornActions.find(
      a => a.influencingCharacterId === aragornId,
    );
    expect(aragornAttempt).toBeDefined();
    expect(aragornAttempt!.need).toBe(4);

    // Beregond's need is much higher due to lower DI and the -1 penalty
    const beregondState = buildSitePhaseState({
      characters: [BEREGOND],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const beregondId = findCharInstanceId(beregondState, 0, BEREGOND);
    const beregondActions = computeLegalActions(beregondState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const beregondAttempt = beregondActions.find(
      a => a.influencingCharacterId === beregondId,
    );
    expect(beregondAttempt).toBeDefined();
    expect(beregondAttempt!.need).toBeGreaterThan(aragornAttempt!.need);
  });
});
