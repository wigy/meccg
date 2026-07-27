/**
 * @module tw-132.test
 *
 * Card test: Bofur (tw-132)
 * Type: hero-character
 * Prowess 4 / Body 7 / Mind 2 / DI 0 / MP 0
 * Skills: warrior
 * Homesite: Blue Mountain Dwarf-hold
 * Effects: 3
 *
 * "Unique. +1 prowess against Orcs. -1 to all of his corruption checks.
 *  -1 to influence checks against factions."
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                                          |
 * |---|--------------------------------|-------------|----------------------------------------------------------------|
 * | 1 | +1 prowess vs Orcs             | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=orc                   |
 * | 2 | -1 to all corruption checks    | IMPLEMENTED | check-modifier, check=corruption                               |
 * | 3 | -1 to faction influence checks | IMPLEMENTED | check-modifier, check=influence, reason=faction-influence-check |
 *
 * Playable: YES
 * Certified: 2026-04-24
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BLUE_MOUNTAIN_DWARF_HOLD,
  BLUE_MOUNTAIN_DWARVES, GLAMDRING,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  enqueueTransferCorruptionCheck,
  getCharacter, RESOURCE_PLAYER, pool,
} from '../test-helpers.js';
import { computeLegalActions, Race } from '../../index.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, CharacterCard, CorruptionCheckAction, InfluenceAttemptAction } from '../../index.js';

const BOFUR = 'tw-132' as CardDefinitionId;
// Óin (tw-172): dwarf, DI 0, no faction influence penalty — clean baseline
const OIN = 'tw-172' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Bofur (tw-132)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 prowess in combat vs Orcs ──

  test('+1 prowess in combat against Orcs', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [BOFUR] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const bofurId = findCharInstanceId(state, RESOURCE_PLAYER, BOFUR);
    const bofur = state.players[RESOURCE_PLAYER].characters[bofurId];
    const bofurDef = pool[BOFUR as string] as CharacterCard;

    const prowessVsOrc = computeCombatProwess(state, bofur, bofurDef, Race.Orc);
    // Base prowess 4 + 1 bonus = 5
    expect(prowessVsOrc).toBe(bofurDef.prowess + 1);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [BOFUR] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const bofurId = findCharInstanceId(state, RESOURCE_PLAYER, BOFUR);
    const bofur = state.players[RESOURCE_PLAYER].characters[bofurId];
    const bofurDef = pool[BOFUR as string] as CharacterCard;

    expect(computeCombatProwess(state, bofur, bofurDef, Race.Troll)).toBe(bofurDef.prowess);
    expect(computeCombatProwess(state, bofur, bofurDef, Race.Undead)).toBe(bofurDef.prowess);
    expect(computeCombatProwess(state, bofur, bofurDef, Race.Ringwraith)).toBe(bofurDef.prowess);
  });

  // ── Effect 2: -1 to all corruption checks ──

  test('-1 corruption modifier increases need on pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BOFUR, items: [GLAMDRING] }, ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bofurId = findCharInstanceId(state, RESOURCE_PLAYER, BOFUR);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, BOFUR).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, bofurId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(bofurId);
    // check-modifier is -1 (Bofur's penalty)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier. With modifier -1, need = CP + 2.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  // ── Effect 3: -1 to influence checks against factions ──

  test('-1 to faction influence checks increases need when influencing a faction', () => {
    // Bofur (DI 0) at Blue Mountain Dwarf-hold attempts to influence the Blue Mountain Dwarves
    // (influenceNumber 10). The faction gives dwarves +2 check bonus. Bofur's -1 penalty reduces
    // the net check bonus to +1, giving need = 10 - 0 - 1 = 9.
    // Without Bofur's -1 penalty a dwarf with DI 0 would get need = 10 - 0 - 2 = 8 (see next test).
    const state = buildSitePhaseState({
      characters: [BOFUR],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const bofurId = findCharInstanceId(state, RESOURCE_PLAYER, BOFUR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const bofurAttempt = influenceActions.find(
      a => a.influencingCharacterId === bofurId,
    );
    expect(bofurAttempt).toBeDefined();

    // need = influenceNumber(10) - DI(0) - (dwarf bonus +2 + Bofur penalty -1) = 9
    expect(bofurAttempt!.need).toBe(9);
  });

  test('-1 influence penalty makes need higher than an equivalent dwarf without the penalty', () => {
    // Óin (tw-172) is a dwarf with DI 0 and no faction influence check modifier.
    // At Blue Mountain Dwarf-hold: need = 10 - DI(0) - dwarf bonus(+2) = 8.
    // Bofur's -1 penalty raises his need to 8 (see previous test), proving the penalty fires.
    const oinState = buildSitePhaseState({
      characters: [OIN],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const oinId = findCharInstanceId(oinState, RESOURCE_PLAYER, OIN);
    const oinActions = computeLegalActions(oinState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const oinAttempt = oinActions.find(a => a.influencingCharacterId === oinId);
    expect(oinAttempt).toBeDefined();
    // need = 10 - DI(0) - dwarf bonus(+2) = 8 (no Bofur penalty)
    expect(oinAttempt!.need).toBe(8);
  });
});
