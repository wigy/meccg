/**
 * @module tw-182.test
 *
 * Card test: Théoden (tw-182)
 * Type: hero-character
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Riders of Rohan faction."
 *
 * Théoden (man, base DI 3) gets +2 DI when attempting to influence
 * the Riders of Rohan faction. Without the bonus, influence need is
 * 10 - 3 = 7. With the bonus, need is 10 - 3 - 2 = 5.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, THEODEN,
  RIVENDELL, MORIA, MINAS_TIRITH, EDORAS,
  RIDERS_OF_ROHAN, WOOD_ELVES,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  THRANDUILS_HALLS,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CharacterCard, InfluenceAttemptAction } from '../../index.js';

describe('Théoden (tw-182)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 3 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [THEODEN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const theodenId = findCharInstanceId(state, 0, THEODEN);
    const baseDef = pool[THEODEN as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(3);
    expect(state.players[0].characters[theodenId as string].effectiveStats.directInfluence).toBe(baseDef.directInfluence);
  });

  test('+2 DI bonus applies when influencing Riders of Rohan', () => {
    // Théoden (man, base DI 3) attempts to influence Riders of Rohan at Edoras.
    // Riders of Rohan influence number = 10, standard mods: hobbits +1, dunedain +1.
    // Théoden is man (neither hobbit nor dunadan), so no standard mod applies.
    // With Théoden's +2 DI bonus vs Riders of Rohan:
    //   need = 10 - 3 (base DI) - 2 (DI bonus) = 5
    const state = buildSitePhaseState({
      characters: [THEODEN],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const theodenId = findCharInstanceId(state, 0, THEODEN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const theodenAttempt = influenceActions.find(
      a => a.influencingCharacterId === theodenId,
    );
    expect(theodenAttempt).toBeDefined();
    expect(theodenAttempt!.need).toBe(5);
  });

  test('+2 DI bonus does not apply to other factions', () => {
    // Théoden attempts to influence Wood-elves at Thranduil's Halls.
    // Wood-elves influence number = 8, standard mod: Men (-1).
    // Théoden is man, so -1 penalty applies. No DI bonus (only for Riders of Rohan).
    // need = 8 - 3 (base DI) - (-1) (men penalty) = 6
    const state = buildSitePhaseState({
      characters: [THEODEN],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const theodenId = findCharInstanceId(state, 0, THEODEN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const theodenAttempt = influenceActions.find(
      a => a.influencingCharacterId === theodenId,
    );
    expect(theodenAttempt).toBeDefined();
    expect(theodenAttempt!.need).toBe(6);
  });
});
