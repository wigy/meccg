/**
 * @module tw-146.test
 *
 * Card test: Éomer (tw-146)
 * Type: hero-character
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Riders of Rohan faction."
 *
 * Éomer (man, base DI 0) gets +2 DI when attempting to influence the
 * Riders of Rohan faction. Riders of Rohan influence number = 10 and Éomer
 * (a Man) attracts no standard modification, so without the bonus his need
 * is 10 - 0 = 10; with the bonus it is 10 - 0 - 2 = 8.
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

const EOMER = 'tw-146' as CardDefinitionId;

describe('Éomer (tw-146)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 0 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [EOMER] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDef = pool[EOMER as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(0);
    expect(getCharacter(state, RESOURCE_PLAYER, EOMER).effectiveStats.directInfluence).toBe(baseDef.directInfluence);
  });

  test('+2 DI bonus applies when influencing Riders of Rohan', () => {
    // Éomer (man, base DI 0) attempts to influence Riders of Rohan at Edoras.
    // Riders of Rohan influence number = 10, standard mods: hobbits +1, dunedain +1.
    // Éomer is man (neither hobbit nor dunadan), so no standard mod applies.
    // With Éomer's +2 DI bonus vs Riders of Rohan:
    //   need = 10 - 0 (base DI) - 2 (DI bonus) = 8
    const state = buildSitePhaseState({
      characters: [EOMER],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const eomerId = findCharInstanceId(state, RESOURCE_PLAYER, EOMER);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const eomerAttempt = influenceActions.find(
      a => a.influencingCharacterId === eomerId,
    );
    expect(eomerAttempt).toBeDefined();
    expect(eomerAttempt!.need).toBe(8);
  });

  test('+2 DI bonus does not apply to other factions', () => {
    // Éomer attempts to influence Wood-elves at Thranduil’s Halls.
    // Wood-elves influence number = 9, standard mod: Men (-1).
    // Éomer is man, so -1 penalty applies. No DI bonus (only for Riders of Rohan).
    // need = 9 - 0 (base DI) - (-1) (men penalty) = 10
    const state = buildSitePhaseState({
      characters: [EOMER],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const eomerId = findCharInstanceId(state, RESOURCE_PLAYER, EOMER);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const eomerAttempt = influenceActions.find(
      a => a.influencingCharacterId === eomerId,
    );
    expect(eomerAttempt).toBeDefined();
    expect(eomerAttempt!.need).toBe(10);
  });
});
