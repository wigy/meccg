/**
 * @module td-94.test
 *
 * Card test: Thráin II (td-94)
 * Type: hero-character (wizard alignment)
 * Effects: 2 (direct-influence bonuses against Dwarves / Dwarf factions)
 *
 * "Unique. +3 direct influence against Dwarves and Dwarf factions."
 *
 * Thráin II is a unique Warrior/Ranger/Sage Dwarf with no homesite,
 * base prowess 7, body 8, mind 9, direct influence 2. His DI bonus
 * applies when controlling Dwarf characters as followers (via
 * `influence-check` resolver context) and when influencing Dwarf
 * factions (via `faction-influence-check`).
 *
 * This tests both effects:
 * 1. stat-modifier: +3 DI during influence-check when target is a dwarf
 * 2. stat-modifier: +3 DI during faction-influence-check when faction race is dwarf
 *
 * Playable: YES
 * Certified: 2026-04-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, BALIN, FARAMIR, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BLUE_MOUNTAIN_DWARF_HOLD,
  BLUE_MOUNTAIN_DWARVES,
  buildTestState, resetMint,
  findCharInstanceId, viablePlayCharacterActions, buildSitePhaseState,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';

const THRAIN_II = 'td-94' as CardDefinitionId;

describe('Thráin II (td-94)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 2 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THRAIN_II] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDef = pool[THRAIN_II] as CharacterCard;
    expect(getCharacter(state, RESOURCE_PLAYER, THRAIN_II).effectiveStats.directInfluence).toBe(baseDef.directInfluence);
    expect(baseDef.directInfluence).toBe(2);
  });

  test('+3 DI allows Thráin II to control a dwarf character (Balin, mind 5) as a follower', () => {
    // Thráin II base DI = 2. Balin is a dwarf with mind 5.
    // Without the +3 DI bonus against Dwarves, DI 2 < mind 5 -> cannot control.
    // With the bonus, DI 2+3 = 5 >= mind 5 -> can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [THRAIN_II] }],
          hand: [BALIN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const thrainId = findCharInstanceId(state, RESOURCE_PLAYER, THRAIN_II);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const balinUnderThrain = actions.filter(a => a.controlledBy === thrainId);
    expect(balinUnderThrain.length).toBeGreaterThanOrEqual(1);
  });

  test('+3 DI bonus does not apply to non-dwarf characters', () => {
    // Faramir is a dúnadan with mind 5. Thráin II has base DI 2.
    // The +3 DI bonus only applies to dwarves, so DI stays 2 < mind 5.
    // Thráin II cannot control Faramir as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [THRAIN_II] }],
          hand: [FARAMIR],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const thrainId = findCharInstanceId(state, RESOURCE_PLAYER, THRAIN_II);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const faramirUnderThrain = actions.filter(a => a.controlledBy === thrainId);
    expect(faramirUnderThrain).toHaveLength(0);
  });

  test('+3 DI bonus applies when influencing a dwarf faction (Blue Mountain Dwarves)', () => {
    // Thráin II (dwarf, base DI 2) attempts to influence Blue Mountain
    // Dwarves at Blue Mountain Dwarf-hold.
    // Blue Mountain Dwarves influenceNumber = 9. Dwarves standard mod = +2.
    // With Thráin II's +3 DI bonus vs dwarf factions:
    //   need = 9 - (DI 2 + DI bonus 3 + dwarf check mod 2) = 9 - 7 = 2.
    const state = buildSitePhaseState({
      characters: [THRAIN_II],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const thrainId = findCharInstanceId(state, RESOURCE_PLAYER, THRAIN_II);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const thrainAttempt = influenceActions.find(
      a => a.influencingCharacterId === thrainId,
    );
    expect(thrainAttempt).toBeDefined();
    expect(thrainAttempt!.need).toBe(2);
  });
});
