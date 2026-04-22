/**
 * @module td-90.test
 *
 * Card test: Brand (td-90)
 * Type: hero-character
 * Effects: 1
 *
 * "Unique. +2 direct influence against Men of Dale faction."
 *
 * Tests:
 * 1. stat-modifier: +2 DI during faction-influence-check for Men of Dale
 * 2. +2 DI bonus does not apply to other factions
 * 3. +2 DI bonus does not apply to other characters attempting Men of Dale
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LEGOLAS,
  buildSitePhaseState,
  findCharInstanceId,
  resetMint,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const BRAND = 'td-90' as CardDefinitionId;
const DALE = 'td-174' as CardDefinitionId;
const MEN_OF_DALE = 'td-138' as CardDefinitionId;

describe('Brand (td-90)', () => {
  beforeEach(() => resetMint());

  test('+2 direct influence against Men of Dale faction', () => {
    // Brand (man, base DI 2) attempts Men of Dale at Dale.
    // Men of Dale influenceNumber = 8, gives Men +2 check modifier.
    //   modifier = DI 2 + brand bonus 2 + Men check bonus 2 = 6
    //   need = 8 - 6 = 2
    const state = buildSitePhaseState({
      characters: [BRAND],
      site: DALE,
      hand: [MEN_OF_DALE],
    });

    const brandId = findCharInstanceId(state, RESOURCE_PLAYER, BRAND);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const brandAttempt = influenceActions.find(
      a => a.influencingCharacterId === brandId,
    );
    expect(brandAttempt).toBeDefined();

    expect(brandAttempt!.need).toBe(2);
  });

  test('+2 DI bonus does not apply to other factions attempted by Brand', () => {
    // Brand (man, base DI 2) at Edoras attempting Riders of Rohan.
    // Riders of Rohan influenceNumber = 10, Men get no check bonus on Riders
    // (Riders gives Hobbits +1 and Dúnedain +1, not Men).
    //   modifier = DI 2 + 0 bonus = 2
    //   need = 10 - 2 = 8
    const EDORAS = 'tw-394' as CardDefinitionId;
    const RIDERS_OF_ROHAN = 'tw-317' as CardDefinitionId;

    const state = buildSitePhaseState({
      characters: [BRAND],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const brandId = findCharInstanceId(state, RESOURCE_PLAYER, BRAND);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const brandAttempt = influenceActions.find(
      a => a.influencingCharacterId === brandId,
    );
    expect(brandAttempt).toBeDefined();
    expect(brandAttempt!.need).toBe(8);
  });

  test('+2 DI bonus does not apply to other characters attempting Men of Dale', () => {
    // Legolas (elf, base DI 2) at Dale attempting Men of Dale.
    // Men of Dale gives only Men and Dwarves a check bonus; Legolas is elf.
    //   modifier = DI 2 + no bonus = 2
    //   need = 8 - 2 = 6
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: DALE,
      hand: [MEN_OF_DALE],
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();
    expect(legolasAttempt!.need).toBe(6);
  });
});
