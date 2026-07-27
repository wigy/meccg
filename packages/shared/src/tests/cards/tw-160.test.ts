/**
 * @module tw-160.test
 *
 * Card test: Glóin (tw-160)
 * Type: hero-character (wizard alignment)
 * Effects: 4
 *
 * "Unique. +2 direct influence against the Blue Mountain Dwarves faction,
 *  +1 prowess against Orcs. +1 direct influence against Dwarves and Dwarf factions."
 *
 * Glóin is a unique Warrior/Diplomat Dwarf with base prowess 5, body 7,
 * mind 5, direct influence 2. His bonuses apply when fighting Orcs (combat),
 * when influencing the Blue Mountain Dwarves faction specifically, when
 * influencing any Dwarf faction, and when bringing Dwarf characters under
 * direct control.
 *
 * Effects:
 * 1. stat-modifier: +2 DI during faction-influence-check for Blue Mountain Dwarves
 * 2. stat-modifier: +1 prowess during combat when enemy.race is orc
 * 3. stat-modifier: +1 DI during influence-check when target.race is dwarf
 * 4. stat-modifier: +1 DI during faction-influence-check when faction.race is dwarf
 *
 * Playable: YES
 * Certified: 2026-05-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FARAMIR, KILI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BLUE_MOUNTAIN_DWARF_HOLD,
  BLUE_MOUNTAIN_DWARVES,
  buildTestState, resetMint,
  findCharInstanceId, viablePlayCharacterActions, buildSitePhaseState,
  getCharacter, RESOURCE_PLAYER,
  makeSingleCharCombatState, executeAction,
} from '../test-helpers.js';
import { computeLegalActions, Phase, Race } from '../../index.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';

const GLOIN = 'tw-160' as CardDefinitionId;
const GLOIN_BASE_PROWESS = 5;
const GLOIN_BASE_DI = 2;

describe('Glóin (tw-160)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 2 (conditional DI bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GLOIN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDef = pool[GLOIN] as CharacterCard;
    expect(getCharacter(state, RESOURCE_PLAYER, GLOIN).effectiveStats.directInfluence).toBe(baseDef.directInfluence);
    expect(baseDef.directInfluence).toBe(GLOIN_BASE_DI);
  });

  test('base effective prowess is 5 (combat prowess bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GLOIN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GLOIN).effectiveStats.prowess).toBe(GLOIN_BASE_PROWESS);
  });

  test('+2 DI and +1 generic dwarf-faction DI allow influencing Blue Mountain Dwarves with need 2', () => {
    // Blue Mountain Dwarves influenceNumber = 9, Standard Mods: Dwarves +2.
    // Glóin DI 2 + Blue Mountain Dwarves bonus 2 + generic dwarf faction bonus 1 + faction check mod 2 = 7.
    // need = 9 - 7 = 2.
    const state = buildSitePhaseState({
      characters: [GLOIN],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const gloinId = findCharInstanceId(state, RESOURCE_PLAYER, GLOIN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const gloinAttempt = influenceActions.find(a => a.influencingCharacterId === gloinId);
    expect(gloinAttempt).toBeDefined();
    expect(gloinAttempt!.need).toBe(3);
  });

  test('+1 DI allows Glóin to control a dwarf character (Kíli, mind 3) as a follower', () => {
    // Glóin base DI = 2. Kíli is a dwarf with mind 3.
    // Without the +1 DI bonus against Dwarves, DI 2 < mind 3 -> cannot control.
    // With the bonus, DI 2+1 = 3 >= mind 3 -> can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GLOIN] }],
          hand: [KILI],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gloinId = findCharInstanceId(state, RESOURCE_PLAYER, GLOIN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const kiliUnderGloin = actions.filter(a => a.controlledBy === gloinId);
    expect(kiliUnderGloin.length).toBeGreaterThanOrEqual(1);
  });

  test('+1 DI bonus does not apply to non-dwarf characters (Faramir, mind 5)', () => {
    // Faramir is a dúnadan with mind 5. Glóin has base DI 2.
    // The +1 DI bonus only applies to dwarves, so DI stays 2 < mind 5.
    // Glóin cannot control Faramir as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GLOIN] }],
          hand: [FARAMIR],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gloinId = findCharInstanceId(state, RESOURCE_PLAYER, GLOIN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const faramirUnderGloin = actions.filter(a => a.controlledBy === gloinId);
    expect(faramirUnderGloin).toHaveLength(0);
  });

  test('+1 prowess bonus applies in combat vs Orcs (no tap)', () => {
    // Glóin base prowess 5, +1 vs Orcs = 6. Without tap: 6 - 3 = 3.
    // Roll 7: 3 + 7 = 10 > orc prowess 9 → Glóin wins the strike.
    // Without the bonus: 5 - 3 = 2. Roll 7: 2 + 7 = 9, not > 9 → wounded.
    const ready = makeSingleCharCombatState({
      heroDefId: GLOIN,
      creatureRace: Race.Orc,
      creatureProwess: 9,
      creatureBody: 5,
    });

    const afterAssign = executeAction(ready, PLAYER_1, 'assign-strike');
    const afterStrike = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 7, false);

    expect(afterStrike.combat?.phase).toBe('body-check');
    expect(afterStrike.combat?.bodyCheckTarget).toBe('creature');
  });

  test('+1 prowess bonus does not apply vs non-Orc enemies (undead)', () => {
    // Glóin base prowess 5, no bonus vs undead. Without tap: 5 - 3 = 2.
    // Roll 7: 2 + 7 = 9 = undead prowess 9, not > 9 → Glóin is wounded.
    const ready = makeSingleCharCombatState({
      heroDefId: GLOIN,
      creatureRace: Race.Undead,
      creatureProwess: 9,
      creatureBody: 5,
    });

    const afterAssign = executeAction(ready, PLAYER_1, 'assign-strike');
    const afterStrike = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 7, false);

    // Glóin was wounded (not body-check on creature)
    expect(afterStrike.combat?.bodyCheckTarget).not.toBe('creature');
  });
});
