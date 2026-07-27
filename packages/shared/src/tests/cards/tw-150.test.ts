/**
 * @module tw-150.test
 *
 * Card test: Fíli (tw-150)
 * Type: hero-character (wizard alignment)
 * Effects: 3
 *
 * "Unique. +1 prowess against Orcs. -1 to all of his corruption checks.
 *  -1 to influence checks against factions."
 *
 * Fíli is a unique Warrior/Scout Dwarf with base prowess 2, body 8, mind 2,
 * direct influence 0. His +1 prowess bonus only applies in combat vs Orcs.
 * His -1 corruption modifier makes all corruption checks harder.
 * His -1 influence check modifier penalises faction influence attempts.
 *
 * Effects:
 * 1. stat-modifier: +1 prowess during combat when enemy.race is orc
 * 2. check-modifier: -1 to corruption checks (via corruptionModifier field)
 * 3. check-modifier: -1 to influence checks against factions
 *
 * Playable: YES
 * Certified: 2026-05-10
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
  makeSingleCharCombatState, executeAction,
} from '../test-helpers.js';
import { computeLegalActions, Race } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction, CorruptionCheckAction } from '../../index.js';

const FILI = 'tw-150' as CardDefinitionId;
const FILI_BASE_PROWESS = 2;

describe('Fíli (tw-150)', () => {
  beforeEach(() => resetMint());

  test('base effective prowess is 2 (combat bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FILI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, FILI).effectiveStats.prowess).toBe(FILI_BASE_PROWESS);
  });

  test('+1 prowess bonus applies in combat vs Orcs (no tap)', () => {
    // Fíli base prowess 2, +1 vs Orcs = 3. Without tap: 3 - 3 = 0.
    // Roll 7: 0 + 7 = 7 > orc prowess 6 → Fíli wins the strike (creature body check).
    // Without the bonus: 2 - 3 = -1. Roll 7: -1 + 7 = 6 = 6, not > 6 → Fíli wounded.
    const ready = makeSingleCharCombatState({
      heroDefId: FILI,
      creatureRace: Race.Orc,
      creatureProwess: 6,
      creatureBody: 5,
    });

    const afterAssign = executeAction(ready, PLAYER_1, 'assign-strike');
    const afterStrike = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 7, false);

    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');
  });

  test('+1 prowess bonus does not apply vs non-Orc enemies (undead)', () => {
    // Fíli base prowess 2, no bonus vs undead. Without tap: 2 - 3 = -1.
    // Roll 7: -1 + 7 = 6 = undead prowess 6, not > 6 → Fíli is wounded.
    const ready = makeSingleCharCombatState({
      heroDefId: FILI,
      creatureRace: Race.Undead,
      creatureProwess: 6,
      creatureBody: 5,
    });

    const afterAssign = executeAction(ready, PLAYER_1, 'assign-strike');
    const afterStrike = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 7, false);

    expect(afterStrike.combat?.bodyCheckTarget).not.toBe('creature');
  });

  test('-1 corruption modifier increases need on pending corruption check', () => {
    // Fíli (corruptionModifier = -1) holds Glamdring (2 CP).
    // need = CP + 1 - modifier = 2 + 1 - (-1) = 4.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: FILI, items: [GLAMDRING] }, ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const filiId = findCharInstanceId(state, RESOURCE_PLAYER, FILI);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, FILI).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, filiId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(filiId);
    // corruptionModifier is -1 (Fíli's penalty)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier = 2 + 1 - (-1) = 4
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  test('-1 to influence checks increases need when influencing a faction', () => {
    // Fíli (dwarf, DI 0) at Blue Mountain Dwarf-hold influences Blue Mountain Dwarves
    // (influence number 9, standard Dwarves +2 check modifier).
    // Without Fíli's -1 penalty: modifier = +2, need = 9 - 0 - 2 = 7.
    // With Fíli's -1 penalty: modifier = 2 + (-1) = 1, need = 9 - 0 - 1 = 8.
    const state = buildSitePhaseState({
      characters: [FILI],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const filiId = findCharInstanceId(state, RESOURCE_PLAYER, FILI);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const filiAttempt = influenceActions.find(a => a.influencingCharacterId === filiId);
    expect(filiAttempt).toBeDefined();
    // need = 10 (influenceNumber) - 0 (DI) - 2 (dwarf check mod) - (-1) (Fíli penalty) = 9
    expect(filiAttempt!.need).toBe(9);
  });
});
