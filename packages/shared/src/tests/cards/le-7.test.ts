/**
 * @module le-7.test
 *
 * Card test: Dôgrib (le-7)
 * Type: minion-character (ringwraith alignment)
 * Stats: Man warrior, prowess 4, body 7, mind 2, DI 0, MP 0
 * Homesite: Lossadan Camp
 *
 * Card text:
 *   "Unique. -1 to all corruption checks."
 *
 * Engine Support:
 * | # | Feature                           | Status      | Notes                                  |
 * |---|-----------------------------------|-------------|----------------------------------------|
 * | 1 | -1 corruption check modifier      | IMPLEMENTED | check-modifier effect, value -1        |
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. -1 modifier applied to Dôgrib's pending corruption check:
 *    corruptionModifier is -1 and need = CP + 1 - (-1) = CP + 2.
 *
 * Fixtures: minion-character (ringwraith), minion sites (LE), minion item.
 *   DOGRIB (le-7)             - minion man warrior, mind 2
 *   RED_BOOK (le-339)         - minion item, 2 corruption points (triggers check)
 *   DOL_GULDUR (le-367)       - minion haven (company site)
 *   MINAS_MORGUL (le-390)     - minion haven (opponent site)
 *   CIRYAHER (le-6)           - minion character (opponent filler)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  findCharInstanceId, getCharacter,
  enqueueTransferCorruptionCheck,
  RESOURCE_PLAYER, ARAGORN, RIVENDELL,
} from '../test-helpers.js';
import { computeLegalActions, Phase, Alignment } from '../../index.js';
import type { CardDefinitionId, CorruptionCheckAction } from '../../index.js';

const DOGRIB = 'le-7' as CardDefinitionId;
const RED_BOOK = 'le-339' as CardDefinitionId;

const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;

describe('Dôgrib (le-7)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: -1 corruption check modifier ──

  test('-1 corruption modifier increases need on pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: DOGRIB, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const dogribId = findCharInstanceId(state, RESOURCE_PLAYER, DOGRIB);
    const itemInstId = getCharacter(state, RESOURCE_PLAYER, DOGRIB).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, dogribId, itemInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(dogribId);
    // -1 modifier makes checks harder
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier. With modifier -1, need = CP + 2.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });
});
