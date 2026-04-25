/**
 * @module tw-200.test
 *
 * Card test: Blue Mountain Dwarves (tw-200)
 * Type: hero-resource-faction
 * Effects: 2
 *
 * "Unique. Playable at Blue Mountain Dwarf-hold if the influence check is
 *  greater than 9. Standard Modifications: Elves (-2), Dwarves (+2)."
 *
 * influenceNumber = 9, race = dwarf, playableAt = Blue Mountain Dwarf-hold.
 *
 * Effects tested:
 * 1. check-modifier: +2 to influence check when the influencing character is a dwarf
 * 2. check-modifier: −2 to influence check when the influencing character is an elf
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  GIMLI, LEGOLAS,
  BLUE_MOUNTAIN_DWARF_HOLD,
  BLUE_MOUNTAIN_DWARVES,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Blue Mountain Dwarves (tw-200)', () => {
  beforeEach(() => resetMint());

  test('dwarf character gets +2 check modifier when influencing', () => {
    // Gimli (dwarf, base DI 2) attempts to influence Blue Mountain Dwarves at
    // Blue Mountain Dwarf-hold.  Influence number = 9.  No special DI bonus
    // for this faction; the faction card's Dwarves (+2) check modifier applies.
    //   need = influenceNumber(9) − DI(2) − dwarfCheckMod(+2) = 5
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const gimliAttempt = influenceActions.find(
      a => a.influencingCharacterId === gimliId,
    );
    expect(gimliAttempt).toBeDefined();

    // need = 9 − 2 (DI) − 2 (dwarf check modifier) = 5
    expect(gimliAttempt!.need).toBe(5);
  });

  test('elf character gets −2 check penalty when influencing', () => {
    // Legolas (elf, base DI 2) attempts to influence Blue Mountain Dwarves at
    // Blue Mountain Dwarf-hold.  Influence number = 9.  The faction card's
    // Elves (−2) check modifier applies as a penalty.
    //   need = influenceNumber(9) − DI(2) − elfCheckMod(−2) = 9
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();

    // need = 9 − 2 (DI) − (−2) (elf check modifier) = 9
    expect(legolasAttempt!.need).toBe(9);
  });

  test('dwarf needs lower roll than elf to win the faction', () => {
    const dwarfState = buildSitePhaseState({
      characters: [GIMLI],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });
    const gimliId = findCharInstanceId(dwarfState, RESOURCE_PLAYER, GIMLI);
    const dwarfNeed = (
      computeLegalActions(dwarfState, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'influence-attempt')
        .map(a => a.action as InfluenceAttemptAction)
        .find(a => a.influencingCharacterId === gimliId)
    )!.need;

    const elfState = buildSitePhaseState({
      characters: [LEGOLAS],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });
    const legolasId = findCharInstanceId(elfState, RESOURCE_PLAYER, LEGOLAS);
    const elfNeed = (
      computeLegalActions(elfState, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'influence-attempt')
        .map(a => a.action as InfluenceAttemptAction)
        .find(a => a.influencingCharacterId === legolasId)
    )!.need;

    // Dwarf has +2 advantage, elf has −2 disadvantage → 4-point spread
    expect(dwarfNeed).toBeLessThan(elfNeed);
  });
});
