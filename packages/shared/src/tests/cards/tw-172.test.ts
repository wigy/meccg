/**
 * @module tw-172.test
 *
 * Card test: Óin (tw-172)
 * Type: hero-character, Dwarf, Warrior/Ranger
 * Prowess 3 / Body 8 / Mind 3 / DI 0 / MP 1
 * Effects: 2
 *
 * "Unique. +1 prowess against Orcs. -1 to all of his corruption checks."
 *
 * Effect 1: stat-modifier prowess +1 when reason=combat, enemy.race=orc
 * Effect 2: check-modifier corruption -1 (corruptionModifier field; effect is for documentation)
 *
 * Engine Support:
 * | # | Feature                    | Status      | Notes                                         |
 * |---|----------------------------|-------------|-----------------------------------------------|
 * | 1 | +1 prowess vs Orcs         | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=orc  |
 * | 2 | -1 to all corruption checks | IMPLEMENTED | check-modifier corruption -1                  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, BLUE_MOUNTAIN_DWARF_HOLD,
  GLAMDRING,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId,
  enqueueTransferCorruptionCheck,
  getCharacter, RESOURCE_PLAYER, pool,
} from '../test-helpers.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import { computeLegalActions, Race } from '../../index.js';
import type { CardDefinitionId, CharacterCard, CorruptionCheckAction } from '../../index.js';

const OIN = 'tw-172' as CardDefinitionId;

function makeOinCombatState() {
  return buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [OIN] }], hand: [], siteDeck: [RIVENDELL] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Óin (tw-172)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 prowess vs Orcs ──────────────────────────────────────────

  test('+1 prowess in combat against Orcs', () => {
    const state = makeOinCombatState();
    const oinId = findCharInstanceId(state, RESOURCE_PLAYER, OIN);
    const oin = state.players[RESOURCE_PLAYER].characters[oinId];
    const oinDef = pool[OIN as string] as CharacterCard;

    const prowessVsOrc = computeCombatProwess(state, oin, oinDef, Race.Orc);
    // Base prowess 3 + 1 bonus = 4
    expect(prowessVsOrc).toBe(oinDef.prowess + 1);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = makeOinCombatState();
    const oinId = findCharInstanceId(state, RESOURCE_PLAYER, OIN);
    const oin = state.players[RESOURCE_PLAYER].characters[oinId];
    const oinDef = pool[OIN as string] as CharacterCard;

    expect(computeCombatProwess(state, oin, oinDef, Race.Troll)).toBe(oinDef.prowess);
    expect(computeCombatProwess(state, oin, oinDef, Race.Undead)).toBe(oinDef.prowess);
    expect(computeCombatProwess(state, oin, oinDef, Race.Animal)).toBe(oinDef.prowess);
  });

  // ── Effect 2: -1 to corruption checks ────────────────────────────────────

  test('-1 corruption modifier appears on pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [{ defId: OIN, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const oinId = findCharInstanceId(state, RESOURCE_PLAYER, OIN);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, OIN).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, oinId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(oinId);
    // corruptionModifier should be -1 (Óin's penalty makes checks harder)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier. With modifier -1, need = CP + 2.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });
});
