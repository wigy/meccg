/**
 * @module tw-130.test
 *
 * Card test: Bifur (tw-130)
 * Type: hero-character (wizard), unique
 * Prowess 4 / Body 7 / Mind 2 / DI 0 / MP 0
 * Skills: warrior
 * Race: dwarf
 * Homesite: Blue Mountain Dwarf-hold
 * "Unique. +1 prowess against Orcs. -1 to all of his corruption checks.
 *  -1 to influence checks against factions."
 *
 * Engine Support:
 * | # | Feature                     | Status      | Notes                                              |
 * |---|-----------------------------|-------------|----------------------------------------------------|
 * | 1 | +1 prowess vs Orcs          | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=orc       |
 * | 2 | -1 to corruption checks     | IMPLEMENTED | check-modifier, check=corruption, value=-1         |
 * | 3 | -1 to influence vs factions | IMPLEMENTED | check-modifier, reason=faction-influence-check     |
 *
 * Playable: YES
 * Certified: 2026-07-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BALIN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BLUE_MOUNTAIN_DWARF_HOLD,
  BLUE_MOUNTAIN_DWARVES, GLAMDRING,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  enqueueTransferCorruptionCheck,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Race } from '../../index.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import type {
  CardDefinitionId, CharacterCard, InfluenceAttemptAction, CorruptionCheckAction,
} from '../../index.js';

const BIFUR = 'tw-130' as CardDefinitionId;

describe('Bifur (tw-130)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 prowess in combat vs Orcs ──

  test('+1 prowess in combat against Orcs', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [BIFUR] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const bifurId = findCharInstanceId(state, RESOURCE_PLAYER, BIFUR);
    const bifur = state.players[RESOURCE_PLAYER].characters[bifurId];
    const bifurDef = state.cardPool[bifur.definitionId] as CharacterCard;

    expect(computeCombatProwess(state, bifur, bifurDef, Race.Orc)).toBe(bifurDef.prowess + 1);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [BIFUR] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const bifurId = findCharInstanceId(state, RESOURCE_PLAYER, BIFUR);
    const bifur = state.players[RESOURCE_PLAYER].characters[bifurId];
    const bifurDef = state.cardPool[bifur.definitionId] as CharacterCard;

    expect(computeCombatProwess(state, bifur, bifurDef, Race.Troll)).toBe(bifurDef.prowess);
    expect(computeCombatProwess(state, bifur, bifurDef, Race.Undead)).toBe(bifurDef.prowess);
    expect(computeCombatProwess(state, bifur, bifurDef, Race.Ringwraith)).toBe(bifurDef.prowess);
  });

  // ── Effect 2: -1 corruption modifier ──

  test('-1 corruption modifier is applied to pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: BIFUR, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bifurId = findCharInstanceId(state, RESOURCE_PLAYER, BIFUR);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, BIFUR).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, bifurId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].characterId).toBe(bifurId);
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier; modifier -1 makes corruption checks harder
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  // ── Effect 3: -1 to influence checks against factions ──

  test('-1 influence penalty increases need when Bifur influences Blue Mountain Dwarves', () => {
    // Bifur (dwarf, DI 0) at Blue Mountain Dwarf-hold influencing Blue Mountain Dwarves
    // (influenceNumber 10, +2 for dwarves, -2 for elves).
    // infModifier = DI(0) + dwarf bonus(+2) + Bifur penalty(-1) = +1
    // need = 10 - 1 = 9
    const state = buildSitePhaseState({
      characters: [BIFUR],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const bifurId = findCharInstanceId(state, RESOURCE_PLAYER, BIFUR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const bifurAttempt = influenceActions.find(a => a.influencingCharacterId === bifurId);
    expect(bifurAttempt).toBeDefined();

    // Without the -1 penalty: need = 10 - (DI 0 + dwarf +2) = 8
    // With Bifur's -1 penalty: need = 10 - (DI 0 + dwarf +2 - 1) = 9
    expect(bifurAttempt!.need).toBe(9);
  });

  test('-1 influence penalty is worse than a dwarf with no penalty', () => {
    // Balin (dwarf, DI 2, no check-modifier penalty):
    // infModifier = DI(2) + dwarf bonus(+2) = 4, need = 10 - 4 = 6
    // Bifur (dwarf, DI 0, -1 penalty):
    // infModifier = DI(0) + dwarf bonus(+2) - 1 = 1, need = 10 - 1 = 9
    // Bifur's need > Balin's need.
    const bifurState = buildSitePhaseState({
      characters: [BIFUR],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });
    const bifurId = findCharInstanceId(bifurState, RESOURCE_PLAYER, BIFUR);
    const bifurAttempt = computeLegalActions(bifurState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === bifurId);
    expect(bifurAttempt).toBeDefined();

    const balinState = buildSitePhaseState({
      characters: [BALIN],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });
    const balinId = findCharInstanceId(balinState, RESOURCE_PLAYER, BALIN);
    const balinAttempt = computeLegalActions(balinState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === balinId);
    expect(balinAttempt).toBeDefined();

    expect(bifurAttempt!.need).toBeGreaterThan(balinAttempt!.need);
  });
});
