/**
 * @module tw-228.test
 *
 * Card test: Ents of Fangorn (tw-228)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Wellinghall if the influence check is greater than 9.
 *  Standard Modifications: Hobbits (+4)."
 *
 * This tests the one effect:
 * 1. check-modifier: +4 to influence check when bearer (influencing character) is Hobbit race
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  SAM_GAMGEE, LEGOLAS,
  WELLINGHALL,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction, CardDefinitionId } from '../../index.js';

const ENTS_OF_FANGORN = 'tw-228' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Ents of Fangorn (tw-228)', () => {
  beforeEach(() => resetMint());

  test('Hobbit character gets +4 check modifier when influencing', () => {
    // Sam Gamgee (hobbit, base DI 0) attempts to influence Ents of Fangorn at Wellinghall.
    // Ents influence number = 10.
    // Faction card gives Hobbits +4 check modifier.
    //   modifier = DI 0 + check bonus 4 (Hobbit) = 4
    //   need = 10 - 4 = 6
    const state = buildSitePhaseState({
      characters: [SAM_GAMGEE],
      site: WELLINGHALL,
      hand: [ENTS_OF_FANGORN],
    });

    const samId = findCharInstanceId(state, RESOURCE_PLAYER, SAM_GAMGEE);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const samAttempt = influenceActions.find(
      a => a.influencingCharacterId === samId,
    );
    expect(samAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(0) - hobbitCheckMod(4) = 6
    expect(samAttempt!.need).toBe(6);
  });

  test('non-Hobbit character does not get the +4 check modifier', () => {
    // Legolas (elf, base DI 2) attempts to influence Ents of Fangorn at Wellinghall.
    // Ents influence number = 10.
    // Legolas is not a hobbit, so no check modifier applies.
    //   modifier = DI 2
    //   need = 10 - 2 = 8
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: WELLINGHALL,
      hand: [ENTS_OF_FANGORN],
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

    // influenceNumber(10) - baseDI(2) = 8 (no bonus)
    expect(legolasAttempt!.need).toBe(8);
  });
});
