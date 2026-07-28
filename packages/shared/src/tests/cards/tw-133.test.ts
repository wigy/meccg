/**
 * @module tw-133.test
 *
 * Card test: Bombur (tw-133)
 * Type: hero-character
 * Prowess 3 / Body 6 / Mind 1 / DI 0 / MP 0
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
 * | 2 | -1 to corruption checks                 | IMPLEMENTED | check-modifier effect                              |
 * | 3 | -1 to influence checks against factions | IMPLEMENTED | check-modifier influence; applied in faction check |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA,
  BLUE_MOUNTAIN_DWARF_HOLD, BLUE_MOUNTAIN_DWARVES,
  GLAMDRING,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  enqueueTransferCorruptionCheck,
  getCharacter, RESOURCE_PLAYER,
  pool,
} from '../test-helpers.js';
import { computeLegalActions, Race } from '../../index.js';
import type { InfluenceAttemptAction, CorruptionCheckAction, CardDefinitionId, CharacterCard } from '../../index.js';
import {
  collectCharacterEffects,
  resolveStatModifiers,
  type ResolverContext,
} from '../../engine/effects/index.js';

const BOMBUR = 'tw-133' as CardDefinitionId;

describe('Bombur (tw-133)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 prowess against Orcs ────────────────────────────────────

  test('+1 prowess bonus applies in combat against Orcs', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BOMBUR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const bomburChar = getCharacter(state, RESOURCE_PLAYER, BOMBUR);
    const bomburDef = pool[BOMBUR as string] as CharacterCard;
    const ctx: ResolverContext = {
      reason: 'combat',
      bearer: {
        race: bomburDef.race,
        skills: bomburDef.skills,
        baseProwess: bomburDef.prowess,
        baseBody: bomburDef.body,
        baseDirectInfluence: bomburDef.directInfluence,
        name: bomburDef.name,
      },
      enemy: { race: Race.Orc, name: 'Orc Guard', prowess: 4, body: null },
    };

    const effects = collectCharacterEffects(state, bomburChar, ctx);
    const bonus = resolveStatModifiers(effects, 'prowess', 0, ctx);
    expect(bonus).toBe(1);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BOMBUR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const bomburChar = getCharacter(state, RESOURCE_PLAYER, BOMBUR);
    const bomburDef = pool[BOMBUR as string] as CharacterCard;
    const makeCtx = (race: Race): ResolverContext => ({
      reason: 'combat',
      bearer: {
        race: bomburDef.race,
        skills: bomburDef.skills,
        baseProwess: bomburDef.prowess,
        baseBody: bomburDef.body,
        baseDirectInfluence: bomburDef.directInfluence,
        name: bomburDef.name,
      },
      enemy: { race, name: 'Creature', prowess: 4, body: null },
    });

    for (const race of [Race.Troll, Race.Undead, Race.Wolf]) {
      const ctx = makeCtx(race);
      const effects = collectCharacterEffects(state, bomburChar, ctx);
      const bonus = resolveStatModifiers(effects, 'prowess', 0, ctx);
      expect(bonus).toBe(0);
    }
  });

  // ── Effect 2: -1 to corruption checks ────────────────────────────────────

  test('-1 corruption modifier increases need on pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [{ defId: BOMBUR, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const bomburId = findCharInstanceId(state, RESOURCE_PLAYER, BOMBUR);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, BOMBUR).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, bomburId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(bomburId);
    // check-modifier -1 makes it harder (need increases by 1)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  // ── Effect 3: -1 to influence checks against factions ────────────────────

  test('-1 influence penalty increases need when influencing a dwarf faction', () => {
    // Blue Mountain Dwarves at Blue Mountain Dwarf-hold: influence # 10.
    // Standard Modifications: Dwarves (+2).
    // Bombur (dwarf, DI 0): modifier = DI(0) + dwarf bonus(+2) + penalty(-1) = 1
    // need = 10 - 1 = 9. Without the penalty it would be 8.
    const state = buildSitePhaseState({
      characters: [BOMBUR],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const bomburId = findCharInstanceId(state, RESOURCE_PLAYER, BOMBUR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const bomburAttempt = influenceActions.find(a => a.influencingCharacterId === bomburId);
    expect(bomburAttempt).toBeDefined();
    // need = influenceNumber(10) - DI(0) - dwarfBonus(+2) - bomburPenalty(-1) = 9
    expect(bomburAttempt!.need).toBe(9);
  });
});
