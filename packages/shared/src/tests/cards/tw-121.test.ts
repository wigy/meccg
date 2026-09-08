/**
 * @module tw-121.test
 *
 * Card test: Arinmîr (tw-121)
 * Type: hero-character
 * Effects: 1
 *
 * "Unique. +2 direct influence against the Variags of Khand faction."
 *
 * Tests:
 * 1. stat-modifier: +2 DI during faction-influence-check for Variags of
 *    Khand, and confirms the bonus is specific to Arinmîr (does not apply
 *    to another character attempting the same faction-influence).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  buildSitePhaseState, resetMint,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const ARINMIR = 'tw-121' as CardDefinitionId;
const VARIAG_CAMP = 'tw-435' as CardDefinitionId;
const VARIAGS_OF_KHAND = 'tw-357' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Arinmîr (tw-121)', () => {
  beforeEach(() => resetMint());

  test('+2 direct influence against the Variags of Khand faction', () => {
    // Arinmîr (elf, base DI 2) attempts to influence Variags of Khand at
    // Variag Camp. Variags of Khand influence number = 10, no standard
    // modifications. Arinmîr has +2 DI bonus specifically for this faction.
    //   modifier = DI 2 + bonus 2 = 4
    //   need = 10 - 4 = 6
    const state = buildSitePhaseState({
      characters: [ARINMIR],
      site: VARIAG_CAMP,
      hand: [VARIAGS_OF_KHAND],
    });

    const arinmirId = findCharInstanceId(state, RESOURCE_PLAYER, ARINMIR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const arinmirAttempt = influenceActions.find(
      a => a.influencingCharacterId === arinmirId,
    );
    expect(arinmirAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(2) - arinmirDIBonus(2) = 6
    expect(arinmirAttempt!.need).toBe(6);
  });

  test('+2 DI bonus does not apply to a different character', () => {
    // Aragorn (dunadan, base DI 3) attempts to influence Variags of Khand
    // at Variag Camp. He gets no faction-specific bonus (his own bonus is
    // for Rangers of the North, not Variags of Khand).
    //   modifier = DI 3
    //   need = 10 - 3 = 7
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: VARIAG_CAMP,
      hand: [VARIAGS_OF_KHAND],
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

    // influenceNumber(10) - baseDI(3) - noBonus(0) = 7
    expect(aragornAttempt!.need).toBe(7);
  });
});
