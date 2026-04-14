/**
 * @module tw-317.test
 *
 * Card test: Riders of Rohan (tw-317)
 * Type: hero-resource-faction
 * Effects: 2
 *
 * "Unique. Playable at Edoras if the influence check is greater than 9.
 *  Standard Modifications: Hobbits (+1), Dúnedain (+1)."
 *
 * This tests two effects:
 * 1. check-modifier: +1 to influence check when bearer (influencing character) is Hobbit race
 * 2. check-modifier: +1 to influence check when bearer (influencing character) is Dúnadan race
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, SAM_GAMGEE, LEGOLAS, THEODEN,
  EDORAS,
  RIDERS_OF_ROHAN,
  buildSitePhaseState, resetMint,
  findCharInstanceId,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Riders of Rohan (tw-317)', () => {
  beforeEach(() => resetMint());


  test('Dúnadan character gets +1 check modifier when influencing', () => {
    // Aragorn (dunadan, base DI 3) attempts to influence Riders of Rohan at Edoras.
    // Riders influence number = 10.
    // Faction card gives Dúnedain +1 check modifier.
    //   modifier = DI 3 + check bonus 1 (Dúnadan) = 4
    //   need = 10 - 4 = 6
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const aragornAttempt = influenceActions.find(
      a => a.influencingCharacterId === aragornId,
    );
    expect(aragornAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(3) - dúnadanCheckMod(1) = 6
    expect(aragornAttempt!.need).toBe(6);
  });

  test('Hobbit character gets +1 check modifier when influencing', () => {
    // Sam Gamgee (hobbit, base DI 0) attempts to influence Riders of Rohan at Edoras.
    // Riders influence number = 10.
    // Faction card gives Hobbits +1 check modifier.
    //   modifier = DI 0 + check bonus 1 (Hobbit) = 1
    //   need = 10 - 1 = 9
    const state = buildSitePhaseState({
      characters: [SAM_GAMGEE],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const samId = findCharInstanceId(state, 0, SAM_GAMGEE);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const samAttempt = influenceActions.find(
      a => a.influencingCharacterId === samId,
    );
    expect(samAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(0) - hobbitCheckMod(1) = 9
    expect(samAttempt!.need).toBe(9);
  });

  test('non-Hobbit non-Dúnadan character does not get the +1 check modifier', () => {
    // Legolas (elf, base DI 2) attempts to influence Riders of Rohan at Edoras.
    // Riders influence number = 10.
    // Legolas is neither hobbit nor dunadan, so no check modifier applies.
    //   modifier = DI 2
    //   need = 10 - 2 = 8
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const legolasId = findCharInstanceId(state, 0, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(2) = 8 (no bonus)
    expect(legolasAttempt!.need).toBe(8);
  });

  test('Théoden gets +2 DI bonus for Riders of Rohan but not the race check modifier', () => {
    // Théoden (man, base DI 3) has a +2 DI bonus specifically for Riders of Rohan.
    // He is race "man", so neither hobbit nor dunadan check modifier applies.
    //   modifier = DI 3 + DI bonus 2 (Théoden specific) = 5
    //   need = 10 - 5 = 5
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

    // influenceNumber(10) - baseDI(3) - théodenDIBonus(2) = 5
    expect(theodenAttempt!.need).toBe(5);
  });
});
