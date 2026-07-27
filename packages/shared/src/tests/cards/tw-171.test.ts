/**
 * @module tw-171.test
 *
 * Card test: Nori (tw-171)
 * Type: hero-character (wizard alignment), unique
 * Prowess 4 / Body 7 / Mind 2 / DI 0 / MP 0
 * Skills: warrior
 * Race: dwarf
 * Homesite: Blue Mountain Dwarf-hold
 *
 * "Unique. +1 prowess against Orcs. -1 to all of his corruption checks.
 *  -1 to influence checks against factions."
 *
 * Engine Support:
 * | # | Feature                                 | Status      | Notes                                              |
 * |---|-----------------------------------------|-------------|----------------------------------------------------|
 * | 1 | +1 prowess vs Orcs in combat            | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=orc       |
 * | 2 | -1 to all of his corruption checks      | IMPLEMENTED | check-modifier, check=corruption, value=-1         |
 * | 3 | -1 to influence checks against factions | IMPLEMENTED | check-modifier influence, reason=faction-influence-check |
 *
 * Playable: YES
 * Certified: 2026-07-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BALIN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  BLUE_MOUNTAIN_DWARF_HOLD, BLUE_MOUNTAIN_DWARVES,
  GLAMDRING,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  enqueueTransferCorruptionCheck,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Race } from '../../index.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import type {
  CardDefinitionId,
  CharacterCard,
  InfluenceAttemptAction,
  CorruptionCheckAction,
} from '../../index.js';

const NORI = 'tw-171' as CardDefinitionId;

describe('Nori (tw-171)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 prowess in combat against Orcs ──────────────────────────

  test('+1 prowess in combat against Orcs', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [NORI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const noriId = findCharInstanceId(state, RESOURCE_PLAYER, NORI);
    const nori = state.players[RESOURCE_PLAYER].characters[noriId];
    const noriDef = state.cardPool[nori.definitionId] as CharacterCard;

    expect(computeCombatProwess(state, nori, noriDef, Race.Orc)).toBe(noriDef.prowess + 1);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [NORI] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const noriId = findCharInstanceId(state, RESOURCE_PLAYER, NORI);
    const nori = state.players[RESOURCE_PLAYER].characters[noriId];
    const noriDef = state.cardPool[nori.definitionId] as CharacterCard;

    expect(computeCombatProwess(state, nori, noriDef, Race.Troll)).toBe(noriDef.prowess);
    expect(computeCombatProwess(state, nori, noriDef, Race.Undead)).toBe(noriDef.prowess);
    expect(computeCombatProwess(state, nori, noriDef, Race.Wolf)).toBe(noriDef.prowess);
  });

  // ── Effect 2: -1 to all of his corruption checks ─────────────────────────

  test('-1 corruption modifier is applied to his pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: NORI, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const noriId = findCharInstanceId(state, RESOURCE_PLAYER, NORI);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, NORI).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, noriId, glamdringInstId);

    const ccActions = computeLegalActions(stateWithCheck, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].characterId).toBe(noriId);
    // A -1 modifier makes his corruption checks harder: need = CP + 1 - modifier.
    expect(ccActions[0].corruptionModifier).toBe(-1);
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  test('the -1 corruption modifier is his alone and does not touch a companion', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [NORI, { defId: LEGOLAS, items: [GLAMDRING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, LEGOLAS).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, legolasId, glamdringInstId);

    const ccActions = computeLegalActions(stateWithCheck, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].characterId).toBe(legolasId);
    expect(ccActions[0].corruptionModifier).toBe(0);
  });

  // ── Effect 3: -1 to influence checks against factions ────────────────────

  test('-1 influence penalty increases the need when Nori influences a faction', () => {
    // Nori (dwarf, DI 0) at Blue Mountain Dwarf-hold influencing Blue Mountain
    // Dwarves (influence # 10, Dwarves +2).
    // modifier = DI(0) + dwarf(+2) + Nori(-1) = +1  →  need = 10 - 1 = 9
    // (without his penalty the need would be 8)
    const state = buildSitePhaseState({
      characters: [NORI],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const noriId = findCharInstanceId(state, RESOURCE_PLAYER, NORI);
    const attempt = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === noriId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('Nori needs a higher roll than an equally-ranked dwarf without the penalty', () => {
    // Balin (dwarf, DI 2, no penalty): modifier = 2 + 2 = 4 → need = 10 - 4 = 6
    // Nori (dwarf, DI 0, -1 penalty):  modifier = 0 + 2 - 1 = 1 → need = 9
    const noriState = buildSitePhaseState({
      characters: [NORI],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });
    const noriId = findCharInstanceId(noriState, RESOURCE_PLAYER, NORI);
    const noriAttempt = computeLegalActions(noriState, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === noriId);
    expect(noriAttempt).toBeDefined();

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

    expect(noriAttempt!.need).toBeGreaterThan(balinAttempt!.need);
  });
});
