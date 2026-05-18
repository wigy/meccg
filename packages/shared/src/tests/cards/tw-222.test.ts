/**
 * @module tw-222.test
 *
 * Card test: Easterlings (tw-222)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Easterling Camp if the influence check is greater than 9.
 *  Standard Modifications: Dúnedain (-2)."
 *
 * Rule:
 * 1. check-modifier: -2 to influence check when bearer (influencing character) is Dúnadan race
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, LEGOLAS,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';

const EASTERLING_CAMP = 'tw-392' as CardDefinitionId;
const EASTERLINGS = 'tw-222' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Easterlings (tw-222)', () => {
  beforeEach(() => resetMint());

  test('Dúnadan character suffers -2 check modifier when influencing', () => {
    // Aragorn (dunadan, base DI 3) attempts to influence Easterlings at Easterling Camp.
    // Easterlings influence number = 10.
    // Faction card penalises Dúnedain by -2 check modifier (harder to succeed).
    //   modifier = DI 3
    //   need = 10 - 3 - (-2) = 9
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: EASTERLING_CAMP,
      hand: [EASTERLINGS],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const aragornAttempt = influenceActions.find(
      a => a.influencingCharacterId === aragornId,
    );
    expect(aragornAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(3) - dúnadanCheckMod(-2) = 9
    expect(aragornAttempt!.need).toBe(9);
  });

  test('non-Dúnadan character does not suffer the -2 check modifier', () => {
    // Legolas (elf, base DI 2) attempts to influence Easterlings at Easterling Camp.
    // Easterlings influence number = 10.
    // Legolas is not dunadan, so the Dúnedain -2 check modifier does NOT apply.
    //   modifier = DI 2
    //   need = 10 - 2 = 8
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: EASTERLING_CAMP,
      hand: [EASTERLINGS],
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

    // influenceNumber(10) - baseDI(2) = 8 (no Dúnadan penalty)
    expect(legolasAttempt!.need).toBe(8);
  });
});
