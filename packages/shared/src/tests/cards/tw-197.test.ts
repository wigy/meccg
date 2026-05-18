/**
 * @module tw-197.test
 *
 * Card test: Beornings (tw-197)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Beorn's House if the influence check is greater than 7.
 *  Standard Modifications: Men (+1)."
 *
 * influenceNumber = 8, race = man, playableAt = Beorn's House.
 *
 * Effects tested:
 * 1. check-modifier: +1 to influence check when the influencing character is a Man
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  THEODEN, LEGOLAS,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction, CardDefinitionId } from '../../index.js';

const BEORNINGS = 'tw-197' as CardDefinitionId;
const BEORNS_HOUSE = 'tw-376' as CardDefinitionId;

describe('Beornings (tw-197)', () => {
  beforeEach(() => resetMint());

  test('Man character gets +1 check modifier when influencing Beornings', () => {
    // Théoden (man, base DI 3) attempts to influence Beornings at Beorn's House.
    // Influence number = 8. Men (+1) check modifier applies.
    //   need = influenceNumber(8) − DI(3) − manCheckMod(+1) = 4
    const state = buildSitePhaseState({
      characters: [THEODEN],
      site: BEORNS_HOUSE,
      hand: [BEORNINGS],
    });

    const thedenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const thedenAttempt = influenceActions.find(
      a => a.influencingCharacterId === thedenId,
    );
    expect(thedenAttempt).toBeDefined();

    // need = 8 − 3 (DI) − 1 (man check modifier) = 4
    expect(thedenAttempt!.need).toBe(4);
  });

  test('non-Man character gets no check modifier when influencing Beornings', () => {
    // Legolas (elf, base DI 2) attempts to influence Beornings at Beorn's House.
    // Influence number = 8. Men (+1) check modifier does NOT apply to elves.
    //   need = influenceNumber(8) − DI(2) = 6
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: BEORNS_HOUSE,
      hand: [BEORNINGS],
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

    // need = 8 − 2 (DI) = 6 (no check modifier for elves)
    expect(legolasAttempt!.need).toBe(6);
  });

  test('Man has lower need than non-Man for Beornings', () => {
    const manState = buildSitePhaseState({
      characters: [THEODEN],
      site: BEORNS_HOUSE,
      hand: [BEORNINGS],
    });
    const thedenId = findCharInstanceId(manState, RESOURCE_PLAYER, THEODEN);
    const manNeed = (
      computeLegalActions(manState, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'influence-attempt')
        .map(a => a.action as InfluenceAttemptAction)
        .find(a => a.influencingCharacterId === thedenId)
    )!.need;

    const elfState = buildSitePhaseState({
      characters: [LEGOLAS],
      site: BEORNS_HOUSE,
      hand: [BEORNINGS],
    });
    const legolasId = findCharInstanceId(elfState, RESOURCE_PLAYER, LEGOLAS);
    const elfNeed = (
      computeLegalActions(elfState, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'influence-attempt')
        .map(a => a.action as InfluenceAttemptAction)
        .find(a => a.influencingCharacterId === legolasId)
    )!.need;

    // Man has +1 advantage: elfNeed > manNeed
    expect(manNeed).toBeLessThan(elfNeed);
  });
});
