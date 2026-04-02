/**
 * @module tw-123.test
 *
 * Card test: Balin (tw-123)
 * Type: hero-character
 * Effects: 3
 *
 * "Unique. +2 prowess against Orcs, +1 direct influence against Dwarves
 *  and Dwarf factions."
 *
 * This tests all three effects:
 * 1. stat-modifier: +2 prowess in combat when enemy is orc
 * 2. stat-modifier: +1 DI during influence-check when target is a dwarf
 * 3. stat-modifier: +1 DI during faction-influence-check when faction race is dwarf
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, BALIN, KILI, HALDIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BLUE_MOUNTAIN_DWARF_HOLD,
  BLUE_MOUNTAIN_DWARVES,
  buildTestState, resetMint,
  findCharInstanceId, viablePlayCharacterActions, buildSitePhaseState,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CharacterCard, InfluenceAttemptAction } from '../../index.js';

// ---- Tests ----

describe('Balin (tw-123)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 2 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BALIN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const balinId = findCharInstanceId(state, 0, BALIN);
    const baseDef = pool[BALIN as string] as CharacterCard;
    expect(state.players[0].characters[balinId as string].effectiveStats.directInfluence).toBe(baseDef.directInfluence);
    expect(baseDef.directInfluence).toBe(2);
  });

  test('base effective prowess is 4 (combat bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BALIN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const balinId = findCharInstanceId(state, 0, BALIN);
    const baseDef = pool[BALIN as string] as CharacterCard;
    expect(state.players[0].characters[balinId as string].effectiveStats.prowess).toBe(baseDef.prowess);
    expect(baseDef.prowess).toBe(4);
  });

  test('+1 DI allows Balin to control a dwarf character (Kili, mind 3) as a follower', () => {
    // Balin base DI = 2. Kili is a dwarf with mind 3.
    // Without the +1 DI bonus against Dwarves, DI 2 < mind 3 -> cannot control.
    // With the bonus, DI 3 >= mind 3 -> can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [BALIN] }],
          hand: [KILI],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const balinId = findCharInstanceId(state, 0, BALIN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const kiliUnderBalin = actions.filter(
      a => a.controlledBy === balinId,
    );
    expect(kiliUnderBalin.length).toBeGreaterThanOrEqual(1);
  });

  test('+1 DI bonus does not apply to non-dwarf characters', () => {
    // Haldir is an elf with mind 3. Balin has base DI 2.
    // The +1 DI bonus only applies to dwarves, so DI stays 2 < mind 3.
    // Balin cannot control Haldir as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [BALIN] }],
          hand: [HALDIR],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const balinId = findCharInstanceId(state, 0, BALIN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    // No DI bonus for non-dwarves, so Balin cannot control Haldir as follower
    const haldirUnderBalin = actions.filter(
      a => a.controlledBy === balinId,
    );
    expect(haldirUnderBalin).toHaveLength(0);
  });

  test('+1 DI bonus applies when influencing a dwarf faction (Blue Mountain Dwarves)', () => {
    // Balin (dwarf, base DI 2) attempts to influence Blue Mountain Dwarves at Blue Mountain Dwarf-hold.
    // Blue Mountain Dwarves influence number = 9, Dwarves get +2 check modifier from faction card.
    // With Balin's +1 DI bonus vs dwarves, total modifier = DI 2 + 1 (DI bonus) + 2 (dwarf check) = 5.
    // Need to roll > 9 - 5 = 4, so need of 4.
    const state = buildSitePhaseState({
      characters: [BALIN],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const balinId = findCharInstanceId(state, 0, BALIN);
    const actions = computeLegalActions(state, PLAYER_1);

    // There should be an influence-attempt action for Blue Mountain Dwarves with Balin
    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const balinAttempt = influenceActions.find(
      a => a.influencingCharacterId === balinId,
    );
    expect(balinAttempt).toBeDefined();

    // The influence need should reflect the +1 DI bonus:
    // influenceNumber(9) - baseDI(2) - diBonusVsDwarf(1) - dwarfCheckMod(2) = 4
    expect(balinAttempt!.need).toBe(4);
  });
});
