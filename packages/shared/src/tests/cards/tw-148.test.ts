/**
 * @module tw-148.test
 *
 * Card test: Erkenbrand (tw-148)
 * Type: hero-character
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Riders of Rohan faction."
 *
 * Erkenbrand (man, base DI 2) gets +2 DI when attempting to influence
 * the Riders of Rohan faction. Without the bonus, influence need is
 * 10 - 2 = 8. With the bonus, need is 10 - 2 - 2 = 6.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN,
  RIVENDELL, MORIA, MINAS_TIRITH, EDORAS,
  RIDERS_OF_ROHAN, WOOD_ELVES,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  THRANDUILS_HALLS,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';

const ERKENBRAND = 'tw-148' as CardDefinitionId;

describe('Erkenbrand (tw-148)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 2 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [ERKENBRAND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDef = pool[ERKENBRAND as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(2);
    expect(getCharacter(state, RESOURCE_PLAYER, ERKENBRAND).effectiveStats.directInfluence).toBe(baseDef.directInfluence);
  });

  test('+2 DI bonus applies when influencing Riders of Rohan', () => {
    // Erkenbrand (man, base DI 2) attempts to influence Riders of Rohan at Edoras.
    // Riders of Rohan influence number = 10, standard mods: hobbits +1, dunedain +1.
    // Erkenbrand is man (neither hobbit nor dunadan), so no standard mod applies.
    // With Erkenbrand's +2 DI bonus vs Riders of Rohan:
    //   need = 10 - 2 (base DI) - 2 (DI bonus) = 6
    const state = buildSitePhaseState({
      characters: [ERKENBRAND],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const erkenbrandId = findCharInstanceId(state, RESOURCE_PLAYER, ERKENBRAND);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const erkenbrandAttempt = influenceActions.find(
      a => a.influencingCharacterId === erkenbrandId,
    );
    expect(erkenbrandAttempt).toBeDefined();
    expect(erkenbrandAttempt!.need).toBe(6);
  });

  test('+2 DI bonus does not apply to other factions', () => {
    // Erkenbrand attempts to influence Wood-elves at Thranduil's Halls.
    // Wood-elves influence number = 8, standard mod: Men (-1).
    // Erkenbrand is man, so -1 penalty applies. No DI bonus (only for Riders of Rohan).
    // need = 8 - 2 (base DI) - (-1) (men penalty) = 7
    const state = buildSitePhaseState({
      characters: [ERKENBRAND],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const erkenbrandId = findCharInstanceId(state, RESOURCE_PLAYER, ERKENBRAND);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const erkenbrandAttempt = influenceActions.find(
      a => a.influencingCharacterId === erkenbrandId,
    );
    expect(erkenbrandAttempt).toBeDefined();
    expect(erkenbrandAttempt!.need).toBe(7);
  });
});
