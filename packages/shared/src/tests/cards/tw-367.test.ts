/**
 * @module tw-367.test
 *
 * Card test: Wood-elves (tw-367)
 * Type: hero-resource-faction
 * Effects: 3
 *
 * "Unique. Playable at Thranduil's Halls if the influence check is greater
 *  than 8. Standard Modifications: Men (-1), Elves (+1), Dwarves (-2)."
 *
 * influenceNumber = 8, race = elf, playableAt = Thranduil's Halls.
 *
 * Effects tested:
 * 1. check-modifier: +1 to influence check when the influencing character is an elf
 * 2. check-modifier: −1 to influence check when the influencing character is a man
 * 3. check-modifier: −2 to influence check when the influencing character is a dwarf
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LEGOLAS, EOWYN, GIMLI,
  THRANDUILS_HALLS,
  WOOD_ELVES,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Wood-elves (tw-367)', () => {
  beforeEach(() => resetMint());

  test('elf character gets +1 check modifier when influencing', () => {
    // Legolas (elf, base DI 2) attempts to influence Wood-elves at
    // Thranduil's Halls. Influence number = 8. The faction card's
    // Elves (+1) check modifier applies. Legolas also has a +2 DI bonus
    // specifically against the Wood-elves faction.
    //   need = influenceNumber(8) − DI(2) − DIbonus(2) − elfCheckMod(+1) = 3
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
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

    // need = 8 − 2 (DI) − 2 (Legolas DI bonus vs Wood-elves) − 1 (elf check modifier) = 3
    expect(legolasAttempt!.need).toBe(3);
  });

  test('man character gets −1 check penalty when influencing', () => {
    // Éowyn (man, base DI 0) attempts to influence Wood-elves at
    // Thranduil's Halls. Influence number = 8. The faction card's
    // Men (−1) check modifier applies as a penalty.
    //   need = influenceNumber(8) − DI(0) − manCheckMod(−1) = 9
    const state = buildSitePhaseState({
      characters: [EOWYN],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const eowynId = findCharInstanceId(state, RESOURCE_PLAYER, EOWYN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const eowynAttempt = influenceActions.find(
      a => a.influencingCharacterId === eowynId,
    );
    expect(eowynAttempt).toBeDefined();

    // need = 8 − 0 (DI) − (−1) (man check modifier) = 9
    expect(eowynAttempt!.need).toBe(9);
  });

  test('dwarf character gets −2 check penalty when influencing', () => {
    // Gimli (dwarf, base DI 2) attempts to influence Wood-elves at
    // Thranduil's Halls. Influence number = 8. The faction card's
    // Dwarves (−2) check modifier applies as a penalty. Gimli also has
    // +1 DI bonus against elf factions.
    //   need = influenceNumber(8) − DI(2) − DIbonus(1) − dwarfCheckMod(−2) = 7
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
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

    // need = 8 − 2 (DI) − 1 (Gimli DI bonus vs elf factions) − (−2) (dwarf check modifier) = 7
    expect(gimliAttempt!.need).toBe(7);
  });

  test('elf needs lower roll than dwarf or man to win the faction', () => {
    // Elf (+1) vs dwarf (−2): elf should need a lower roll than dwarf.
    // Elf (+1) vs man (−1): elf should need a lower roll than man.
    const elfState = buildSitePhaseState({
      characters: [LEGOLAS],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });
    const legolasId = findCharInstanceId(elfState, RESOURCE_PLAYER, LEGOLAS);
    const elfNeed = (
      computeLegalActions(elfState, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'influence-attempt')
        .map(a => a.action as InfluenceAttemptAction)
        .find(a => a.influencingCharacterId === legolasId)
    )!.need;

    const dwarfState = buildSitePhaseState({
      characters: [GIMLI],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });
    const gimliId = findCharInstanceId(dwarfState, RESOURCE_PLAYER, GIMLI);
    const dwarfNeed = (
      computeLegalActions(dwarfState, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'influence-attempt')
        .map(a => a.action as InfluenceAttemptAction)
        .find(a => a.influencingCharacterId === gimliId)
    )!.need;

    const manState = buildSitePhaseState({
      characters: [EOWYN],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });
    const eowynId = findCharInstanceId(manState, RESOURCE_PLAYER, EOWYN);
    const manNeed = (
      computeLegalActions(manState, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'influence-attempt')
        .map(a => a.action as InfluenceAttemptAction)
        .find(a => a.influencingCharacterId === eowynId)
    )!.need;

    // Elf has the best odds; dwarf and man have worse odds
    expect(elfNeed).toBeLessThan(dwarfNeed);
    expect(elfNeed).toBeLessThan(manNeed);
  });
});
