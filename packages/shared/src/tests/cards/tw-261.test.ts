/**
 * @module tw-261.test
 *
 * Card test: Iron Hill Dwarves (tw-261)
 * Type: hero-resource-faction
 * Effects: 2
 *
 * "Unique. Playable at Iron Hill Dwarf-hold if the influence check is greater
 *  than 8. Standard Modifications: Elves (-2), Dwarves (+2)."
 *
 * influenceNumber = 8, race = dwarf, playableAt = Iron Hill Dwarf-hold.
 *
 * Effects tested:
 * 1. check-modifier: +2 to influence check when the influencing character is a dwarf
 * 2. check-modifier: −2 to influence check when the influencing character is an elf
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  GIMLI, LEGOLAS,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';

const IRON_HILL_DWARVES = 'tw-261' as CardDefinitionId;
const IRON_HILL_DWARF_HOLD = 'tw-403' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Iron Hill Dwarves (tw-261)', () => {
  beforeEach(() => resetMint());

  test('dwarf character gets +2 check modifier when influencing', () => {
    // Gimli (dwarf, base DI 2) attempts to influence Iron Hill Dwarves at
    // Iron Hill Dwarf-hold.  Influence number = 8.  Gimli has a personal
    // +2 DI bonus vs Iron Hill Dwarves (from his own stat-modifier effect).
    // The faction card's Dwarves (+2) check modifier also applies.
    //   effective DI = 2 (base) + 2 (Gimli stat-modifier) = 4
    //   need = influenceNumber(8) − DI(4) − dwarfCheckMod(+2) = 2
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: IRON_HILL_DWARF_HOLD,
      hand: [IRON_HILL_DWARVES],
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

    // need = 8 − 4 (effective DI) − 2 (dwarf check modifier) = 2
    expect(gimliAttempt!.need).toBe(2);
  });

  test('elf character gets −2 check penalty when influencing', () => {
    // Legolas (elf, base DI 2) attempts to influence Iron Hill Dwarves at
    // Iron Hill Dwarf-hold.  Influence number = 8.  The faction card's
    // Elves (−2) check modifier applies as a penalty.
    //   need = influenceNumber(8) − DI(2) − elfCheckMod(−2) = 8
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: IRON_HILL_DWARF_HOLD,
      hand: [IRON_HILL_DWARVES],
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

    // need = 8 − 2 (DI) − (−2) (elf check modifier) = 8
    expect(legolasAttempt!.need).toBe(8);
  });

  test('dwarf needs lower roll than elf to win the faction', () => {
    const dwarfState = buildSitePhaseState({
      characters: [GIMLI],
      site: IRON_HILL_DWARF_HOLD,
      hand: [IRON_HILL_DWARVES],
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
      site: IRON_HILL_DWARF_HOLD,
      hand: [IRON_HILL_DWARVES],
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
