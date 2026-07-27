/**
 * @module tw-141.test
 *
 * Card test: Dori (tw-141)
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
 * | 2 | -1 to corruption checks                 | IMPLEMENTED | check-modifier effect  |
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

const DORI = 'tw-141' as CardDefinitionId;

describe('Dori (tw-141)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 prowess against Orcs ────────────────────────────────────

  test('+1 prowess bonus applies in combat against Orcs', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [DORI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const doriChar = getCharacter(state, RESOURCE_PLAYER, DORI);
    const doriDef = pool[DORI as string] as CharacterCard;
    const ctx: ResolverContext = {
      reason: 'combat',
      bearer: {
        race: doriDef.race,
        skills: doriDef.skills,
        baseProwess: doriDef.prowess,
        baseBody: doriDef.body,
        baseDirectInfluence: doriDef.directInfluence,
        name: doriDef.name,
      },
      enemy: { race: Race.Orc, name: 'Orc Guard', prowess: 4, body: null },
    };

    const effects = collectCharacterEffects(state, doriChar, ctx);
    const bonus = resolveStatModifiers(effects, 'prowess', 0, ctx);
    expect(bonus).toBe(1);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [DORI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const doriChar = getCharacter(state, RESOURCE_PLAYER, DORI);
    const doriDef = pool[DORI as string] as CharacterCard;
    const makeCtx = (race: Race): ResolverContext => ({
      reason: 'combat',
      bearer: {
        race: doriDef.race,
        skills: doriDef.skills,
        baseProwess: doriDef.prowess,
        baseBody: doriDef.body,
        baseDirectInfluence: doriDef.directInfluence,
        name: doriDef.name,
      },
      enemy: { race, name: 'Creature', prowess: 4, body: null },
    });

    for (const race of [Race.Troll, Race.Undead, Race.Wolf]) {
      const ctx = makeCtx(race);
      const effects = collectCharacterEffects(state, doriChar, ctx);
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
          companies: [{ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [{ defId: DORI, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const doriId = findCharInstanceId(state, RESOURCE_PLAYER, DORI);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, DORI).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, doriId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(doriId);
    // check-modifier -1 makes it harder (need increases by 1)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  // ── Effect 3: -1 to influence checks against factions ────────────────────

  test('-1 influence penalty increases need when influencing a dwarf faction', () => {
    // Blue Mountain Dwarves at Blue Mountain Dwarf-hold: influence # 9.
    // Standard Modifications: Dwarves (+2).
    // Dori (dwarf, DI 0): modifier = DI(0) + dwarf bonus(+2) + penalty(-1) = 1
    // need = 9 - 1 = 8.
    // Without penalty: modifier = 0 + 2 = 2, need = 9 - 2 = 7.
    const state = buildSitePhaseState({
      characters: [DORI],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const doriId = findCharInstanceId(state, RESOURCE_PLAYER, DORI);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const doriAttempt = influenceActions.find(a => a.influencingCharacterId === doriId);
    expect(doriAttempt).toBeDefined();
    // need = influenceNumber(10) - DI(0) - dwarfBonus(+2) - doriPenalty(-1) = 9
    expect(doriAttempt!.need).toBe(9);
  });
});
