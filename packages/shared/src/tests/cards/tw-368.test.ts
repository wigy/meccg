/**
 * @module tw-368.test
 *
 * Card test: Woodmen (tw-368)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Woodmen-town if the influence check is greater
 *  than 7. Standard Modifications: Men (+1)."
 *
 * influenceNumber = 8, race = man, playableAt = Woodmen-town (tw-438).
 *
 * This tests the single effect:
 * 1. check-modifier: +1 to influence check when the influencing character is a man
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  EOWYN, LEGOLAS,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction, CardDefinitionId } from '../../index.js';

const WOODMEN = 'tw-368' as CardDefinitionId;
const WOODMEN_TOWN = 'tw-438' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Woodmen (tw-368)', () => {
  beforeEach(() => resetMint());

  test('man character gets +1 check modifier when influencing', () => {
    // Éowyn (man, base DI 0) attempts to influence Woodmen at Woodmen-town.
    // Woodmen influence number = 8. The faction card's Men (+1) check
    // modifier applies.
    //   need = influenceNumber(8) - DI(0) - manCheckMod(1) = 7
    const state = buildSitePhaseState({
      characters: [EOWYN],
      site: WOODMEN_TOWN,
      hand: [WOODMEN],
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

    // influenceNumber(8) - baseDI(0) - manCheckMod(1) = 7
    expect(eowynAttempt!.need).toBe(7);
  });

  test('non-man character does not get the +1 check modifier', () => {
    // Legolas (elf, base DI 2) attempts to influence Woodmen at
    // Woodmen-town. Legolas is not a man, so the Men (+1) check modifier
    // does NOT apply.
    //   need = influenceNumber(8) - DI(2) = 6
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: WOODMEN_TOWN,
      hand: [WOODMEN],
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

    // influenceNumber(8) - baseDI(2) = 6 (no Men bonus)
    expect(legolasAttempt!.need).toBe(6);
  });
});
