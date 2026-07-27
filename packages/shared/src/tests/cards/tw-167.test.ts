/**
 * @module tw-167.test
 *
 * Card test: Kíli (tw-167)
 * Type: hero-character (wizard), unique
 * Prowess 3 / Body 8 / Mind 3 / DI 0 / MP 1
 * Skills: warrior, scout
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
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, KILI, BALIN,
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
import type { CharacterCard, InfluenceAttemptAction, CorruptionCheckAction } from '../../index.js';

describe('Kíli (tw-167)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 prowess in combat vs Orcs ──

  test('+1 prowess in combat against Orcs', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [KILI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const kiliId = findCharInstanceId(state, RESOURCE_PLAYER, KILI);
    const kili = state.players[RESOURCE_PLAYER].characters[kiliId];
    const kiliDef = state.cardPool[kili.definitionId] as CharacterCard;

    expect(computeCombatProwess(state, kili, kiliDef, Race.Orc)).toBe(kiliDef.prowess + 1);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [KILI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const kiliId = findCharInstanceId(state, RESOURCE_PLAYER, KILI);
    const kili = state.players[RESOURCE_PLAYER].characters[kiliId];
    const kiliDef = state.cardPool[kili.definitionId] as CharacterCard;

    expect(computeCombatProwess(state, kili, kiliDef, Race.Troll)).toBe(kiliDef.prowess);
    expect(computeCombatProwess(state, kili, kiliDef, Race.Undead)).toBe(kiliDef.prowess);
    expect(computeCombatProwess(state, kili, kiliDef, Race.Ringwraith)).toBe(kiliDef.prowess);
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
          companies: [{ site: LORIEN, characters: [{ defId: KILI, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const kiliId = findCharInstanceId(state, RESOURCE_PLAYER, KILI);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, KILI).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, kiliId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].characterId).toBe(kiliId);
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier; modifier -1 makes corruption checks harder
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  // ── Effect 3: -1 to influence checks against factions ──

  test('-1 influence penalty increases need when Kíli influences Blue Mountain Dwarves', () => {
    // Kíli (dwarf, DI 0) at Blue Mountain Dwarf-hold influencing Blue Mountain Dwarves
    // (influenceNumber 10, +2 for dwarves, -2 for elves).
    // infModifier = DI(0) + dwarf bonus(+2) + Kíli penalty(-1) = +1
    // need = 10 - 1 = 9
    const state = buildSitePhaseState({
      characters: [KILI],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const kiliId = findCharInstanceId(state, RESOURCE_PLAYER, KILI);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const kiliAttempt = influenceActions.find(a => a.influencingCharacterId === kiliId);
    expect(kiliAttempt).toBeDefined();

    // Without the -1 penalty: need = 10 - (DI 0 + dwarf +2) = 8
    // With Kíli's -1 penalty: need = 10 - (DI 0 + dwarf +2 - 1) = 9
    expect(kiliAttempt!.need).toBe(9);
  });

  test('-1 influence penalty is worse than a dwarf with no penalty', () => {
    // Balin (dwarf, DI 2, no check-modifier penalty):
    // infModifier = DI(2) + dwarf bonus(+2) = 4, need = 10 - 4 = 6
    // Kíli (dwarf, DI 0, -1 penalty):
    // infModifier = DI(0) + dwarf bonus(+2) - 1 = 1, need = 10 - 1 = 9
    // Kíli's need > Balin's need.
    const kiliState = buildSitePhaseState({
      characters: [KILI],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });
    const kiliId = findCharInstanceId(kiliState, RESOURCE_PLAYER, KILI);
    const kiliAttempt = computeLegalActions(kiliState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === kiliId);
    expect(kiliAttempt).toBeDefined();

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

    expect(kiliAttempt!.need).toBeGreaterThan(balinAttempt!.need);
  });
});
