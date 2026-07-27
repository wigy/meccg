/**
 * @module tw-142.test
 *
 * Card test: Dwalin (tw-142)
 * Type: hero-character
 * Prowess 2 / Body 7 / Mind 1 / DI 0 / MP 0
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
 * | 2 | -1 to corruption checks                 | IMPLEMENTED | check-modifier corruption; folded into check need  |
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

const DWALIN = 'tw-142' as CardDefinitionId;

describe('Dwalin (tw-142)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 prowess against Orcs ────────────────────────────────────

  test('+1 prowess bonus applies in combat against Orcs', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [DWALIN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const dwalinChar = getCharacter(state, RESOURCE_PLAYER, DWALIN);
    const dwalinDef = pool[DWALIN as string] as CharacterCard;
    const ctx: ResolverContext = {
      reason: 'combat',
      bearer: {
        race: dwalinDef.race,
        skills: dwalinDef.skills,
        baseProwess: dwalinDef.prowess,
        baseBody: dwalinDef.body,
        baseDirectInfluence: dwalinDef.directInfluence,
        name: dwalinDef.name,
      },
      enemy: { race: Race.Orc, name: 'Orc Guard', prowess: 4, body: null },
    };

    const effects = collectCharacterEffects(state, dwalinChar, ctx);
    const bonus = resolveStatModifiers(effects, 'prowess', 0, ctx);
    expect(bonus).toBe(1);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [DWALIN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const dwalinChar = getCharacter(state, RESOURCE_PLAYER, DWALIN);
    const dwalinDef = pool[DWALIN as string] as CharacterCard;
    const makeCtx = (race: Race): ResolverContext => ({
      reason: 'combat',
      bearer: {
        race: dwalinDef.race,
        skills: dwalinDef.skills,
        baseProwess: dwalinDef.prowess,
        baseBody: dwalinDef.body,
        baseDirectInfluence: dwalinDef.directInfluence,
        name: dwalinDef.name,
      },
      enemy: { race, name: 'Creature', prowess: 4, body: null },
    });

    for (const race of [Race.Troll, Race.Undead, Race.Wolf]) {
      const ctx = makeCtx(race);
      const effects = collectCharacterEffects(state, dwalinChar, ctx);
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
          companies: [{ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [{ defId: DWALIN, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const dwalinId = findCharInstanceId(state, RESOURCE_PLAYER, DWALIN);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, DWALIN).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, dwalinId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(dwalinId);
    // check-modifier -1 makes it harder (need increases by 1)
    expect(ccActions[0].corruptionModifier).toBe(-1);
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  // ── Effect 3: -1 to influence checks against factions ────────────────────

  test('-1 influence penalty increases need when influencing a dwarf faction', () => {
    // Blue Mountain Dwarves at Blue Mountain Dwarf-hold: influence # 10.
    // Standard Modifications: Dwarves (+2).
    // Dwalin (dwarf, DI 0): modifier = DI(0) + dwarf bonus(+2) + penalty(-1) = 1
    // need = 10 - 1 = 9. Without the penalty it would be 10 - 2 = 8.
    const state = buildSitePhaseState({
      characters: [DWALIN],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const dwalinId = findCharInstanceId(state, RESOURCE_PLAYER, DWALIN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const dwalinAttempt = influenceActions.find(a => a.influencingCharacterId === dwalinId);
    expect(dwalinAttempt).toBeDefined();
    expect(dwalinAttempt!.need).toBe(9);
  });
});
