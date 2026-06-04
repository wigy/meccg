/**
 * @module le-46.test
 *
 * Card test: Tros Hesnef (le-46)
 * Type: minion-character (ringwraith alignment)
 * Stats: Man warrior, prowess 5, body 7, mind 2, DI 0, MP 0
 * Homesite: Easterling Camp
 *
 * Card text:
 *   "Unique. +1 direct influence against any faction playable at Easterling Camp.
 *    -1 to all corruption checks."
 *
 * Engine Support:
 * | # | Feature                                     | Status      | Notes                                         |
 * |---|---------------------------------------------|-------------|-----------------------------------------------|
 * | 1 | +1 DI vs factions playable at Easterling Camp | IMPLEMENTED | stat-modifier, faction.playableAt condition   |
 * | 2 | -1 corruption check modifier                 | IMPLEMENTED | check-modifier effect, value -1               |
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. +1 DI bonus applies when influencing Easterlings (playableAt Easterling Camp):
 *    DI 0 + 1 = 1; need = influenceNumber(8) - DI(1) = 7.
 * 2. +1 DI bonus does NOT apply to factions not playable at Easterling Camp:
 *    DI 0; need = influenceNumber(9) - DI(0) = 9.
 * 3. -1 corruption modifier increases need on pending corruption check.
 *
 * Fixtures: minion-character (ringwraith), minion sites (LE), minion factions, minion item.
 *   TROS_HESNEF (le-46)                - minion man warrior, mind 2, DI 0
 *   EASTERLINGS (le-264)               - minion faction, influenceNumber 8, playableAt Easterling Camp
 *   EASTERLING_CAMP (le-371)           - minion site
 *   GOBLINS_OF_GOBLIN_GATE (le-265)    - minion faction, influenceNumber 9, playableAt Goblin-gate
 *   GOBLIN_GATE (le-378)               - minion site
 *   RED_BOOK (le-339)                  - minion item, 2 corruption points (triggers check)
 *   DOL_GULDUR (le-367)                - minion haven (company site)
 *   MORIA_MINION (le-392)              - minion site (opponent filler)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, getCharacter,
  enqueueTransferCorruptionCheck,
  RESOURCE_PLAYER, ARAGORN, RIVENDELL,
} from '../test-helpers.js';
import { computeLegalActions, Phase, Alignment } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction, CorruptionCheckAction } from '../../index.js';

const TROS_HESNEF = 'le-46' as CardDefinitionId;
const EASTERLINGS = 'le-264' as CardDefinitionId;
const EASTERLING_CAMP = 'le-371' as CardDefinitionId;
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;
const GOBLIN_GATE = 'le-378' as CardDefinitionId;
const RED_BOOK = 'le-339' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;

describe('Tros Hesnef (le-46)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 DI against factions playable at Easterling Camp ──

  test('+1 DI bonus applies when influencing Easterlings (playable at Easterling Camp)', () => {
    // Tros Hesnef (base DI 0) gets +1 when influencing Easterlings (influenceNumber 8).
    // need = 8 - (0 + 1) = 7
    const state = buildSitePhaseState({
      characters: [TROS_HESNEF],
      site: EASTERLING_CAMP,
      hand: [EASTERLINGS],
    });

    const trosId = findCharInstanceId(state, RESOURCE_PLAYER, TROS_HESNEF);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const trosAttempt = influenceActions.find(
      a => a.influencingCharacterId === trosId,
    );
    expect(trosAttempt).toBeDefined();
    // influenceNumber(8) - DI(0) - easterlingBonus(1) = 7
    expect(trosAttempt!.need).toBe(7);
  });

  test('+1 DI bonus does NOT apply to factions not playable at Easterling Camp', () => {
    // Tros Hesnef (base DI 0) attempts to influence Goblins of Goblin-gate
    // (influenceNumber 9, playableAt Goblin-gate) — no Easterling Camp bonus.
    // need = 9 - 0 = 9
    const state = buildSitePhaseState({
      characters: [TROS_HESNEF],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const trosId = findCharInstanceId(state, RESOURCE_PLAYER, TROS_HESNEF);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const trosAttempt = influenceActions.find(
      a => a.influencingCharacterId === trosId,
    );
    expect(trosAttempt).toBeDefined();
    // influenceNumber(9) - baseDI(0) = 9; no Easterling Camp bonus
    expect(trosAttempt!.need).toBe(9);
  });

  // ── Effect 2: -1 corruption check modifier ──

  test('-1 corruption modifier increases need on pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: TROS_HESNEF, items: [RED_BOOK] }] }],
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

    const trosId = findCharInstanceId(state, RESOURCE_PLAYER, TROS_HESNEF);
    const itemInstId = getCharacter(state, RESOURCE_PLAYER, TROS_HESNEF).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, trosId, itemInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(trosId);
    // -1 modifier makes checks harder (need = CP + 1 - modifier = CP + 2)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });
});
