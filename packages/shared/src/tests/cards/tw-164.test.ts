/**
 * @module tw-164.test
 *
 * Card test: Haldir (tw-164)
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
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, HALDIR, GLORFINDEL_II,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, THRANDUILS_HALLS,
  WOOD_ELVES, GLAMDRING,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CharacterCard, InfluenceAttemptAction, CorruptionCheckAction, OrganizationPhaseState } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Haldir (tw-164)', () => {
  beforeEach(() => resetMint());

  test('corruption check modifier is -1 (from corruptionModifier base stat)', () => {
    const halDef = pool[HALDIR as string] as CharacterCard;
    expect(halDef.corruptionModifier).toBe(-1);
  });

  test('-1 corruption modifier increases need on pending corruption check', () => {
    // Build an organization phase state with Haldir holding Glamdring,
    // and a pending corruption check (as if Haldir just transferred an item).
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: HALDIR, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const haldirId = findCharInstanceId(state, 0, HALDIR);
    const glamdringInstId = state.players[0].characters[haldirId as string].items[0].instanceId;

    // Set up pending corruption check as if Haldir just gave away an item
    const orgPhase: OrganizationPhaseState = {
      phase: Phase.Organization,
      characterPlayedThisTurn: false,
      sideboardFetchedThisTurn: 0,
      sideboardFetchDestination: null,
      pendingCorruptionCheck: {
        characterId: haldirId,
        transferredItemId: glamdringInstId,
      },
    };
    const stateWithCheck = { ...state, phaseState: orgPhase };

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(haldirId);
    // corruptionModifier should be -1 (Haldir's penalty)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier. With modifier -1, need = CP + 2.
    // This makes it harder for Haldir to pass corruption checks.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  test('-1 to influence checks increases need when influencing a faction', () => {
    // Haldir (elf, DI 0) attempts to influence Wood-elves (influence # 8) at Thranduil's Halls.
    // Wood-elves give Elves +1 check modifier.
    // Without Haldir's -1 penalty: modifier = DI(0) + elf bonus(+1) = 1, need = 8 - 1 = 7.
    // With Haldir's -1 penalty: modifier = DI(0) + elf bonus(+1) + Haldir penalty(-1) = 0, need = 8 - 0 = 8.
    const state = buildSitePhaseState({
      characters: [HALDIR],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const haldirId = findCharInstanceId(state, 0, HALDIR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const haldirAttempt = influenceActions.find(
      a => a.influencingCharacterId === haldirId,
    );
    expect(haldirAttempt).toBeDefined();

    // need = influenceNumber(8) - DI(0) - elfBonus(+1) - haldirPenalty(-1) = 8
    expect(haldirAttempt!.need).toBe(8);
  });

  test('-1 influence penalty is worse than a normal elf character', () => {
    // Compare Haldir vs Glorfindel II influencing Wood-elves.
    // Glorfindel II (elf, DI 2, +1 DI vs elf factions) should have lower need.
    // Glorfindel: need = 8 - DI(2) - elfBonus(+1) - diBonusVsElf(+1) = 4
    // Haldir:     need = 8 - DI(0) - elfBonus(+1) - influencePenalty(-1) = 8
    const glorfindelState = buildSitePhaseState({
      characters: [GLORFINDEL_II],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const glorfindelId = findCharInstanceId(glorfindelState, 0, GLORFINDEL_II);
    const glorfindelActions = computeLegalActions(glorfindelState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const glorfindelAttempt = glorfindelActions.find(
      a => a.influencingCharacterId === glorfindelId,
    );
    expect(glorfindelAttempt).toBeDefined();
    expect(glorfindelAttempt!.need).toBe(4);

    // Haldir's need is much higher due to lower DI and the -1 penalty
    const haldirState = buildSitePhaseState({
      characters: [HALDIR],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const haldirId = findCharInstanceId(haldirState, 0, HALDIR);
    const haldirActions = computeLegalActions(haldirState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const haldirAttempt = haldirActions.find(
      a => a.influencingCharacterId === haldirId,
    );
    expect(haldirAttempt).toBeDefined();
    expect(haldirAttempt!.need).toBeGreaterThan(glorfindelAttempt!.need);
  });
});
