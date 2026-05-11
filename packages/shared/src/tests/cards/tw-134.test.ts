/**
 * @module tw-134.test
 *
 * Card test: Boromir II (tw-134)
 * Type: hero-character
 * Prowess 6 / Body 7 / Mind 4 / DI 1 / MP 1
 * Race: dunadan / Skills: warrior
 * Homesite: Minas Tirith
 * Effects: 2
 *
 * "Unique. +2 direct influence against the Men of Anórien faction.
 *  -1 to all of his corruption checks."
 *
 * 1. stat-modifier: +2 DI during faction-influence-check when faction.name is "Men of Anórien"
 * 2. check-modifier: -1 to corruption checks (canonical source: corruptionModifier: -1)
 *
 * Men of Anórien (tw-277): influenceNumber 8, playableAt Minas Tirith, Dúnedain +1 bonus.
 * Without Boromir's bonus: need = 8 - DI(1) - dunadan(+1) = 6
 * With Boromir's +2 DI bonus: need = 8 - DI(1) - DI_bonus(2) - dunadan(+1) = 4
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, PELARGIR,
  MEN_OF_ANORIEN, MEN_OF_LEBENNIN, GLAMDRING,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  enqueueTransferCorruptionCheck,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction, CorruptionCheckAction } from '../../index.js';

const BOROMIR_II = 'tw-134' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Boromir II (tw-134)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +2 DI against Men of Anórien ──────────────────────────────────

  test('base effective DI is 1 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [BOROMIR_II] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, BOROMIR_II).effectiveStats.directInfluence).toBe(1);
  });

  test('+2 DI bonus applies when influencing Men of Anórien', () => {
    // Boromir II (dunadan, base DI 1) vs Men of Anórien (influenceNumber 8) at Minas Tirith.
    // Dúnedain standard modifier: +1.
    // With +2 DI bonus: need = 8 - 1 - 2 - 1 = 4
    const state = buildSitePhaseState({
      characters: [BOROMIR_II],
      site: MINAS_TIRITH,
      hand: [MEN_OF_ANORIEN],
    });

    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR_II);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const boromirAttempt = influenceActions.find(
      a => a.influencingCharacterId === boromirId,
    );
    expect(boromirAttempt).toBeDefined();
    // need = 8 - DI(1) - DI_bonus(2) - dunadan_bonus(1) = 4
    expect(boromirAttempt!.need).toBe(4);
  });

  test('+2 DI bonus does NOT apply to other factions', () => {
    // Men of Lebennin (influenceNumber 8) at Pelargir, Dúnedain +1 bonus.
    // No special DI bonus from Boromir II for this faction.
    // need = 8 - DI(1) - dunadan_bonus(1) = 6
    const state = buildSitePhaseState({
      characters: [BOROMIR_II],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR_II);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const boromirAttempt = influenceActions.find(
      a => a.influencingCharacterId === boromirId,
    );
    expect(boromirAttempt).toBeDefined();
    // need = 8 - DI(1) - dunadan_bonus(1) = 6 (no +2 DI bonus here)
    expect(boromirAttempt!.need).toBe(6);
  });

  // ── Effect 2: -1 to corruption checks ───────────────────────────────────────

  test('-1 corruption modifier increases need on pending corruption check', () => {
    // Build state with Boromir II holding Glamdring and a pending corruption check.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [{ defId: BOROMIR_II, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR_II);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, BOROMIR_II).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, boromirId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(boromirId);
    // corruptionModifier is -1 (Boromir's penalty makes checks harder)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier = CP + 1 - (-1) = CP + 2
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });
});
